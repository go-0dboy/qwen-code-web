/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installQwenWebPageRuntime } from './pageRuntime.js';
import type { QwenWebPageBridge } from './types.js';

type BridgeWindow = Window & { __qwenCodeWebBridge?: QwenWebPageBridge };

const visibleRect = {
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  top: 0,
  right: 100,
  bottom: 20,
  left: 0,
  toJSON: () => ({}),
};

function bridge(): QwenWebPageBridge {
  const value = (window as BridgeWindow).__qwenCodeWebBridge;
  if (!value) throw new Error('Qwen Web page bridge was not installed.');
  return value;
}

function prepared() {
  return { baselineCount: 0, baselineText: '', accepted: true };
}

describe('installQwenWebPageRuntime response completion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.innerHTML = '<head></head><body></body>';
    delete (window as BridgeWindow).__qwenCodeWebBridge;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      visibleRect as DOMRect,
    );
    installQwenWebPageRuntime();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (window as BridgeWindow).__qwenCodeWebBridge;
  });

  it('completes a fully closed invoke once the response is stable and Stop is absent', async () => {
    const response = document.createElement('div');
    response.className = 'response-message-content';
    document.body.appendChild(response);

    const result = bridge().waitForResponse(prepared());
    response.textContent =
      '<invoke name="read_file"><parameter name="file_path">src/index.ts</parameter></invoke>';

    await vi.advanceTimersByTimeAsync(700);
    await expect(result).resolves.toContain('<invoke name="read_file">');
  });

  it('does not return a closed invoke while Qwen Web still exposes an active Stop button', async () => {
    const response = document.createElement('div');
    response.className = 'response-message-content';
    document.body.appendChild(response);

    const stop = document.createElement('button');
    stop.className = 'stop-button';
    stop.textContent = 'Stop';
    document.body.appendChild(stop);

    let settled = false;
    const result = bridge()
      .waitForResponse(prepared())
      .then((value) => {
        settled = true;
        return value;
      });

    response.textContent =
      '<invoke name="read_file"><parameter name="file_path">src/index.ts</parameter></invoke>';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);

    stop.remove();
    await vi.advanceTimersByTimeAsync(700);
    await expect(result).resolves.toContain('<invoke name="read_file">');
  });
});
