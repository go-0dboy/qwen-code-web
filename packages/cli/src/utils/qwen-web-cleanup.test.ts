/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closeProcessResources: vi.fn(async () => undefined),
}));

vi.mock(
  '@qwen-code/qwen-code-core/core/qwenWebContentGenerator/lifecycle.js',
  () => ({
    closeQwenWebProcessResources: mocks.closeProcessResources,
  }),
);

import {
  _resetCleanupFunctionsForTest,
  runExitCleanup,
} from './cleanup.js';

afterEach(() => {
  _resetCleanupFunctionsForTest();
  mocks.closeProcessResources.mockClear();
});

describe('Qwen Web process cleanup integration', () => {
  it('runs browser cleanup through the shared bounded exit chain', async () => {
    await runExitCleanup({
      _testPerFnTimeoutMs: 100,
      _testOverallTimeoutMs: 500,
    });

    expect(mocks.closeProcessResources).toHaveBeenCalledTimes(1);
  });
});
