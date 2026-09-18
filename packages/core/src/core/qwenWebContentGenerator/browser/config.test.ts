/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ensureQwenWebBrowserDirectories,
  getQwenWebBrowserPaths,
  resolveQwenWebBrowserExecutable,
} from './config.js';

let tempDir: string;
let originalQwenHome: string | undefined;
let originalBrowserPath: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'qwen-web-config-'));
  originalQwenHome = process.env['QWEN_HOME'];
  originalBrowserPath = process.env['QWEN_WEB_BROWSER_PATH'];
  process.env['QWEN_HOME'] = tempDir;
  delete process.env['QWEN_WEB_BROWSER_PATH'];
});

afterEach(async () => {
  if (originalQwenHome === undefined) delete process.env['QWEN_HOME'];
  else process.env['QWEN_HOME'] = originalQwenHome;

  if (originalBrowserPath === undefined) {
    delete process.env['QWEN_WEB_BROWSER_PATH'];
  } else {
    process.env['QWEN_WEB_BROWSER_PATH'] = originalBrowserPath;
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe('Qwen Web browser config', () => {
  it('stores browser state below QWEN_HOME/qwen-web', async () => {
    const paths = await ensureQwenWebBrowserDirectories();
    expect(paths).toEqual(getQwenWebBrowserPaths());
    expect(paths.rootDir).toBe(path.join(tempDir, 'qwen-web'));
    expect(paths.profileDir).toBe(path.join(tempDir, 'qwen-web', 'browser-profile'));
    expect(paths.configPath).toBe(path.join(tempDir, 'qwen-web', 'browser.json'));

    if (process.platform !== 'win32') {
      expect((await stat(paths.rootDir)).mode & 0o777).toBe(0o700);
      expect((await stat(paths.profileDir)).mode & 0o777).toBe(0o700);
    }
  });

  it('honors QWEN_WEB_BROWSER_PATH and persists only the executable path', async () => {
    const executable = path.join(tempDir, 'test-browser');
    await writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(executable, 0o700);
    process.env['QWEN_WEB_BROWSER_PATH'] = executable;

    await expect(resolveQwenWebBrowserExecutable()).resolves.toBe(executable);

    const { configPath } = getQwenWebBrowserPaths();
    const metadata = JSON.parse(await readFile(configPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(metadata).toEqual({ executablePath: executable });
    if (process.platform !== 'win32') {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects a non-executable browser override', async () => {
    const executable = path.join(tempDir, 'not-executable');
    await writeFile(executable, 'not executable', 'utf8');
    if (process.platform !== 'win32') await chmod(executable, 0o600);
    process.env['QWEN_WEB_BROWSER_PATH'] = executable;

    await expect(resolveQwenWebBrowserExecutable()).rejects.toThrow(
      'QWEN_WEB_BROWSER_PATH points to a browser that is not executable',
    );
  });
});
