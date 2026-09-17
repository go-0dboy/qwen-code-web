/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installQwenWebPageRuntime } from './pageRuntime.js';
import type { QwenWebPageBridge } from './types.js';

const executablePath = [
  process.env['QWEN_WEB_BROWSER_PATH'],
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

const describeWithBrowser = executablePath ? describe : describe.skip;

type BrowserWindow = Window & { __qwenCodeWebBridge?: QwenWebPageBridge };

describeWithBrowser('Qwen Web page runtime DOM adapter', () => {
  let browser: Browser;

  beforeAll(
    async () => {
      browser = await puppeteer.launch({
        executablePath: executablePath!,
        headless: true,
        protocolTimeout: 30_000,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });
    },
    60_000,
  );

  afterAll(
    async () => {
      await browser?.close();
    },
    30_000,
  );

  async function runtimePage(html: string): Promise<Page> {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.evaluate(installQwenWebPageRuntime, {
      loginStabilityMs: 0,
      loginDetectionTimeoutMs: 50,
    });
    return page;
  }

  it('preserves multiline response text and uses the first matching response selector', async () => {
    const page = await runtimePage(`
      <textarea style="width:200px;height:40px"></textarea>
      <div class="response-message-content phase-answer" style="width:400px;min-height:40px"><pre>line 1\n  line 2</pre></div>
      <div class="chat-response-message" style="width:400px;min-height:40px">fallback duplicate</div>
    `);

    const status = await page.evaluate(async () => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge!;
      return bridge.getStatus();
    });

    expect(status.loggedIn).toBe(true);
    expect(status.responseCount).toBe(1);
    expect(status.responseText).toContain('line 1');
    expect(status.responseText).toContain('\n  line 2');
    expect(status.responseText).not.toContain('fallback duplicate');
    await page.close();
  });

  it('ignores an idle Web Search control outside the latest model response', async () => {
    const page = await runtimePage(`
      <textarea style="width:200px;height:40px"></textarea>
      <button class="web-search" style="width:100px;height:30px">Web Search</button>
      <div class="response-message-content phase-answer" style="width:400px;min-height:40px">answer</div>
    `);

    let nativeToolVisible = await page.evaluate(async () => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge!;
      return (await bridge.getStatus()).nativeToolVisible;
    });
    expect(nativeToolVisible).toBe(false);

    await page.evaluate(() => {
      const response = document.querySelector(
        '.response-message-content.phase-answer',
      );
      const tool = document.createElement('span');
      tool.className = 'tool-call';
      tool.textContent = 'Searching the web';
      response?.appendChild(tool);
    });

    nativeToolVisible = await page.evaluate(async () => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge!;
      return (await bridge.getStatus()).nativeToolVisible;
    });
    expect(nativeToolVisible).toBe(true);
    await page.close();
  });

  it('does not treat a visible login control as an authenticated session', async () => {
    const page = await runtimePage(`
      <textarea style="width:200px;height:40px"></textarea>
      <button data-testid="login" style="width:100px;height:30px">Log in</button>
    `);

    const loggedIn = await page.evaluate(async () => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge!;
      return (await bridge.getStatus()).loggedIn;
    });
    expect(loggedIn).toBe(false);
    await page.close();
  });

  it('does not return a closed invoke while the Stop control is still active', async () => {
    const page = await runtimePage(`
      <textarea style="width:200px;height:40px"></textarea>
      <div class="response-message-content phase-answer" style="width:400px;min-height:40px">&lt;invoke name="read_file"&gt;&lt;parameter name="file_path"&gt;src/index.ts&lt;/parameter&gt;&lt;/invoke&gt;</div>
      <button class="stop-button" style="width:100px;height:30px">Stop</button>
    `);

    const result = await page.evaluate(async () => {
      const bridge = (window as BrowserWindow).__qwenCodeWebBridge!;
      window.setTimeout(() => document.querySelector('.stop-button')?.remove(), 650);
      const started = Date.now();
      const text = await bridge.waitForResponse({
        baselineCount: 0,
        baselineText: '',
        accepted: true,
      });
      return { text, elapsedMs: Date.now() - started };
    });

    expect(result.text).toContain('<invoke name="read_file">');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(550);
    await page.close();
  });
});
