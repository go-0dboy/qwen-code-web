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
  getStatus(): Promise<QwenWebRuntimeStatus>;
  selectModel(model: string): Promise<string>;
  preparePrompt(prompt: string): Promise<QwenWebPreparedPrompt>;
  waitForResponse(prepared: QwenWebPreparedPrompt): Promise<string>;
  stopGeneration(): Promise<void>;
}

export interface QwenWebTransportState {
  browserEpoch: number;
  pageEpoch: number;
}

export class QwenWebTransportResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QwenWebTransportResetError';
  }
}

export function transportEpochKey(state: QwenWebTransportState): string {
  return `${state.browserEpoch}:${state.pageEpoch}`;
}

export function transportStateMatches(
  left: QwenWebTransportState,
  right: QwenWebTransportState,
): boolean {
  return (
    left.browserEpoch === right.browserEpoch && left.pageEpoch === right.pageEpoch
  );
}
