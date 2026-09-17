/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { SharedAuthenticationTask } from './sharedAuthenticationTask.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition was not reached.');
}

function abortableRun() {
  const runs: Array<{
    signal: AbortSignal;
    gate: ReturnType<typeof deferred<void>>;
  }> = [];
  const run = vi.fn((signal: AbortSignal) => {
    const gate = deferred<void>();
    runs.push({ signal, gate });
    signal.addEventListener(
      'abort',
      () => gate.reject(new Error('internal authentication aborted')),
      { once: true },
    );
    return gate.promise;
  });
  return { run, runs };
}

describe('SharedAuthenticationTask', () => {
  it('lets one waiter cancel without aborting authentication needed by another', async () => {
    const { run, runs } = abortableRun();
    const cleanup = vi.fn(async () => undefined);
    const task = new SharedAuthenticationTask(run, cleanup);
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();

    const first = task.wait(firstAbort.signal);
    const second = task.wait(secondAbort.signal);
    await eventually(() => runs.length === 1);

    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(runs[0]!.signal.aborted).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();

    runs[0]!.gate.resolve();
    await expect(second).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('aborts shared authentication and runs cleanup when the last waiter cancels', async () => {
    const { run, runs } = abortableRun();
    const cleanup = vi.fn(async () => undefined);
    const task = new SharedAuthenticationTask(run, cleanup);
    const abort = new AbortController();

    const request = task.wait(abort.signal);
    await eventually(() => runs.length === 1);
    abort.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await eventually(() => cleanup.mock.calls.length === 1);
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('waits for cancellation cleanup before starting a replacement auth flow', async () => {
    const { run, runs } = abortableRun();
    const cleanupGate = deferred<void>();
    const cleanup = vi.fn(() => cleanupGate.promise);
    const task = new SharedAuthenticationTask(run, cleanup);
    const firstAbort = new AbortController();

    const first = task.wait(firstAbort.signal);
    await eventually(() => runs.length === 1);
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await eventually(() => cleanup.mock.calls.length === 1);

    const replacement = task.wait();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledTimes(1);

    cleanupGate.resolve();
    await eventually(() => runs.length === 2);
    runs[1]!.gate.resolve();
    await expect(replacement).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('starts fresh authentication after a completed task', async () => {
    const { run, runs } = abortableRun();
    const task = new SharedAuthenticationTask(run, async () => undefined);

    const first = task.wait();
    await eventually(() => runs.length === 1);
    runs[0]!.gate.resolve();
    await first;

    const second = task.wait();
    await eventually(() => runs.length === 2);
    runs[1]!.gate.resolve();
    await second;

    expect(run).toHaveBeenCalledTimes(2);
  });
});
