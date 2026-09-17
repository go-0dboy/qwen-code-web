/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { FunctionCall, Part } from '@google/genai';
import type { Config } from '../../config/config.js';
import { LlmChat, StreamEventType } from '../llm-chat.js';
import type { ContentGeneratorConfig } from '../contentGenerator.js';
import { QwenWebContentGenerator } from './qwenWebContentGenerator.js';
import type {
  QwenWebBrowserServiceLike,
  QwenWebChannelSession,
} from './browserService.js';
import type { QwenWebTransportState } from './browser/types.js';

const MODEL = 'qwen3.8-max';
const TRANSPORT: QwenWebTransportState = { browserEpoch: 1, pageEpoch: 1 };

class ScriptedBrowserService implements QwenWebBrowserServiceLike {
  readonly prompts: string[] = [];
  readonly channels: string[] = [];

  constructor(private readonly responses: string[]) {}

  async withChannel<T>(
    channel: string,
    _signal: AbortSignal | undefined,
    operation: (session: QwenWebChannelSession) => Promise<T>,
  ): Promise<T> {
    this.channels.push(channel);
    const session: QwenWebChannelSession = {
      prepare: async () => TRANSPORT,
      reset: async () => TRANSPORT,
      send: async (prompt) => {
        this.prompts.push(prompt);
        const response = this.responses.shift();
        if (response === undefined) {
          throw new Error('Scripted browser response queue is empty.');
        }
        return response;
      },
    };
    return operation(session);
  }

  async disposeChannel(): Promise<void> {}
}

function makeConfig(
  generator: QwenWebContentGenerator,
  sessionId = 'stage9-session',
): Config {
  return {
    getSessionId: () => sessionId,
    getTelemetryLogPromptsEnabled: () => false,
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getContentGeneratorConfig: vi.fn().mockReturnValue({
      authType: 'qwen-web',
      model: MODEL,
    }),
    getModel: vi.fn().mockReturnValue(MODEL),
    getModelRouteIdentity: vi.fn().mockReturnValue(`${MODEL}@qwen-web`),
    setModel: vi.fn(),
    getProjectRoot: vi.fn().mockReturnValue('/test/project'),
    getTargetDir: vi.fn().mockReturnValue('/test/project'),
    getCliVersion: vi.fn().mockReturnValue('test'),
    storage: {
      getProjectTempDir: vi.fn().mockReturnValue('/test/temp'),
    },
    getToolRegistry: vi.fn().mockReturnValue({ getTool: vi.fn() }),
    getContentGenerator: vi.fn().mockReturnValue(generator),
    getEffectiveInputModalities: vi.fn().mockReturnValue({}),
    getBaseLlmClient: vi.fn().mockReturnValue(undefined),
    getModelFallbacks: vi.fn().mockReturnValue([]),
    getChatCompression: vi.fn().mockReturnValue(undefined),
    getClearContextOnIdle: vi.fn().mockReturnValue({
      toolResultsThresholdMinutes: 30,
      toolResultsNumToKeep: 1,
    }),
    getAutoCompactThreshold: vi.fn().mockReturnValue(undefined),
    getHookSystem: vi.fn().mockReturnValue(undefined),
    getDebugLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getApprovalMode: vi.fn().mockReturnValue('default'),
    takePendingManualPlanExitNotice: vi.fn().mockReturnValue(undefined),
    restorePendingManualPlanExitNotice: vi.fn(),
    getFileReadCache: vi.fn().mockReturnValue({ clear: vi.fn() }),
    getRestoreAskUserQuestion: vi.fn().mockReturnValue(false),
  } as unknown as Config;
}

function makeHarness(responses: string[]) {
  const browser = new ScriptedBrowserService(responses);
  let config!: Config;
  const generator = new QwenWebContentGenerator(
    {
      authType: 'qwen-web',
      model: MODEL,
    } as ContentGeneratorConfig,
    {
      getSessionId: () => config.getSessionId(),
    } as Config,
    browser,
  );
  config = makeConfig(generator);
  const chat = new LlmChat(
    config,
    {
      tools: [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file from the host workspace.',
              parametersJsonSchema: {
                type: 'object',
                properties: { file_path: { type: 'string' } },
                required: ['file_path'],
              },
            },
          ],
        },
      ],
    },
    [],
  );
  return { browser, chat };
}

async function drainTurn(
  chat: LlmChat,
  message: string | Part[],
  promptId: string,
): Promise<{ calls: FunctionCall[]; texts: string[] }> {
  const stream = await chat.sendMessageStream(
    MODEL,
    { message },
    promptId,
  );
  const calls: FunctionCall[] = [];
  const texts: string[] = [];
  for await (const event of stream) {
    if (event.type !== StreamEventType.CHUNK) continue;
    for (const part of event.value.candidates?.[0]?.content?.parts ?? []) {
      if (part.functionCall) calls.push(part.functionCall);
      if (part.text) texts.push(part.text);
    }
  }
  return { calls, texts };
}

function fakeHostTool(call: FunctionCall, output: string): Part {
  return {
    functionResponse: {
      id: call.id,
      name: call.name,
      response: { output },
    },
  };
}

describe('Qwen Web host-tool integration', () => {
  it('round-trips recovered XML through FunctionCall and FunctionResponse to a final answer', async () => {
    const { browser, chat } = makeHarness([
      '<invoke name="read_file"><parameter name="file_path">src/a.ts</parameter></invoke>',
      'The file exports answer = 42.',
    ]);

    const first = await drainTurn(chat, 'Read src/a.ts and summarize it.', 'stage9-1');
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]).toMatchObject({
      name: 'read_file',
      args: { file_path: 'src/a.ts' },
    });

    const toolResult = fakeHostTool(
      first.calls[0]!,
      'export const answer = 42;',
    );
    const second = await drainTurn(chat, [toolResult], 'stage9-2');

    expect(second.calls).toHaveLength(0);
    expect(second.texts.join('')).toContain('answer = 42');
    expect(browser.prompts).toHaveLength(2);
    expect(browser.prompts[0]).toContain('AVAILABLE QWEN CODE HOST TOOLS');
    expect(browser.prompts[0]).toContain('read_file');
    expect(browser.prompts[1]).toContain('QWEN CODE HOST TOOL RESULT');
    expect(browser.prompts[1]).toContain('tool: read_file');
    expect(browser.prompts[1]).toContain('export const answer = 42;');
    expect(browser.channels).toEqual([
      'stage9-session:main',
      'stage9-session:main',
    ]);
  });

  it('supports multiple sequential host tools before the final answer', async () => {
    const { browser, chat } = makeHarness([
      '<invoke name="read_file"><parameter name="file_path">src/a.ts</parameter></invoke>',
      '<invoke name="read_file"><parameter name="file_path">src/b.ts</parameter></invoke>',
      'Both files were inspected; a.ts imports b.ts.',
    ]);

    const first = await drainTurn(chat, 'Inspect both related files.', 'stage9-multi-1');
    expect(first.calls[0]?.args).toEqual({ file_path: 'src/a.ts' });

    const second = await drainTurn(
      chat,
      [fakeHostTool(first.calls[0]!, "import { b } from './b.js';")],
      'stage9-multi-2',
    );
    expect(second.calls[0]?.args).toEqual({ file_path: 'src/b.ts' });

    const third = await drainTurn(
      chat,
      [fakeHostTool(second.calls[0]!, 'export const b = 1;')],
      'stage9-multi-3',
    );
    expect(third.calls).toHaveLength(0);
    expect(third.texts.join('')).toContain('a.ts imports b.ts');
    expect(browser.prompts).toHaveLength(3);
    expect(browser.prompts[1]).toContain("import { b } from './b.js';");
    expect(browser.prompts[2]).toContain('export const b = 1;');
  });
});
