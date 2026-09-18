/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { AuthType } from '@qwen-code/qwen-code-core';
import { QWEN_WEB_DEFAULT_MODEL } from '@qwen-code/qwen-code-core/models/constants.js';
import { setNestedPropertySafe } from '../../config/settingsUtils.js';
import { useAuthCommand } from './useAuth.js';

vi.mock('../hooks/useQwenAuth.js', () => ({
  useQwenAuth: vi.fn(() => ({
    qwenAuthState: {},
    cancelQwenAuth: vi.fn(),
  })),
}));

vi.mock('../../config/modelProvidersScope.js', () => ({
  getPersistScopeForModelSelection: vi.fn(() => 'user'),
}));

function createSettings() {
  const file = {
    path: '/tmp/qwen-web-auth-test-settings.json',
    settings: { modelProviders: {} } as Record<string, unknown>,
    originalSettings: {} as Record<string, unknown>,
  };
  return {
    isTrusted: true,
    get merged() {
      return file.settings;
    },
    setValue: vi.fn((_scope: unknown, key: string, value: unknown) => {
      setNestedPropertySafe(file.settings, key, value);
      setNestedPropertySafe(file.originalSettings, key, value);
    }),
    recomputeMerged: vi.fn(),
    forScope: vi.fn(() => file),
  };
}

function createConfig(recordSlashCommand = vi.fn()) {
  const modelsConfig = {
    syncAfterAuthRefresh: vi.fn(),
  };
  return {
    getAuthType: vi.fn(() => AuthType.USE_OPENAI),
    getUsageStatisticsEnabled: vi.fn(() => false),
    reloadModelProvidersConfig: vi.fn(),
    refreshAuth: vi.fn(async () => undefined),
    getModelsConfig: vi.fn(() => modelsConfig),
    getChatRecordingService: vi.fn(() => ({ recordSlashCommand })),
  };
}

describe('Qwen Web auth flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('accepts qwen-web as QWEN_DEFAULT_AUTH_TYPE', () => {
    vi.stubEnv('QWEN_DEFAULT_AUTH_TYPE', AuthType.QWEN_WEB);
    const { result } = renderHook(() =>
      useAuthCommand(createSettings() as never, createConfig() as never, vi.fn()),
    );

    expect(result.current.authError).toBeNull();
  });

  it('configures qwen-web without API credentials or base URL', async () => {
    const settings = createSettings();
    const recordSlashCommand = vi.fn();
    const config = createConfig(recordSlashCommand);
    const addItem = vi.fn();
    const { result } = renderHook(() =>
      useAuthCommand(settings as never, config as never, addItem),
    );

    act(() => {
      result.current.openAuthDialog();
    });

    await act(async () => {
      await result.current.handleQwenWebSubmit();
    });

    expect(settings.setValue).toHaveBeenCalledWith(
      'user',
      'security.auth.selectedType',
      AuthType.QWEN_WEB,
    );
    expect(settings.setValue).toHaveBeenCalledWith(
      'user',
      'model.name',
      QWEN_WEB_DEFAULT_MODEL,
    );
    expect(settings.setValue).toHaveBeenCalledWith('user', 'model.baseUrl', '');
    expect(settings.setValue.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          'user',
          expect.stringMatching(/^(env\.|security\.auth\.apiKey$)/),
        ]),
      ]),
    );
    expect(config.getModelsConfig().syncAfterAuthRefresh).toHaveBeenCalledWith(
      AuthType.QWEN_WEB,
      QWEN_WEB_DEFAULT_MODEL,
      undefined,
    );
    expect(config.refreshAuth).toHaveBeenCalledWith(AuthType.QWEN_WEB);
    expect(result.current.isAuthDialogOpen).toBe(false);
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Qwen Web configured'),
      }),
      expect.any(Number),
    );
    expect(recordSlashCommand).toHaveBeenCalledWith({
      phase: 'result',
      rawCommand: '/auth',
      outputHistoryItems: [
        expect.objectContaining({
          text: expect.stringContaining('Qwen Web configured'),
        }),
      ],
    });
  });
});
