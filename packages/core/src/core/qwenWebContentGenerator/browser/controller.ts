/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { installQwenWebPageRuntime } from './pageRuntime.js';
import {
  ensureQwenWebBrowserDirectories,
  resolveQwenWebBrowserExecutable,
} from './config.js';
import type {
  QwenWebPageBridge,
  QwenWebPreparedPrompt,
  QwenWebRuntimeStatus,
  QwenWebTransportState,
} from './types.js';

const QWEN_WEB_URL = 'https://chat.qwen.ai/';

interface ChannelPage {
  page: Page;
  pageEpoch: number;
  model: string;
}

type BrowserWindow = Window & { __qwenCodeWebBridge?: QwenWebPageBridge };

function abortError(): Error {
  const error = new Error('Qwen Web browser request was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    setTimeout(() => signal.removeEventListener('abort', onAbort), ms + 1);
  });
}

export class PuppeteerBrowserController {
  private browser?: Browser;
  private browserIsHeadless = true;
  private browserEpoch = 0;
  private pageEpoch = 0;
  private channels = new Map<string, ChannelPage>();
  private authPromise?: Promise<void>;
  private shuttingDown = false;

  async prepareChannel(
    channel: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<QwenWebTransportState> {
    await this.ensureAuthenticated(signal);
    let entry = this.channels.get(channel);
    if (entry && !entry.page.isClosed()) {
      const status = await this.status(entry.page).catch(() => undefined);
      if (!status?.loggedIn) {
        await entry.page.close().catch(() => undefined);
        this.channels.delete(channel);
        await this.reauthenticate(signal);
        entry = undefined;
      }
    }
    if (!entry || entry.page.isClosed()) {
      entry = await this.createChannelPage(model, signal);
      this.channels.set(channel, entry);
    } else if (entry.model !== model) {
      await this.selectModel(entry.page, model);
      entry.model = model;
    }
    return { browserEpoch: this.browserEpoch, pageEpoch: entry.pageEpoch };
  }

  async newConversation(
    channel: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<QwenWebTransportState> {
    await this.ensureAuthenticated(signal);
    const existing = this.channels.get(channel);
    if (existing && !existing.page.isClosed()) {
      await existing.page.close().catch(() => undefined);
    }
    const entry = await this.createChannelPage(model, signal);
    this.channels.set(channel, entry);
    return { browserEpoch: this.browserEpoch, pageEpoch: entry.pageEpoch };
  }

  async sendPrompt(
    channel: string,
    prompt: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal);
    const state = await this.prepareChannel(channel, model, signal);
    const entry = this.channels.get(channel);
    if (!entry || entry.page.isClosed()) {
      throw new Error(`Qwen Web channel '${channel}' lost its browser page.`);
    }

    const prepared = await entry.page.evaluate(async (text) => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge;
      if (!bridge) throw new Error('Qwen Web page runtime is not installed.');
      return bridge.preparePrompt(text);
    }, prompt);
    throwIfAborted(signal);

    if (!prepared.accepted) {
      await entry.page.keyboard.press('Enter');
    }

    const responsePromise = entry.page.evaluate(async (baseline) => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge;
      if (!bridge) throw new Error('Qwen Web page runtime is not installed.');
      return bridge.waitForResponse(baseline as QwenWebPreparedPrompt);
    }, prepared);

    if (!signal) return responsePromise;
    return this.raceAbort(channel, state, responsePromise, signal);
  }

  async stopGeneration(channel: string): Promise<void> {
    const entry = this.channels.get(channel);
    if (!entry || entry.page.isClosed()) return;
    await entry.page
      .evaluate(async () => {
        const bridge = (window as BrowserWindow).__qwenCodeWebBridge;
        if (bridge) await bridge.stopGeneration();
      })
      .catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.channels.clear();
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close().catch(() => undefined);
  }

  private async raceAbort(
    channel: string,
    state: QwenWebTransportState,
    response: Promise<string>,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) {
      await this.stopGeneration(channel);
      throw abortError();
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        void this.stopGeneration(channel).finally(() => reject(abortError()));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      response.then(
        (text) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          const current = this.channels.get(channel);
          if (
            !current ||
            state.browserEpoch !== this.browserEpoch ||
            state.pageEpoch !== current.pageEpoch
          ) {
            reject(
              new Error(
                `Qwen Web channel '${channel}' changed while a response was in flight.`,
              ),
            );
            return;
          }
          resolve(text);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  private async ensureAuthenticated(signal?: AbortSignal): Promise<void> {
    if (this.browser && this.browserIsHeadless && !this.browser.process()?.killed) {
      return;
    }
    this.authPromise ??= this.authenticate(signal).finally(() => {
      this.authPromise = undefined;
    });
    return this.authPromise;
  }

  private async reauthenticate(signal?: AbortSignal): Promise<void> {
    if (this.authPromise) {
      await this.authPromise;
      return;
    }
    this.authPromise = this.authenticate(signal).finally(() => {
      this.authPromise = undefined;
    });
    await this.authPromise;
  }

  private async authenticate(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.launch(true);
    let page = await this.createPage(signal);
    let status = await this.status(page);
    if (status.loggedIn) {
      await page.close().catch(() => undefined);
      return;
    }

    await this.closeBrowserOnly();
    await this.launch(false);
    page = await this.createPage(signal);
    process.stderr.write(
      '\nQwen Web login required. Complete sign-in in the browser window; Qwen Code will close it and continue headless after login.\n',
    );

    while (true) {
      throwIfAborted(signal);
      status = await this.status(page);
      if (status.loggedIn) break;
      await delay(750, signal);
    }

    await this.closeBrowserOnly();
    await this.launch(true);
  }

  private async launch(headless: boolean): Promise<void> {
    if (this.browser) await this.closeBrowserOnly();
    const paths = await ensureQwenWebBrowserDirectories();
    const executablePath = await resolveQwenWebBrowserExecutable();
    const browser = await puppeteer.launch({
      executablePath,
      userDataDir: paths.profileDir,
      headless,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
      ],
    });
    this.browser = browser;
    this.browserIsHeadless = headless;
    this.browserEpoch += 1;
    this.channels.clear();
    browser.once('disconnected', () => {
      if (this.browser === browser) {
        this.browser = undefined;
        this.channels.clear();
      }
    });
  }

  private async closeBrowserOnly(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.channels.clear();
    if (browser) await browser.close().catch(() => undefined);
  }

  private async createPage(signal?: AbortSignal): Promise<Page> {
    throwIfAborted(signal);
    const browser = this.browser;
    if (!browser) throw new Error('Qwen Web browser is not running.');
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(installQwenWebPageRuntime);
    await page.goto(QWEN_WEB_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.evaluate(installQwenWebPageRuntime);
    return page;
  }

  private async createChannelPage(
    model: string,
    signal?: AbortSignal,
  ): Promise<ChannelPage> {
    const page = await this.createPage(signal);
    const status = await this.status(page);
    if (!status.loggedIn) {
      await page.close().catch(() => undefined);
      await this.reauthenticate(signal);
      return this.createChannelPage(model, signal);
    }
    await this.selectModel(page, model);
    this.pageEpoch += 1;
    return { page, pageEpoch: this.pageEpoch, model };
  }

  private async status(page: Page): Promise<QwenWebRuntimeStatus> {
    return page.evaluate(() => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge;
      if (!bridge) throw new Error('Qwen Web page runtime is not installed.');
      return bridge.getStatus();
    });
  }

  private async selectModel(page: Page, model: string): Promise<void> {
    const selected = await page.evaluate(async (requested) => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge;
      if (!bridge) throw new Error('Qwen Web page runtime is not installed.');
      return bridge.selectModel(requested);
    }, model);
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (normalize(selected) !== normalize(model)) {
      throw new Error(
        `Qwen Web model mismatch: requested '${model}', selected '${selected}'.`,
      );
    }
  }
}
