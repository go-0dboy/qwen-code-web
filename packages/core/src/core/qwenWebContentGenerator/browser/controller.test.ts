/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildQwenWebBrowserLaunchOptions,
  qwenWebModelLabelMatches,
} from './controller.js';

describe('Qwen Web browser controller helpers', () => {
  it('uses hardened Puppeteer launch options', () => {
    const options = buildQwenWebBrowserLaunchOptions(
      '/browser',
      '/profile',
      true,
    );

    expect(options.executablePath).toBe('/browser');
    expect(options.userDataDir).toBe('/profile');
    expect(options.headless).toBe(true);
    expect(options.defaultViewport).toBeNull();
    expect(options.protocolTimeout).toBe(30 * 60_000);
    expect(options.handleSIGINT).toBe(false);
    expect(options.handleSIGTERM).toBe(false);
    expect(options.handleSIGHUP).toBe(false);
    expect(options.args).toEqual(
      expect.arrayContaining([
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ]),
    );
  });

  it('accepts decorated Qwen Web labels without accepting a different model', () => {
    expect(
      qwenWebModelLabelMatches('Qwen3.8-Max (Recommended)', 'qwen3.8-max'),
    ).toBe(true);
    expect(qwenWebModelLabelMatches('Qwen 3.8 Max', 'qwen3.8-max')).toBe(
      true,
    );
    expect(qwenWebModelLabelMatches('Qwen3.8-Plus', 'qwen3.8-max')).toBe(
      false,
    );
  });
});
