/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closeIfCreated: vi.fn(async () => undefined),
}));

vi.mock('./browserService.js', () => ({
  closeQwenWebBrowserServiceIfCreated: mocks.closeIfCreated,
}));

import { closeQwenWebProcessResources } from './lifecycle.js';

describe('Qwen Web process lifecycle bridge', () => {
  it('delegates to close-if-created without requesting the singleton', async () => {
    await closeQwenWebProcessResources();

    expect(mocks.closeIfCreated).toHaveBeenCalledTimes(1);
  });
});
