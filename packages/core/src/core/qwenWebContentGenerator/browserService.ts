/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { PuppeteerBrowserController } from './browser/controller.js';
import type { QwenWebTransportState } from './browser/types.js';

export interface QwenWebChannelSession {
  prepare(model: string): Promise<QwenWebTransportState>;
  reset(model: string): Promise<QwenWebTransportState>;
  send(prompt: string, model: string): Promise<string>;
}

function abortError(): Error {
  const error = new Error('Qwen Web browser request was aborted.');
  error.name = 'AbortError';
  return error;
}

export class QwenWebBrowserService {
  private readonly controller: PuppeteerBrowserController;
  private readonly channelTails = new Map<string, Promise<void>>();
  private closed = false;

  constructor(controller = new PuppeteerBrowserController()) {
    this.controller = controller;
  }

  async withChannel<T>(
    channel: string,
    signal: AbortSignal | undefined,
    operation: (session: QwenWebChannelSession) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error('Qwen Web browser service is closed.');
    let cancelled = signal?.aborted ?? false;
    const onAbort = () => {
      cancelled = true;
      // Cancellation is intentionally out-of-band. It never waits behind the
      // per-channel queue, so Ctrl+C can press Stop while the request owns it.
      void this.controller.stopGeneration(channel);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await this.enqueue(channel, async () => {
        if (cancelled) throw abortError();
        const session: QwenWebChannelSession = {
          prepare: async (model) => {
            if (cancelled) throw abortError();
            return this.controller.prepareChannel(channel, model, signal);
          },
          reset: async (model) => {
            if (cancelled) throw abortError();
            return this.controller.newConversation(channel, model, signal);
          },
          send: async (prompt, model) => {
            if (cancelled) throw abortError();
            const text = await this.controller.sendPrompt(
              channel,
              prompt,
              model,
              signal,
            );
            if (cancelled) throw abortError();
            return text;
          },
        };
        return operation(session);
      });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async stop(channel: string): Promise<void> {
    await this.controller.stopGeneration(channel);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.channelTails.clear();
    await this.controller.close();
  }

  private async enqueue<T>(
    channel: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.channelTails.get(channel) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queuedTail = previous.catch(() => undefined).then(() => gate);
    this.channelTails.set(channel, queuedTail);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.channelTails.get(channel) === queuedTail) {
        this.channelTails.delete(channel);
      }
    }
  }
}

let singleton: QwenWebBrowserService | undefined;
let shutdownHookInstalled = false;

export function getQwenWebBrowserService(): QwenWebBrowserService {
  singleton ??= new QwenWebBrowserService();
  if (!shutdownHookInstalled) {
    shutdownHookInstalled = true;
    process.once('beforeExit', () => {
      void singleton?.close();
    });
  }
  return singleton;
}

/** @internal - test hook. */
export async function resetQwenWebBrowserServiceForTests(): Promise<void> {
  const current = singleton;
  singleton = undefined;
  if (current) await current.close();
}
