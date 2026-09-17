/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { AuthType } from '../core/contentGenerator.js';
import { QWEN_WEB_DEFAULT_MODEL, QWEN_WEB_MODELS } from './constants.js';
import { ModelRegistry } from './modelRegistry.js';
import {
  resolveModelConfig,
  validateModelConfig,
} from './modelConfigResolver.js';

describe('Qwen Web model contract', () => {
  it('registers qwen3.8-max as the built-in text-only model', () => {
    const registry = new ModelRegistry();
    const models = registry.getModelsForAuthType(AuthType.QWEN_WEB);
    expect(models).toHaveLength(QWEN_WEB_MODELS.length);
    expect(models[0]?.id).toBe(QWEN_WEB_DEFAULT_MODEL);
    expect(models[0]?.modalities).toEqual({});
    expect(models[0]?.isVision).toBe(false);
    expect(registry.getDefaultModelForAuthType(AuthType.QWEN_WEB)?.id).toBe(
      QWEN_WEB_DEFAULT_MODEL,
    );
  });

  it('does not let modelProviders override the built-in Qwen Web model set', () => {
    const registry = new ModelRegistry({
      'qwen-web': [
        {
          id: 'not-supported',
          generationConfig: { modalities: { image: true } },
        },
      ],
    });
    expect(
      registry.getModel(AuthType.QWEN_WEB, 'not-supported'),
    ).toBeUndefined();
    expect(
      registry.getModel(AuthType.QWEN_WEB, QWEN_WEB_DEFAULT_MODEL)
        ?.generationConfig.modalities,
    ).toEqual({});
  });

  it('resolves the default without API credentials or a base URL', () => {
    const result = resolveModelConfig({
      authType: AuthType.QWEN_WEB,
      cli: {
        apiKey: 'must-be-ignored',
        baseUrl: 'https://must-be-ignored.invalid',
      },
      settings: {
        apiKey: 'also-ignored',
        baseUrl: 'https://also-ignored.invalid',
      },
      env: {},
    });
    expect(result.config.model).toBe(QWEN_WEB_DEFAULT_MODEL);
    expect(result.config.apiKey).toBeUndefined();
    expect(result.config.apiKeyEnvKey).toBeUndefined();
    expect(result.config.baseUrl).toBeUndefined();
    expect(result.config.modalities).toEqual({});
  });

  it('forces text-only modalities even when settings request images', () => {
    const result = resolveModelConfig({
      authType: AuthType.QWEN_WEB,
      settings: { generationConfig: { modalities: { image: true } } },
      env: {},
    });
    expect(result.config.modalities).toEqual({});
    expect(result.sources['modalities']?.kind).toBe('computed');
  });

  it('ignores model-provider credentials and media declarations', () => {
    const result = resolveModelConfig({
      authType: AuthType.QWEN_WEB,
      env: { SHOULD_NOT_BE_USED: 'secret' },
      modelProvider: {
        id: QWEN_WEB_DEFAULT_MODEL,
        envKey: 'SHOULD_NOT_BE_USED',
        baseUrl: 'https://must-not-be-used.invalid',
        generationConfig: { modalities: { image: true } },
      },
    });
    expect(result.config.apiKey).toBeUndefined();
    expect(result.config.apiKeyEnvKey).toBeUndefined();
    expect(result.config.baseUrl).toBeUndefined();
    expect(result.config.modalities).toEqual({});
  });

  it('preserves an explicit model request instead of silently falling back', () => {
    const result = resolveModelConfig({
      authType: AuthType.QWEN_WEB,
      cli: { model: 'explicit-future-model' },
      settings: {},
      env: {},
    });
    expect(result.config.model).toBe('explicit-future-model');
  });

  it('validates qwen-web without an API key but still requires a model', () => {
    expect(
      validateModelConfig({
        authType: AuthType.QWEN_WEB,
        model: QWEN_WEB_DEFAULT_MODEL,
      }).valid,
    ).toBe(true);
    const missingModel = validateModelConfig({
      authType: AuthType.QWEN_WEB,
      model: '',
    });
    expect(missingModel.valid).toBe(false);
    expect(
      missingModel.errors.some((error) =>
        error.message.toLowerCase().includes('model'),
      ),
    ).toBe(true);
  });
});
