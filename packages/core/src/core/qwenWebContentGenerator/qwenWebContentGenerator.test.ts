/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import type { Config } from '../../config/config.js';
import type { ContentGeneratorConfig } from '../contentGenerator.js';
import { subagentIdentityContext } from '../../utils/subagentNameContext.js';
import {
  QwenWebContentGenerator,
} from './qwenWebContentGenerator.js';
import type {
  QwenWebBrowserServiceLike,
  QwenWebChannelSession,
} from './browserService.js';
import type { QwenWebTransportState } from './browser/types.js';

const MODEL = 'qwen3.8-max';
const STATE: QwenWebTransportState = { browserEpoch: 1, pageEpoch: 1 };

class FakeBrowserService implements QwenWebBrowserServiceLike {
  channels: string[] = [];
  signals: Array<AbortSignal | undefined> = [];
  prompts: string[] = [];

  async withChannel<T>(
    channel: string,
    signal: AbortSignal | undefined,
    operation: (session: QwenWebChannelSession) => Promise<T>,
  ): Promise<T> {
    this.channels.push(channel);
    this.signals.push(signal);
    const session: QwenWebChannelSession = {
      prepare: async () => STATE,
      reset: async () => STATE,
      send: async (prompt) => {
        this.prompts.push(prompt);
        return 'final response';
      },
    };
    return operation(session);
  }
}

function createGenerator(service: FakeBrowserService): QwenWebContentGenerator {
  const generatorConfig = { model: MODEL } as ContentGeneratorConfig;
  const config = {
    getSessionId: () => 'session-123',
  } as Config;
  return new QwenWebContentGenerator(generatorConfig, config, service);
}

function textRequest(text: string): GenerateContentParameters {
  return {
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {},
  };
}

describe('QwenWebContentGenerator', () => {
  it('uses <sessionId>:main for the main agent', async () => {
    const service = new FakeBrowserService();
    const generator = createGenerator(service);

    await generator.generateContent(textRequest('hello'), 'prompt-1');

    expect(service.channels).toEqual(['session-123:main']);
    expect(service.prompts[0]).toContain('hello');
  });

  it('uses the invocation id to isolate parallel subagent conversations', async () => {
    const service = new FakeBrowserService();
    const generator = createGenerator(service);

    await subagentIdentityContext.run(
      { type: 'general-purpose', id: 'invoke-42', taskName: 'test' },
      () => generator.generateContent(textRequest('subagent task'), 'prompt-2'),
    );

    expect(service.channels).toEqual(['session-123:invoke-42']);
  });

  it('passes the request AbortSignal to the browser service', async () => {
    const service = new FakeBrowserService();
    const generator = createGenerator(service);
    const abortController = new AbortController();
    const request = textRequest('cancel me');
    request.config = { abortSignal: abortController.signal };

    await generator.generateContent(request, 'prompt-3');

    expect(service.signals).toEqual([abortController.signal]);
  });

  it('fails explicitly for unsupported media instead of dropping it', async () => {
    const service = new FakeBrowserService();
    const generator = createGenerator(service);
    const request: GenerateContentParameters = {
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'aGVsbG8=',
              },
            },
          ],
        },
      ],
      config: {},
    };

    await expect(generator.generateContent(request, 'prompt-4')).rejects.toThrow(
      'Qwen Web browser provider supports text-only transport; unsupported content part: inlineData (image/png).',
    );
  });

  it('reports embeddings as unsupported with the documented error', async () => {
    const service = new FakeBrowserService();
    const generator = createGenerator(service);

    await expect(
      generator.embedContent({ model: MODEL, contents: 'hello' }),
    ).rejects.toThrow(
      'Qwen Web browser provider does not support embeddings.',
    );
  });
});
