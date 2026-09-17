/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ConversationSyncInput {
  channel: string;
  sessionId: string;
  model: string;
  systemSignature: string;
  transportEpoch: string;
  contents: readonly unknown[];
}

export interface ConversationSyncPlan {
  reset: boolean;
  replay: readonly unknown[];
  delta: readonly unknown[];
  reason?:
    | 'first-request'
    | 'session-changed'
    | 'model-changed'
    | 'system-changed'
    | 'transport-changed'
    | 'history-mismatch';
}

interface ConversationState {
  sessionId: string;
  model: string;
  systemSignature: string;
  transportEpoch: string;
  fingerprints: string[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function fingerprintQwenWebValue(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function isModelContent(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>)['role'] === 'model',
  );
}

export class ConversationSynchronizer {
  private readonly states = new Map<string, ConversationState>();

  plan(input: ConversationSyncInput): ConversationSyncPlan {
    const current = input.contents.map(fingerprintQwenWebValue);
    const previous = this.states.get(input.channel);
    if (!previous) return this.resetPlan(input.contents, 'first-request');
    if (previous.sessionId !== input.sessionId) {
      return this.resetPlan(input.contents, 'session-changed');
    }
    if (previous.model !== input.model) {
      return this.resetPlan(input.contents, 'model-changed');
    }
    if (previous.systemSignature !== input.systemSignature) {
      return this.resetPlan(input.contents, 'system-changed');
    }
    if (previous.transportEpoch !== input.transportEpoch) {
      return this.resetPlan(input.contents, 'transport-changed');
    }
    if (
      previous.fingerprints.length > current.length ||
      previous.fingerprints.some(
        (fingerprint, index) => current[index] !== fingerprint,
      )
    ) {
      return this.resetPlan(input.contents, 'history-mismatch');
    }

    const rawDelta = input.contents.slice(previous.fingerprints.length);
    // Qwen Web already produced the assistant response from the preceding
    // browser turn. Qwen Code adds that model content to canonical history on
    // the next request, so exactly one leading model item is transport-local
    // echo and must not be sent back to the web chat.
    const delta =
      rawDelta.length > 0 && isModelContent(rawDelta[0])
        ? rawDelta.slice(1)
        : rawDelta;
    return { reset: false, replay: [], delta };
  }

  commit(input: ConversationSyncInput): void {
    this.states.set(input.channel, {
      sessionId: input.sessionId,
      model: input.model,
      systemSignature: input.systemSignature,
      transportEpoch: input.transportEpoch,
      fingerprints: input.contents.map(fingerprintQwenWebValue),
    });
  }

  reset(channel?: string): void {
    if (channel) this.states.delete(channel);
    else this.states.clear();
  }

  private resetPlan(
    contents: readonly unknown[],
    reason: NonNullable<ConversationSyncPlan['reason']>,
  ): ConversationSyncPlan {
    return { reset: true, replay: contents, delta: [], reason };
  }
}
