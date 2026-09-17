/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '../contentGenerator.js';
import { QwenWebContentGenerator } from './qwen-web-content-generator.js';

export { QwenWebContentGenerator } from './qwen-web-content-generator.js';

export function createQwenWebContentGenerator(
  generatorConfig: ContentGeneratorConfig,
  config: Config,
): ContentGenerator {
  return new QwenWebContentGenerator(generatorConfig, config);
}
