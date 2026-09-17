/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';

export function createQwenWebGenerateContentResponse(
  text: string,
): GenerateContentResponse {
  return {
    candidates: [
      {
        index: 0,
        content: {
          role: 'model',
          parts: [{ text }],
        },
        finishReason: 'STOP',
      },
    ],
  } as GenerateContentResponse;
}
