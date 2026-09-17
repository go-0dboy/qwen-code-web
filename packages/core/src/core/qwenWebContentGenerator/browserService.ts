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

export interface QwenWebBrowserController {
  prepareChannel(
    channel: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<QwenWebTransportState>;
  newConversation(
    channel: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<QwenWebTransportState>;
  sendPrompt(
    channel: string,
    prompt: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<string>;
  stopGeneration(channel: string): Promise<void>;
  close(): Promise<void>;
}

export interface QwenWebBrowserServiceLike {
  withChannel<T>(
    channel: string,
    signal: AbortSignal | undefined,
    operation: (session: QwenWebChannelSession) => Promise<T>,
  ): Promise<T>;
}

function abortError(): Error {
  const error = new Error('Qwen Web browser request was aborted.');
  error.name = 'AbortError';
  return error;
}

export class QwenWebBrowserService implements QwenWebBrowserServiceLike {
  private readonly controller: QwenWebBrowserController;
  private readonly channelTails = new Map<string, Promise<void>>();
  private closed = false;

  constructor(
    controller: QwenWebBrowserController = new PuppeteerBrowserController(),
  ) {
    this.controller = controller;
  }

  async withChannel<T>(
    channel: string,
    signal: AbortSignal | undefined,
    operation: (session: QwenWebChannelSession) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error('Qwen Web browser service is closed.');

    let cancelled = signal?.aborted ?? false;
    let active = false;
    let sendInFlight = false;
    let stopStarted = false;
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });

    const onAbort = () => {
      cancelled = true;
      // A queued request does not own the channel and must never stop the
      // request ahead of it. Once this request owns an active send, Stop is
      // issued out-of-band exactly once and cancellation wins the send race.
      if (!active || !sendInFlight || stopStarted) return;
      stopStarted = true;
      void this.controller
        .stopGeneration(channel)
        .finally(() => rejectCancellation(abortError()));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await this.enqueue(channel, async () => {
        if (cancelled) throw abortError();
        active = true;
        try {
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
              sendInFlight = true;
              try {
                // BrowserService owns cancellation for an active send. Passing
                // the same signal into the controller as well would register a
                // second Stop path and can stop twice.
                const response = this.controller.sendPrompt(
                  channel,
                  prompt,
                  model,
                  undefined,
                );
                const text = signal
                  ? await Promise.race([response, cancellation])
                  : await response;
                if (cancelled) throw abortError();
                return text;
              } catch (error) {
                if (cancelled) throw abortError();
                throw error;
              } finally {
                sendInFlight = false;
              }
            },
          };
          return await operation(session);
        } finally {
          active = false;
        }
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
