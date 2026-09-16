/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

export interface QwenWebRuntimeStatus {
  loggedIn: boolean;
  generating: boolean;
  model?: string;
  responseCount: number;
  responseText: string;
  comparisonVisible: boolean;
  providerError?: string;
  nativeToolVisible: boolean;
}

export interface QwenWebPreparedPrompt {
  baselineCount: number;
  baselineText: string;
  accepted: boolean;
}

export interface QwenWebPageBridge {
  getStatus(): QwenWebRuntimeStatus;
  selectModel(model: string): Promise<string>;
  preparePrompt(prompt: string): Promise<QwenWebPreparedPrompt>;
  waitForResponse(prepared: QwenWebPreparedPrompt): Promise<string>;
  stopGeneration(): Promise<void>;
}

export interface QwenWebTransportState {
  browserEpoch: number;
  pageEpoch: number;
}

export function transportEpochKey(state: QwenWebTransportState): string {
  return `${state.browserEpoch}:${state.pageEpoch}`;
}
