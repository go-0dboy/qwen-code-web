/**
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
} from './qwen-web-auth.js';

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
