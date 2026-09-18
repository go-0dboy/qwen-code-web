/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QwenWebBrowserService,
  getQwenWebBrowserService,
  resetQwenWebBrowserServiceForTests,
  type QwenWebBrowserController,
} from './browserService.js';
import type { QwenWebTransportState } from './browser/types.js';

const STATE: QwenWebTransportState = { browserEpoch: 1, pageEpoch: 1 };

class FakeController implements QwenWebBrowserController {
  stopCalls: string[] = [];
  sendCalls = 0;
  closeCalls = 0;

  async prepareChannel(): Promise<QwenWebTransportState> {
    return STATE;
  }

  async newConversation(): Promise<QwenWebTransportState> {
    return STATE;
  }

  async sendPrompt(
    _channel: string,
    _prompt: string,
    _model: string,
    signal?: AbortSignal,
  ): Promise<string> {
    this.sendCalls += 1;
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      signal?.addEventListener(
        'abort',
        () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true },
      );
      // Deliberately never resolve: cancellation must terminate the request.
      void resolve;
    });
  }

  async stopGeneration(channel: string): Promise<void> {
    this.stopCalls.push(channel);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

afterEach(async () => {
  await resetQwenWebBrowserServiceForTests();
});

describe('QwenWebBrowserService', () => {
  it('returns one process-wide singleton', () => {
    expect(getQwenWebBrowserService()).toBe(getQwenWebBrowserService());
  });

  it('cancels an in-flight request out of band and returns AbortError', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);
    const abortController = new AbortController();

    const request = service.withChannel(
      'session:main',
      abortController.signal,
      async (session) => session.send('hello', 'qwen3.8-max'),
    );

    await vi.waitFor(() => expect(controller.sendCalls).toBe(1));
    abortController.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.stopCalls).toContain('session:main');
    await service.close();
    expect(controller.closeCalls).toBe(1);
  });

  it('does not let one channel queue block a different channel', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);
    let releaseMain!: () => void;
    const mainGate = new Promise<void>((resolve) => {
      releaseMain = resolve;
    });
    const events: string[] = [];

    const main = service.withChannel('session:main', undefined, async () => {
      events.push('main-start');
      await mainGate;
      events.push('main-end');
    });
    const subagent = service.withChannel(
      'session:subagent-1',
      undefined,
      async () => {
        events.push('subagent');
      },
    );

    await subagent;
    expect(events).toEqual(['main-start', 'subagent']);
    releaseMain();
    await main;
    await service.close();
  });
});
