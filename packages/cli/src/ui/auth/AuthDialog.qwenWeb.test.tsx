/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { AuthType, type Config } from '@qwen-code/qwen-code-core';
import { AuthDialog } from './AuthDialog.js';
import { LoadedSettings } from '../../config/settings.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { UIStateContext, type UIState } from '../contexts/UIStateContext.js';
import {
  UIActionsContext,
  type UIActions,
} from '../contexts/UIActionsContext.js';

function createSettings(): LoadedSettings {
  const file = {
    settings: { modelProviders: {}, env: {} },
    originalSettings: { modelProviders: {}, env: {} },
    path: '',
  };
  return new LoadedSettings(
    file,
    { settings: {}, originalSettings: {}, path: '' },
    file,
    file,
    true,
    new Set(),
  );
}

function createState(): UIState {
  return {
    auth: {
      authError: null,
      isAuthDialogOpen: true,
      isAuthenticating: false,
      pendingAuthType: undefined,
      externalAuthState: null,
      qwenAuthState: {
        deviceAuth: null,
        authStatus: 'idle',
        authMessage: null,
      },
    },
  } as UIState;
}

function createActions(handleQwenWebSubmit: () => Promise<void>): UIActions {
  return {
    auth: {
      closeAuthDialog: vi.fn(),
      handleProviderSubmit: vi.fn(),
      handleQwenWebSubmit,
      setAuthState: vi.fn(),
      onAuthError: vi.fn(),
      openAuthDialog: vi.fn(),
      cancelAuthentication: vi.fn(),
    },
    handleRetryLastPrompt: vi.fn(),
  } as UIActions;
}

describe('AuthDialog Qwen Web option', () => {
  it('shows a credentialless Qwen Web option and invokes it directly', async () => {
    const handleQwenWebSubmit = vi.fn(async () => undefined);
    const config = {
      getAuthType: vi.fn(() => undefined),
      getContentGeneratorConfig: vi.fn(() => ({})),
    } as unknown as Config;

    const { lastFrame, stdin } = renderWithProviders(
      <UIStateContext.Provider value={createState()}>
        <UIActionsContext.Provider value={createActions(handleQwenWebSubmit)}>
          <AuthDialog />
        </UIActionsContext.Provider>
      </UIStateContext.Provider>,
      { settings: createSettings(), config },
    );

    expect(lastFrame()).toContain('Qwen Web');
    expect(lastFrame()).toContain('Use browser session, no API key');

    stdin.write('\u001b[B');
    stdin.write('\u001b[B');
    stdin.write('\u001b[B');
    await vi.waitFor(() => expect(lastFrame()).toMatch(/›.*Qwen Web/));
    stdin.write('\r');
    await vi.waitFor(() => expect(handleQwenWebSubmit).toHaveBeenCalledTimes(1));
  });

  it('highlights Qwen Web when it is the active auth type', async () => {
    const config = {
      getAuthType: vi.fn(() => AuthType.QWEN_WEB),
      getContentGeneratorConfig: vi.fn(() => ({})),
    } as unknown as Config;

    const { lastFrame } = renderWithProviders(
      <UIStateContext.Provider value={createState()}>
        <UIActionsContext.Provider value={createActions(vi.fn())}>
          <AuthDialog />
        </UIActionsContext.Provider>
      </UIStateContext.Provider>,
      { settings: createSettings(), config },
    );

    await vi.waitFor(() => expect(lastFrame()).toMatch(/›.*Qwen Web/));
  });
});
