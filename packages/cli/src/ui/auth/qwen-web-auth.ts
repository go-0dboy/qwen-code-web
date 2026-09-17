/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@qwen-code/qwen-code-core/config/config.js';
import { QWEN_WEB_DEFAULT_MODEL } from '@qwen-code/qwen-code-core/models/index.js';
import { applyProviderInstallPlan } from '@qwen-code/qwen-code-core/providers/install.js';
import type { ProviderInstallPlan } from '@qwen-code/qwen-code-core/providers/types.js';
import { AuthType } from '@qwen-code/qwen-code-core/utils/auth-type.js';
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
