/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  QwenWebBrowserService,
  type QwenWebBrowserController,
} from './browser-service.js';
import type { QwenWebTransportState } from './browser/types.js';

interface PendingSend {
  channel: string;
  resolve(text: string): void;
}

const transport: QwenWebTransportState = { browserEpoch: 1, pageEpoch: 1 };

class FakeController implements QwenWebBrowserController {
  readonly sendCalls: string[] = [];
  readonly stopCalls: string[] = [];
  readonly disposedChannels: string[] = [];
  closeCalls = 0;
  private readonly pending: PendingSend[] = [];
  private pageEpoch = 0;

  async prepareChannel() {
    this.pageEpoch += 1;
    return { browserEpoch: 1, pageEpoch: this.pageEpoch };
  }

  async newConversation() {
    this.pageEpoch += 1;
    return { browserEpoch: 1, pageEpoch: this.pageEpoch };
  }

  async sendPrompt(channel: string): Promise<string> {
    this.sendCalls.push(channel);
    return new Promise<string>((resolve) => {
      this.pending.push({ channel, resolve });
    });
  }

  async stopGeneration(channel: string): Promise<void> {
    this.stopCalls.push(channel);
  }

  async disposeChannel(channel: string): Promise<void> {
    this.disposedChannels.push(channel);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  resolveNext(channel: string, text: string): void {
    const index = this.pending.findIndex((entry) => entry.channel === channel);
    if (index < 0) throw new Error(`No pending send for ${channel}`);
    const [entry] = this.pending.splice(index, 1);
    entry!.resolve(text);
  }
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition was not reached.');
}

describe('QwenWebBrowserService cancellation ownership', () => {
  it('does not stop the active request when a queued request is aborted', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);

    const active = service.withChannel('same', undefined, (session) =>
      session.send('first', 'qwen3.8-max', transport),
    );
    await eventually(() => controller.sendCalls.length === 1);

    const queuedAbort = new AbortController();
    const queued = service.withChannel('same', queuedAbort.signal, (session) =>
      session.send('second', 'qwen3.8-max', transport),
    );
    queuedAbort.abort();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.stopCalls).toEqual([]);
    expect(controller.sendCalls).toEqual(['same']);

    controller.resolveNext('same', 'first-result');
    await expect(active).resolves.toBe('first-result');
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.sendCalls).toEqual(['same']);
  });

  it('stops exactly once and rejects partial output when the active send is aborted', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);
    const abort = new AbortController();

    const request = service.withChannel('active', abort.signal, (session) =>
      session.send('prompt', 'qwen3.8-max', transport),
    );
    await eventually(() => controller.sendCalls.length === 1);

    abort.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.stopCalls).toEqual(['active']);
  });

  it('serializes sends in the same channel', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);

    const first = service.withChannel('same', undefined, (session) =>
      session.send('first', 'qwen3.8-max', transport),
    );
    const second = service.withChannel('same', undefined, (session) =>
      session.send('second', 'qwen3.8-max', transport),
    );

    await eventually(() => controller.sendCalls.length === 1);
    controller.resolveNext('same', 'one');
    await expect(first).resolves.toBe('one');
    await eventually(() => controller.sendCalls.length === 2);
    controller.resolveNext('same', 'two');
    await expect(second).resolves.toBe('two');
  });

  it('allows different channels to send concurrently', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);

    const first = service.withChannel('a', undefined, (session) =>
      session.send('first', 'qwen3.8-max', transport),
    );
    const second = service.withChannel('b', undefined, (session) =>
      session.send('second', 'qwen3.8-max', transport),
    );

    await eventually(() => controller.sendCalls.length === 2);
    expect(controller.sendCalls).toEqual(expect.arrayContaining(['a', 'b']));
    controller.resolveNext('a', 'one');
    controller.resolveNext('b', 'two');
    await expect(first).resolves.toBe('one');
    await expect(second).resolves.toBe('two');
  });
});

describe('QwenWebBrowserService lifecycle', () => {
  it('disposes an explicit channel without closing the shared browser', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);

    await service.disposeChannel('session-old:main');

    expect(controller.disposedChannels).toEqual(['session-old:main']);
    expect(controller.closeCalls).toBe(0);
  });

  it('prunes the oldest idle channel when the configured cap is exceeded', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller, 1);

    await service.withChannel('old', undefined, (session) =>
      session.prepare('qwen3.8-max'),
    );
    await service.withChannel('new', undefined, (session) =>
      session.prepare('qwen3.8-max'),
    );

    expect(controller.disposedChannels).toEqual(['old']);
  });

  it('closes the process-wide controller idempotently', async () => {
    const controller = new FakeController();
    const service = new QwenWebBrowserService(controller);

    await service.close();
    await service.close();

    expect(controller.closeCalls).toBe(1);
  });
});
