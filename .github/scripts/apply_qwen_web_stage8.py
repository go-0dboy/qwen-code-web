from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one anchor, found {count}: {old[:80]!r}"
        )
    p.write_text(text.replace(old, new, 1))


replace_one(
    "packages/core/src/models/index.ts",
    "  QWEN_OAUTH_MODELS,\n} from './constants.js';",
    "  QWEN_OAUTH_MODELS,\n  QWEN_WEB_DEFAULT_MODEL,\n} from './constants.js';",
)
replace_one(
    "packages/core/src/index.ts",
    "  QWEN_OAUTH_MODELS,\n  resolveModelConfig,",
    "  QWEN_OAUTH_MODELS,\n  QWEN_WEB_DEFAULT_MODEL,\n  resolveModelConfig,",
)

Path("packages/cli/src/ui/auth/qwenWebAuth.ts").write_text(
    """/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthType,
  QWEN_WEB_DEFAULT_MODEL,
  applyProviderInstallPlan,
  type Config,
  type ProviderInstallPlan,
} from '@qwen-code/qwen-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import { createLoadedSettingsAdapter } from '../../config/loadedSettingsAdapter.js';

export const QWEN_WEB_AUTH_LABEL = 'Qwen Web';
export const QWEN_WEB_AUTH_DESCRIPTION = 'Use browser session, no API key';

export function buildQwenWebInstallPlan(): ProviderInstallPlan {
  return {
    providerId: 'qwen-web',
    authType: AuthType.QWEN_WEB,
    modelSelection: { modelId: QWEN_WEB_DEFAULT_MODEL },
  };
}

/**
 * Persist the credentialless browser provider through the same transactional
 * settings path as API providers. Deliberately writes no env/API key/base URL.
 * `refreshAuth()` only installs the lazy ContentGenerator; Chromium is still
 * launched on the first real model request.
 */
export async function applyQwenWebAuth(
  settings: LoadedSettings,
  config: Config,
): Promise<void> {
  await applyProviderInstallPlan(buildQwenWebInstallPlan(), {
    settings: createLoadedSettingsAdapter(settings),
    reloadModelProviders: (mp) => config.reloadModelProvidersConfig(mp),
    syncAuthState: (authType, modelId, baseUrl) =>
      config.getModelsConfig().syncAfterAuthRefresh(authType, modelId, baseUrl),
    refreshAuth: (authType) => config.refreshAuth(authType),
  });
}
"""
)

Path("packages/cli/src/ui/auth/qwenWebAuth.test.ts").write_text(
    """/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { AuthType, QWEN_WEB_DEFAULT_MODEL } from '@qwen-code/qwen-code-core';
import {
  QWEN_WEB_AUTH_DESCRIPTION,
  QWEN_WEB_AUTH_LABEL,
  buildQwenWebInstallPlan,
} from './qwenWebAuth.js';

describe('Qwen Web credentialless auth plan', () => {
  it('selects the built-in browser model without credentials', () => {
    const plan = buildQwenWebInstallPlan();
    expect(plan).toEqual({
      providerId: 'qwen-web',
      authType: AuthType.QWEN_WEB,
      modelSelection: { modelId: QWEN_WEB_DEFAULT_MODEL },
    });
    expect(plan).not.toHaveProperty('env');
    expect(plan).not.toHaveProperty('legacyCredentials');
    expect(plan.modelSelection).not.toHaveProperty('baseUrl');
  });

  it('exposes an explicit no-API-key UI description', () => {
    expect(QWEN_WEB_AUTH_LABEL).toBe('Qwen Web');
    expect(QWEN_WEB_AUTH_DESCRIPTION).toContain('no API key');
  });
});
"""
)

replace_one(
    "packages/cli/src/ui/auth/useAuth.ts",
    "import { t } from '../../i18n/index.js';",
    "import { t } from '../../i18n/index.js';\nimport { applyQwenWebAuth } from './qwenWebAuth.js';",
)
replace_one(
    "packages/cli/src/ui/auth/useAuth.ts",
    "    ) => Promise<void>;\n    openAuthDialog: () => void;",
    "    ) => Promise<void>;\n    /** Select the browser-backed provider without API credentials. */\n    handleQwenWebSubmit: () => Promise<void>;\n    openAuthDialog: () => void;",
)
replace_one(
    "packages/cli/src/ui/auth/useAuth.ts",
    "  );\n\n  // -- Dialog open / close / cancel ----------------------------------------",
    """  );

  const handleQwenWebSubmit = useCallback(async () => {
    const protocol = AuthType.QWEN_WEB;
    try {
      setPendingAuthType(protocol);
      setIsAuthenticating(true);
      setAuthError(null);
      await applyQwenWebAuth(settings, config);
      completeAuthentication();

      const feedbackItem: HistoryItemWithoutId & Record<string, unknown> = {
        type: MessageType.INFO,
        text: t(
          'Successfully configured Qwen Web. The browser will open only when a model request needs it.',
        ),
      };
      addItem(feedbackItem, Date.now());
      if (openedViaCommandRef.current) {
        openedViaCommandRef.current = false;
        config.getChatRecordingService?.()?.recordSlashCommand({
          phase: 'result',
          rawCommand: '/auth',
          outputHistoryItems: [feedbackItem],
        });
      }
      logAuth(config, new AuthEvent(protocol, 'manual', 'success'));
    } catch (error) {
      handleAuthFailure(error, protocol);
    }
  }, [settings, config, completeAuthentication, addItem, handleAuthFailure]);

  // -- Dialog open / close / cancel ----------------------------------------""",
)
replace_one(
    "packages/cli/src/ui/auth/useAuth.ts",
    "      AuthType.QWEN_OAUTH,\n      AuthType.USE_OPENAI,",
    "      AuthType.QWEN_OAUTH,\n      AuthType.QWEN_WEB,\n      AuthType.USE_OPENAI,",
)
replace_one(
    "packages/cli/src/ui/auth/useAuth.ts",
    "      handleProviderSubmit,\n      openAuthDialog,",
    "      handleProviderSubmit,\n      handleQwenWebSubmit,\n      openAuthDialog,",
)
replace_one(
    "packages/cli/src/ui/auth/useAuth.ts",
    "      handleProviderSubmit,\n      handleQwenWebSubmit,\n      openAuthDialog,\n      cancelAuthentication,\n    ],",
    "      handleProviderSubmit,\n      handleQwenWebSubmit,\n      openAuthDialog,\n      cancelAuthentication,\n    ],",
)
replace_one(
    "packages/cli/src/ui/auth/useAuth.ts",
    "    handleProviderSubmit,\n    openAuthDialog,",
    "    handleProviderSubmit,\n    handleQwenWebSubmit,\n    openAuthDialog,",
)

replace_one(
    "packages/cli/src/ui/auth/AuthDialog.tsx",
    "import { ProviderSetupSteps } from './ProviderSetupSteps.js';",
    "import { ProviderSetupSteps } from './ProviderSetupSteps.js';\nimport {\n  QWEN_WEB_AUTH_DESCRIPTION,\n  QWEN_WEB_AUTH_LABEL,\n} from './qwenWebAuth.js';",
)
replace_one(
    "packages/cli/src/ui/auth/AuthDialog.tsx",
    "type MainOption =\n  | 'ALIBABA_MODELSTUDIO'",
    "type MainOption =\n  | 'QWEN_WEB'\n  | 'ALIBABA_MODELSTUDIO'",
)
replace_one(
    "packages/cli/src/ui/auth/AuthDialog.tsx",
    "const MAIN_ITEMS = [\n  {\n    key: 'ALIBABA_MODELSTUDIO',",
    """const MAIN_ITEMS = [
  {
    key: 'QWEN_WEB',
    title: t(QWEN_WEB_AUTH_LABEL),
    label: t(QWEN_WEB_AUTH_LABEL),
    description: t(QWEN_WEB_AUTH_DESCRIPTION),
    value: 'QWEN_WEB' as MainOption,
  },
  {
    key: 'ALIBABA_MODELSTUDIO',""",
)
replace_one(
    "packages/cli/src/ui/auth/AuthDialog.tsx",
    "    auth: { closeAuthDialog, handleProviderSubmit, onAuthError },",
    "    auth: {\n      closeAuthDialog,\n      handleProviderSubmit,\n      handleQwenWebSubmit,\n      onAuthError,\n    },",
)
replace_one(
    "packages/cli/src/ui/auth/AuthDialog.tsx",
    "import type { ProviderConfig } from '@qwen-code/qwen-code-core/providers/types.js';",
    "import { AuthType } from '@qwen-code/qwen-code-core';\nimport type { ProviderConfig } from '@qwen-code/qwen-code-core/providers/types.js';",
)
replace_one(
    "packages/cli/src/ui/auth/AuthDialog.tsx",
    """  const defaultMainIndex = useMemo(() => {
    if (matchedProvider?.uiGroup === 'third-party') return 1;
    if (matchedProvider?.uiGroup === 'custom') return 2;
    return 0;
  }, [matchedProvider]);""",
    """  const defaultMainIndex = useMemo(() => {
    if (config.getAuthType() === AuthType.QWEN_WEB) return 0;
    if (matchedProvider?.uiGroup === 'third-party') return 2;
    if (matchedProvider?.uiGroup === 'custom') return 3;
    return 1;
  }, [config, matchedProvider]);""",
)
replace_one(
    "packages/cli/src/ui/auth/AuthDialog.tsx",
    "    switch (value) {\n      case 'ALIBABA_MODELSTUDIO':",
    "    switch (value) {\n      case 'QWEN_WEB':\n        void handleQwenWebSubmit();\n        break;\n      case 'ALIBABA_MODELSTUDIO':",
)
replace_one(
    "packages/cli/src/ui/auth/AuthDialog.test.tsx",
    "    handleProviderSubmit: vi.fn(),\n    setAuthState:",
    "    handleProviderSubmit: vi.fn(),\n    handleQwenWebSubmit: vi.fn(),\n    setAuthState:",
)

replace_one(
    "packages/cli/src/ui/components/AppHeader.tsx",
    "    case AuthType.QWEN_OAUTH:\n      return AuthDisplayType.QWEN_OAUTH;\n    default:",
    "    case AuthType.QWEN_OAUTH:\n      return AuthDisplayType.QWEN_OAUTH;\n    case AuthType.QWEN_WEB:\n      return 'Qwen Web';\n    default:",
)

replace_one(
    "packages/cli/src/ui/opentui/dialogs-auth.tsx",
    "import { normalizeModelIds } from '../auth/useAuth.js';",
    "import { normalizeModelIds } from '../auth/useAuth.js';\nimport {\n  QWEN_WEB_AUTH_DESCRIPTION,\n  QWEN_WEB_AUTH_LABEL,\n  applyQwenWebAuth,\n} from '../auth/qwenWebAuth.js';",
)
replace_one(
    "packages/cli/src/ui/opentui/dialogs-auth.tsx",
    "type MainOption =\n  | 'ALIBABA_MODELSTUDIO'",
    "type MainOption =\n  | 'QWEN_WEB'\n  | 'ALIBABA_MODELSTUDIO'",
)
replace_one(
    "packages/cli/src/ui/opentui/dialogs-auth.tsx",
    "const MAIN_ITEMS: RadioItem[] = [\n  {\n    key: 'ALIBABA_MODELSTUDIO',",
    """const MAIN_ITEMS: RadioItem[] = [
  {
    key: 'QWEN_WEB',
    label: t(QWEN_WEB_AUTH_LABEL),
    description: t(QWEN_WEB_AUTH_DESCRIPTION),
    value: 'QWEN_WEB',
  },
  {
    key: 'ALIBABA_MODELSTUDIO',""",
)
replace_one(
    "packages/cli/src/ui/opentui/dialogs-auth.tsx",
    """  const defaultMainIndex = useMemo(() => {
    if (matchedProvider?.uiGroup === 'third-party') return 1;
    if (matchedProvider?.uiGroup === 'custom') return 2;
    return 0;
  }, [matchedProvider]);""",
    """  const defaultMainIndex = useMemo(() => {
    if (config.getAuthType() === AuthType.QWEN_WEB) return 0;
    if (matchedProvider?.uiGroup === 'third-party') return 2;
    if (matchedProvider?.uiGroup === 'custom') return 3;
    return 1;
  }, [config, matchedProvider]);""",
)
replace_one(
    "packages/cli/src/ui/opentui/dialogs-auth.tsx",
    "  // -- Main menu select -------------------------------------------------------\n\n  const handleMainSelect = useCallback(",
    """  // -- Main menu select -------------------------------------------------------

  const handleQwenWebSubmit = useCallback(async () => {
    clearErrors();
    try {
      await applyQwenWebAuth(settings, config);
      notify?.(
        t(
          'Successfully configured Qwen Web. The browser will open only when a model request needs it.',
        ),
      );
      logAuth(config, new AuthEvent(AuthType.QWEN_WEB, 'manual', 'success'));
      onClose();
    } catch (error) {
      const msg = t('Failed to authenticate. Message: {{message}}', {
        message: getErrorMessage(error),
      });
      setErrorMessage(msg);
      logAuth(
        config,
        new AuthEvent(AuthType.QWEN_WEB, 'manual', 'error', msg),
      );
    }
  }, [clearErrors, settings, config, notify, onClose]);

  const handleMainSelect = useCallback(""",
)
replace_one(
    "packages/cli/src/ui/opentui/dialogs-auth.tsx",
    "      switch (value) {\n        case 'ALIBABA_MODELSTUDIO':",
    "      switch (value) {\n        case 'QWEN_WEB':\n          void handleQwenWebSubmit();\n          break;\n        case 'ALIBABA_MODELSTUDIO':",
)
replace_one(
    "packages/cli/src/ui/opentui/dialogs-auth.tsx",
    "    [clearErrors, pushView, setupFlow, settings],",
    "    [clearErrors, pushView, setupFlow, settings, handleQwenWebSubmit],",
)

print("Stage 8 patch applied")
