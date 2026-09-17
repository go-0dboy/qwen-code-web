/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Content,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import type { Config } from '../../config/config.js';
import { getTeammateContext } from '../../agents/team/identity.js';
import { subagentIdentityContext } from '../../utils/subagentNameContext.js';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../contentGenerator.js';
import {
  getQwenWebBrowserService,
  type QwenWebBrowserServiceLike,
} from './browserService.js';
import {
  QwenWebTransportResetError,
  transportEpochKey,
} from './browser/types.js';
import {
  ConversationSynchronizer,
  type ConversationSyncInput,
} from './conversationSynchronizer.js';
import {
  buildQwenWebDeltaPrompt,
  buildQwenWebReplayPrompt,
  qwenWebPromptSignature,
} from './promptSerializer.js';
import { createQwenWebGenerateContentResponse } from './responseFactory.js';

function isContent(value: unknown): value is Content {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'role' in value &&
      'parts' in value,
  );
}

function isPart(value: unknown): value is Part {
  return Boolean(value && typeof value === 'object' && !('role' in value));
}

function normalizeContents(
  contents: GenerateContentParameters['contents'],
): Content[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }
  if (!contents) return [];

  const values = Array.isArray(contents) ? contents : [contents];
  if (values.every(isContent)) return [...values];
  if (values.every((value) => typeof value === 'string' || isPart(value))) {
    const parts: Part[] = values.map((value) =>
      typeof value === 'string' ? { text: value } : value,
    );
    return [{ role: 'user', parts }];
  }

  throw new Error(
    'Qwen Web browser provider received an unsupported mixed content shape.',
  );
}

function channelOwner(): string {
  const subagent = subagentIdentityContext.getStore();
  if (subagent?.id) return subagent.id;
  const teammate = getTeammateContext();
  if (teammate?.agentId) return teammate.agentId;
  return 'main';
}

function createStream(
  response: Promise<GenerateContentResponse>,
): AsyncGenerator<GenerateContentResponse> {
  return (async function* () {
    yield await response;
  })();
}

export class QwenWebContentGenerator implements ContentGenerator {
  private readonly synchronizer = new ConversationSynchronizer();
  private readonly channelByOwner = new Map<string, string>();

  constructor(
    private readonly generatorConfig: ContentGeneratorConfig,
    private readonly config: Config,
    private readonly browserService: QwenWebBrowserServiceLike =
      getQwenWebBrowserService(),
  ) {}

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const model = request.model || this.generatorConfig.model;
    if (!model) {
      throw new Error('Qwen Web browser provider requires a model.');
    }

    const sessionId = this.config.getSessionId();
    const owner = channelOwner();
    const channel = `${sessionId}:${owner}`;
    const previousChannel = this.channelByOwner.get(owner);
    if (previousChannel && previousChannel !== channel) {
      this.synchronizer.reset(previousChannel);
      await this.browserService.disposeChannel?.(previousChannel);
    }
    this.channelByOwner.set(owner, channel);

    const contents = normalizeContents(request.contents);
    const promptContext = {
      systemInstruction: request.config?.systemInstruction,
      tools: request.config?.tools,
    };
    const systemSignature = qwenWebPromptSignature(promptContext);
    const signal = request.config?.abortSignal;

    let text: string;
    try {
      text = await this.browserService.withChannel(
        channel,
        signal,
        async (browserSession) => {
          let transport = await browserSession.prepare(model);
          let syncInput: ConversationSyncInput = {
            channel,
            sessionId,
            model,
            systemSignature,
            transportEpoch: transportEpochKey(transport),
            contents,
          };
          const plan = this.synchronizer.plan(syncInput);

          let prompt: string;
          if (plan.reset) {
            transport = await browserSession.reset(model);
            syncInput = {
              ...syncInput,
              transportEpoch: transportEpochKey(transport),
            };
            prompt = buildQwenWebReplayPrompt(
              plan.replay as readonly Content[],
              promptContext,
            );
          } else {
            prompt = buildQwenWebDeltaPrompt(plan.delta as readonly Content[]);
          }

          if (!prompt.trim()) {
            throw new Error(
              'Qwen Web browser provider produced an empty transport prompt from the canonical Qwen Code history.',
            );
          }

          let responseText: string;
          try {
            responseText = await browserSession.send(prompt, model, transport);
          } catch (error) {
            if (!(error instanceof QwenWebTransportResetError)) throw error;

            // A delta is unsafe after page/browser loss. Discard the transport
            // cache and retry exactly once in a fresh web chat with the full
            // canonical Qwen Code history.
            this.synchronizer.reset(channel);
            transport = await browserSession.reset(model);
            syncInput = {
              ...syncInput,
              transportEpoch: transportEpochKey(transport),
            };
            const replayPrompt = buildQwenWebReplayPrompt(
              contents,
              promptContext,
            );
            if (!replayPrompt.trim()) {
              throw new Error(
                'Qwen Web browser provider produced an empty replay prompt after a transport reset.',
              );
            }
            responseText = await browserSession.send(
              replayPrompt,
              model,
              transport,
            );
          }

          this.synchronizer.commit(syncInput);
          return responseText;
        },
      );
    } catch (error) {
      // A failed or cancelled turn may already have modified the browser chat
      // even though Qwen Code intentionally does not accept its partial model
      // output. Mark the transport cache invalid so the next request creates a
      // fresh web conversation and replays canonical Qwen Code history.
      this.synchronizer.reset(channel);
      throw error;
    }

    return createQwenWebGenerateContentResponse(text);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return createStream(this.generateContent(request, userPromptId));
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('Qwen Web browser provider does not support embeddings.');
  }
}
