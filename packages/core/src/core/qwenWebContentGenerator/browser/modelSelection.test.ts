/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  assertQwenWebModelSelection,
  normalizeQwenWebModelName,
} from './modelSelection.js';

describe('Qwen Web model selection verification', () => {
  it('normalizes punctuation and case used by the web UI', () => {
    expect(normalizeQwenWebModelName('Qwen 3.8 Max')).toBe('qwen38max');
    expect(normalizeQwenWebModelName('qwen3.8-max')).toBe('qwen38max');
    expect(() =>
      assertQwenWebModelSelection('qwen3.8-max', 'Qwen 3.8 Max'),
    ).not.toThrow();
  });

  it('fails loudly when Qwen Web selected a different model', () => {
    expect(() =>
      assertQwenWebModelSelection('qwen3.8-max', 'Qwen 3.7 Coder'),
    ).toThrow(
      "Qwen Web model mismatch: requested 'qwen3.8-max', selected 'Qwen 3.7 Coder'.",
    );
  });
});
