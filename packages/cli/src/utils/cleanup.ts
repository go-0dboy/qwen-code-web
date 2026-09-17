/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const cleanupFunctions: Array<(() => void) | (() => Promise<void>)> = [];
let exitCleanupPromise: Promise<void> | undefined;

export function registerCleanup(
  fn: (() => void) | (() => Promise<void>),
): () => void {
  cleanupFunctions.push(fn);
  return () => {
    const index = cleanupFunctions.indexOf(fn);
    if (index !== -1) cleanupFunctions.splice(index, 1);
  };
}

/**
 * Per-cleanup ceiling. Caps any single hung cleanup (slow disk on
 * `chatRecording.flush`, MCP disconnect on a dead socket, telemetry HTTP
 * stall) so it can't starve the rest of the cleanup chain.
 */
const PER_CLEANUP_TIMEOUT_MS = 2_000;

/**
 * Wall-clock ceiling for the whole cleanup pass. Caps the async cleanup chain
 * so process exit stays bounded even if a resource refuses to settle.
 */
const OVERALL_CLEANUP_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

export interface RunExitCleanupOptions {
  /** TEST ONLY — override per-cleanup-function timeout (default 2s). */
  _testPerFnTimeoutMs?: number;
  /** TEST ONLY — override overall wall-clock timeout (default 5s). */
  _testOverallTimeoutMs?: number;
}

export function runExitCleanup(
  options: RunExitCleanupOptions = {},
): Promise<void> {
  if (exitCleanupPromise) return exitCleanupPromise;
  const cleanup = runExitCleanupPass(options).finally(() => {
    if (exitCleanupPromise === cleanup) exitCleanupPromise = undefined;
  });
  exitCleanupPromise = cleanup;
  return cleanup;
}

async function runExitCleanupPass(
  options: RunExitCleanupOptions,
): Promise<void> {
  const perFn = options._testPerFnTimeoutMs ?? PER_CLEANUP_TIMEOUT_MS;
  const overall = options._testOverallTimeoutMs ?? OVERALL_CLEANUP_TIMEOUT_MS;

  const drain = (async () => {
    for (const fn of cleanupFunctions) {
      try {
        await withTimeout(Promise.resolve().then(fn), perFn);
      } catch (_) {
        // Ignore errors during cleanup.
      }
    }

    // Qwen Web owns a process-wide browser rather than a per-Config resource.
    // Join it to the shared CLI exit chain instead of Config.shutdown(), which
    // would let one daemon/ACP session kill Chromium used by another session.
    // The import is intentionally deferred until exit and the called helper
    // never creates the singleton, preserving lazy browser startup.
    try {
      const { closeQwenWebProcessResources } = await import(
        '@qwen-code/qwen-code-core/core/qwenWebContentGenerator/lifecycle.js'
      );
      await withTimeout(closeQwenWebProcessResources(), perFn);
    } catch (_) {
      // Best-effort like the rest of the exit cleanup chain.
    }
  })();

  let wallClockTimer: NodeJS.Timeout | undefined;
  const wallClock = new Promise<void>((resolve) => {
    wallClockTimer = setTimeout(() => resolve(), overall);
    wallClockTimer.unref?.();
  });

  try {
    await Promise.race([drain, wallClock]);
  } finally {
    if (wallClockTimer) clearTimeout(wallClockTimer);
    cleanupFunctions.length = 0;
  }
}

/** Test-only: clear registered cleanup state between vitest cases. */
export function _resetCleanupFunctionsForTest(): void {
  cleanupFunctions.length = 0;
  exitCleanupPromise = undefined;
}

export async function cleanupCheckpoints() {
  const { Storage } = await import('./deferred-core-runtime.js');
  const storage = new Storage(process.cwd());
  const tempDir = storage.getProjectTempDir();
  const checkpointsDir = join(tempDir, 'checkpoints');
  try {
    await fs.rm(checkpointsDir, { recursive: true, force: true });
  } catch {
    // Ignore errors if the directory doesn't exist or fails to delete.
  }
}
