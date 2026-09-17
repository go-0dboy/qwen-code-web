/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { PuppeteerBrowserController } from './browser/controller.js';
import type { QwenWebTransportState } from './browser/types.js';

const DEFAULT_MAX_IDLE_CHANNELS = 16;

export interface QwenWebChannelSession {
  prepare(model: string): Promise<QwenWebTransportState>;
  reset(model: string): Promise<QwenWebTransportState>;
  send(
    prompt: string,
    model: string,
    expectedTransport: QwenWebTransportState,
  ): Promise<string>;
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
    expectedTransport: QwenWebTransportState,
    signal?: AbortSignal,
  ): Promise<string>;
  stopGeneration(channel: string): Promise<void>;
  disposeChannel(channel: string): Promise<void>;
  close(): Promise<void>;
}

export interface QwenWebBrowserServiceLike {
  withChannel<T>(
    channel: string,
    signal: AbortSignal | undefined,
    operation: (session: QwenWebChannelSession) => Promise<T>,
  ): Promise<T>;
  disposeChannel?(channel: string): Promise<void>;
}

function abortError(): Error {
  const error = new Error('Qwen Web browser request was aborted.');
  error.name = 'AbortError';
  return error;
}

export class QwenWebBrowserService implements QwenWebBrowserServiceLike {
  private readonly channelTails = new Map<string, Promise<void>>();
  private readonly channelLastUsed = new Map<string, number>();
  private closed = false;

  constructor(
    private readonly controller: QwenWebBrowserController =
      new PuppeteerBrowserController(),
    private readonly maxIdleChannels = DEFAULT_MAX_IDLE_CHANNELS,
  ) {}

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
            send: async (prompt, model, expectedTransport) => {
              if (cancelled) throw abortError();
              sendInFlight = true;
              try {
                const response = this.controller.sendPrompt(
                  channel,
                  prompt,
                  model,
                  expectedTransport,
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
      this.channelLastUsed.set(channel, Date.now());
      await this.pruneIdleChannels(channel);
    }
  }

  async disposeChannel(channel: string): Promise<void> {
    if (this.closed) return;
    await this.enqueue(channel, () => this.controller.disposeChannel(channel));
    this.channelLastUsed.delete(channel);
  }

  async stop(channel: string): Promise<void> {
    await this.controller.stopGeneration(channel);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.channelTails.clear();
    this.channelLastUsed.clear();
    await this.controller.close();
  }

  private async pruneIdleChannels(keepChannel: string): Promise<void> {
    if (this.maxIdleChannels < 1) return;
    const overflow = this.channelLastUsed.size - this.maxIdleChannels;
    if (overflow <= 0) return;

    const candidates = [...this.channelLastUsed.entries()]
      .filter(
        ([channel]) =>
          channel !== keepChannel && !this.channelTails.has(channel),
      )
      .sort((left, right) => left[1] - right[1]);

    for (const [channel] of candidates.slice(0, overflow)) {
      this.channelLastUsed.delete(channel);
      await this.controller.disposeChannel(channel);
    }
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
      void closeQwenWebBrowserServiceIfCreated();
    });
  }
  return singleton;
}

/**
 * Process-level cleanup entry point. Crucially, this never creates the browser
 * service merely because the process is exiting.
 */
export async function closeQwenWebBrowserServiceIfCreated(): Promise<void> {
  const current = singleton;
  singleton = undefined;
  if (current) await current.close();
}

/** @internal - test hook. */
export async function resetQwenWebBrowserServiceForTests(): Promise<void> {
  await closeQwenWebBrowserServiceIfCreated();
}
