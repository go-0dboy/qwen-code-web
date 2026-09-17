/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import { describe, expect, it } from 'vitest';
import type { QwenWebBrowserServiceLike } from './browserService.js';
import { QwenWebContentGenerator } from './qwenWebContentGenerator.js';

class DirtyBrowserService implements QwenWebBrowserServiceLike {
  readonly prompts: string[] = [];
  resetCount = 0;
  nextError?: Error;
  private pageEpoch = 1;

  async withChannel<T>(
    _channel: string,
    _signal: AbortSignal | undefined,
    operation: Parameters<QwenWebBrowserServiceLike['withChannel']>[2],
  ): Promise<T> {
    return (await operation({
      prepare: async () => ({ browserEpoch: 1, pageEpoch: this.pageEpoch }),
      reset: async () => {
        this.resetCount += 1;
        this.pageEpoch += 1;
        return { browserEpoch: 1, pageEpoch: this.pageEpoch };
      },
      send: async (prompt) => {
        this.prompts.push(prompt);
        if (this.nextError) {
          const error = this.nextError;
          this.nextError = undefined;
          throw error;
        }
        return 'answer';
      },
    })) as T;
  }
}

function config(): Config {
  return { getSessionId: () => 'session-dirty' } as Config;
}

const firstHistory = [
  { role: 'user', parts: [{ text: 'first question' }] },
];
const secondHistory = [
  ...firstHistory,
  { role: 'model', parts: [{ text: 'answer' }] },
  { role: 'user', parts: [{ text: 'second question' }] },
];

describe('QwenWebContentGenerator dirty transport recovery', () => {
  it.each([
    ['provider failure', new Error('provider failed')],
    [
      'AbortError',
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    ],
  ])('forces replay after %s', async (_label, failure) => {
    const browser = new DirtyBrowserService();
    const generator = new QwenWebContentGenerator(
      { model: 'qwen3.8-max' },
      config(),
      browser,
    );

    await generator.generateContent(
      { model: 'qwen3.8-max', contents: firstHistory },
      'prompt-1',
    );
    expect(browser.resetCount).toBe(1);

    browser.nextError = failure;
    await expect(
      generator.generateContent(
        { model: 'qwen3.8-max', contents: secondHistory },
        'prompt-2',
      ),
    ).rejects.toBe(failure);

    await generator.generateContent(
      { model: 'qwen3.8-max', contents: secondHistory },
      'prompt-3',
    );

    expect(browser.resetCount).toBe(2);
    expect(browser.prompts).toHaveLength(3);
    expect(browser.prompts[1]).toContain('second question');
    expect(browser.prompts[2]).toContain('first question');
    expect(browser.prompts[2]).toContain('second question');
  });
});
