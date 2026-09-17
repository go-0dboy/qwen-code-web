/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import { describe, expect, it } from 'vitest';
import type {
  QwenWebBrowserServiceLike,
  QwenWebChannelSession,
} from './browserService.js';
import { QwenWebContentGenerator } from './qwenWebContentGenerator.js';

class LifecycleBrowserService implements QwenWebBrowserServiceLike {
  readonly channels: string[] = [];
  readonly disposed: string[] = [];
  private pageEpoch = 0;

  async withChannel<T>(
    channel: string,
    _signal: AbortSignal | undefined,
    operation: (session: QwenWebChannelSession) => Promise<T>,
  ): Promise<T> {
    this.channels.push(channel);
    const session: QwenWebChannelSession = {
      prepare: async () => ({ browserEpoch: 1, pageEpoch: this.pageEpoch }),
      reset: async () => {
        this.pageEpoch += 1;
        return { browserEpoch: 1, pageEpoch: this.pageEpoch };
      },
      send: async () => 'answer',
    };
    return operation(session);
  }

  async disposeChannel(channel: string): Promise<void> {
    this.disposed.push(channel);
  }
}

const history = [{ role: 'user', parts: [{ text: 'question' }] }];

describe('QwenWebContentGenerator channel lifecycle', () => {
  it('disposes the old main channel when Qwen Code changes session id', async () => {
    let sessionId = 'session-one';
    const config = { getSessionId: () => sessionId } as Config;
    const browser = new LifecycleBrowserService();
    const generator = new QwenWebContentGenerator(
      { model: 'qwen3.8-max' },
      config,
      browser,
    );

    await generator.generateContent(
      { model: 'qwen3.8-max', contents: history },
      'prompt-1',
    );
    sessionId = 'session-two';
    await generator.generateContent(
      { model: 'qwen3.8-max', contents: history },
      'prompt-2',
    );

    expect(browser.channels).toEqual(['session-one:main', 'session-two:main']);
    expect(browser.disposed).toEqual(['session-one:main']);
  });
});
