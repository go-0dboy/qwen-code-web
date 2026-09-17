/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, Part } from '@google/genai';
import {
  extractQwenWebHostTools,
  qwenWebToolProtocolPreamble,
  serializeQwenWebFunctionCall,
  serializeQwenWebFunctionResponse,
  type QwenWebHostTool,
} from './tool-protocol.js';

export interface QwenWebPromptContext {
  systemInstruction: unknown;
  tools: unknown;
}

function describeUnsupportedPart(part: Part): string {
  if (part.inlineData) {
    return `inlineData (${part.inlineData.mimeType ?? 'unknown mime type'})`;
  }
  if (part.fileData) {
    return `fileData (${part.fileData.mimeType ?? 'unknown mime type'})`;
  }
  return Object.keys(part).join(', ') || 'unknown part';
}

function serializePart(part: Part): string {
  if (typeof part.text === 'string') return part.text;
  if (part.functionCall) {
    return serializeQwenWebFunctionCall({
      name: part.functionCall.name,
      id: part.functionCall.id,
      args: part.functionCall.args,
    });
  }
  if (part.functionResponse) {
    return serializeQwenWebFunctionResponse({
      name: part.functionResponse.name,
      id: part.functionResponse.id,
      response: part.functionResponse.response,
    });
  }

  throw new Error(
    `Qwen Web browser provider supports text-only transport; unsupported content part: ${describeUnsupportedPart(part)}.`,
  );
}

function contentRole(content: Content): string {
  return content.role === 'model' ? 'ASSISTANT' : 'USER';
}

export function serializeQwenWebContent(content: Content): string {
  const parts = content.parts ?? [];
  const serialized = parts.map(serializePart).filter((value) => value.length > 0);
  return `${contentRole(content)}\n${serialized.join('\n')}`;
}

export function serializeQwenWebContents(contents: readonly Content[]): string {
  return contents.map(serializeQwenWebContent).join('\n\n');
}

function serializeSystemInstruction(systemInstruction: unknown): string {
  if (!systemInstruction) return '(none)';
  if (typeof systemInstruction === 'string') return systemInstruction;
  if (Array.isArray(systemInstruction)) {
    return systemInstruction
      .map((value) =>
        typeof value === 'string'
          ? value
          : value && typeof value === 'object' && 'text' in value
            ? String((value as { text?: unknown }).text ?? '')
            : JSON.stringify(value),
      )
      .join('\n');
  }
  if (typeof systemInstruction === 'object') {
    const record = systemInstruction as { parts?: Part[]; text?: unknown };
    if (record.parts) return record.parts.map(serializePart).join('\n');
    if (typeof record.text === 'string') return record.text;
  }
  return JSON.stringify(systemInstruction);
}

export function qwenWebPromptSignature(context: QwenWebPromptContext): string {
  const tools = extractQwenWebHostTools(context.tools);
  return JSON.stringify({
    systemInstruction: serializeSystemInstruction(context.systemInstruction),
    tools,
  });
}

export function buildQwenWebReplayPrompt(
  contents: readonly Content[],
  context: QwenWebPromptContext,
): string {
  const tools: QwenWebHostTool[] = extractQwenWebHostTools(context.tools);
  return [
    qwenWebToolProtocolPreamble(tools),
    '',
    'QWEN CODE SYSTEM INSTRUCTION',
    serializeSystemInstruction(context.systemInstruction),
    '',
    'QWEN CODE CANONICAL CONVERSATION',
    serializeQwenWebContents(contents),
    '',
    'Continue from the final USER message above. Do not repeat the transcript.',
  ].join('\n');
}

export function buildQwenWebDeltaPrompt(contents: readonly Content[]): string {
  return serializeQwenWebContents(contents);
}
