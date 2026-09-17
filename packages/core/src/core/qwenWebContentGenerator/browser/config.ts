/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants } from 'node:fs';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../../../config/storage.js';

const QWEN_WEB_DIR = 'qwen-web';
const BROWSER_CONFIG_FILE = 'browser.json';
const BROWSER_PROFILE_DIR = 'browser-profile';

export interface QwenWebBrowserPaths {
  rootDir: string;
  configPath: string;
  profileDir: string;
}

interface BrowserMetadata {
  executablePath?: string;
}

export function getQwenWebBrowserPaths(): QwenWebBrowserPaths {
  const rootDir = path.join(Storage.getGlobalQwenDir(), QWEN_WEB_DIR);
  return {
    rootDir,
    configPath: path.join(rootDir, BROWSER_CONFIG_FILE),
    profileDir: path.join(rootDir, BROWSER_PROFILE_DIR),
  };
}

async function canExecute(candidate: string): Promise<boolean> {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function browserCandidates(): string[] {
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? '';
    const programFiles = process.env['PROGRAMFILES'] ?? '';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? '';
    return [
      path.join(local, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Chromium', 'Application', 'chrome.exe'),
    ].filter(Boolean);
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/Yandex Browser.app/Contents/MacOS/Yandex Browser',
      '/Applications/Yandex.app/Contents/MacOS/Yandex',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(
        os.homedir(),
        'Applications',
        'Google Chrome.app',
        'Contents',
        'MacOS',
        'Google Chrome',
      ),
    ];
  }

  return [
    '/usr/bin/yandex-browser',
    '/usr/bin/yandex-browser-stable',
    '/opt/yandex/browser/yandex-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

async function readBrowserMetadata(
  configPath: string,
): Promise<BrowserMetadata | undefined> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as BrowserMetadata;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function persistBrowserMetadata(
  configPath: string,
  executablePath: string,
): Promise<void> {
  await writeFile(
    configPath,
    `${JSON.stringify({ executablePath }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(configPath, 0o600).catch(() => undefined);
}

export async function ensureQwenWebBrowserDirectories(): Promise<QwenWebBrowserPaths> {
  const paths = getQwenWebBrowserPaths();
  await mkdir(paths.rootDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.profileDir, { recursive: true, mode: 0o700 });
  await chmod(paths.rootDir, 0o700).catch(() => undefined);
  await chmod(paths.profileDir, 0o700).catch(() => undefined);
  return paths;
}

export async function resolveQwenWebBrowserExecutable(): Promise<string> {
  const paths = await ensureQwenWebBrowserDirectories();
  const override = process.env['QWEN_WEB_BROWSER_PATH']?.trim();
  if (override) {
    if (!(await canExecute(override))) {
      throw new Error(
        `QWEN_WEB_BROWSER_PATH points to a browser that is not executable: ${override}`,
      );
    }
    await persistBrowserMetadata(paths.configPath, override);
    return override;
  }

  const previous = await readBrowserMetadata(paths.configPath);
  if (previous?.executablePath && (await canExecute(previous.executablePath))) {
    return previous.executablePath;
  }

  for (const candidate of browserCandidates()) {
    if (candidate && (await canExecute(candidate))) {
      await persistBrowserMetadata(paths.configPath, candidate);
      return candidate;
    }
  }

  throw new Error(
    'Qwen Web browser provider could not find Yandex Browser, Google Chrome, or Chromium. Install one of them or set QWEN_WEB_BROWSER_PATH.',
  );
}
