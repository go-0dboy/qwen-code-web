/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import { describe, expect, it } from 'vitest';
import type { QwenWebBrowserServiceLike } from './browser-service.js';
import { QwenWebTransportResetError } from './browser/types.js';
import { QwenWebContentGenerator } from './qwen-web-content-generator.js';

class FakeBrowserService implements QwenWebBrowserServiceLike {
  readonly prompts: string[] = [];
  readonly expectedEpochs: string[] = [];
  resetCount = 0;
  failuresRemaining = 0;
  private pageEpoch = 1;
  private response = 'first answer';

  setResponse(response: string): void {
    this.response = response;
  }

  async withChannel<T>(
    _channel: string,
    _signal: AbortSignal | undefined,
    operation: Parameters<QwenWebBrowserServiceLike['withChannel']>[2],
  ): Promise<T> {
    const result = await operation({
      prepare: async () => ({ browserEpoch: 1, pageEpoch: this.pageEpoch }),
      reset: async () => {
        this.resetCount += 1;
        this.pageEpoch += 1;
        return { browserEpoch: 1, pageEpoch: this.pageEpoch };
      },
      send: async (prompt, _model, expectedTransport) => {
        this.prompts.push(prompt);
        this.expectedEpochs.push(
          `${expectedTransport.browserEpoch}:${expectedTransport.pageEpoch}`,
        );
        if (this.failuresRemaining > 0) {
          this.failuresRemaining -= 1;
          throw new QwenWebTransportResetError('simulated page loss');
        }
        return this.response;
      },
    });
    return result as T;
  }
}

function config(sessionId = 'session-1'): Config {
  return { getSessionId: () => sessionId } as Config;
}

describe('QwenWebContentGenerator transport reset recovery', () => {
  it('replays canonical history instead of sending only delta after page loss', async () => {
    const browser = new FakeBrowserService();
    const generator = new QwenWebContentGenerator(
      { model: 'qwen3.8-max' },
      config(),
      browser,
    );

    await generator.generateContent(
      {
        model: 'qwen3.8-max',
        contents: [{ role: 'user', parts: [{ text: 'first question' }] }],
      },
      'prompt-1',
    );

    browser.failuresRemaining = 1;
    browser.setResponse('recovered answer');
    await generator.generateContent(
      {
        model: 'qwen3.8-max',
        contents: [
          { role: 'user', parts: [{ text: 'first question' }] },
          { role: 'model', parts: [{ text: 'first answer' }] },
          { role: 'user', parts: [{ text: 'second question' }] },
        ],
      },
      'prompt-2',
    );

    expect(browser.prompts).toHaveLength(3);
    expect(browser.prompts[1]).toContain('second question');
    expect(browser.prompts[2]).toContain('first question');
    expect(browser.prompts[2]).toContain('first answer');
    expect(browser.prompts[2]).toContain('second question');
    expect(browser.resetCount).toBe(2);
    expect(browser.expectedEpochs).toEqual(['1:2', '1:2', '1:3']);
  });

  it('retries a transport reset only once', async () => {
    const browser = new FakeBrowserService();
    const generator = new QwenWebContentGenerator(
      { model: 'qwen3.8-max' },
      config('session-2'),
      browser,
    );
    browser.failuresRemaining = 2;

    await expect(
      generator.generateContent(
        {
          model: 'qwen3.8-max',
          contents: [{ role: 'user', parts: [{ text: 'question' }] }],
        },
        'prompt',
      ),
    ).rejects.toBeInstanceOf(QwenWebTransportResetError);

    expect(browser.prompts).toHaveLength(2);
    expect(browser.resetCount).toBe(2);
  });
});
