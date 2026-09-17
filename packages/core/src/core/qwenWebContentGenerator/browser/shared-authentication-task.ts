/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

interface ActiveAuthenticationTask {
  controller: AbortController;
  promise: Promise<void>;
  waiters: Set<symbol>;
  settled: boolean;
  cancelling: boolean;
  cancellation?: Promise<void>;
}

function abortError(): Error {
  const error = new Error('Qwen Web browser request was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Shares one authentication flow between concurrent browser requests without
 * allowing any individual caller AbortSignal to own that shared work.
 *
 * Each caller can stop waiting independently. The underlying authentication
 * flow is cancelled only after the last waiter leaves. Cancellation cleanup is
 * completed before a later waiter is allowed to start another auth flow, which
 * prevents two browser/profile owners from overlapping.
 */
export class SharedAuthenticationTask {
  private active?: ActiveAuthenticationTask;

  constructor(
    private readonly run: (signal: AbortSignal) => Promise<void>,
    private readonly onLastWaiterCancelled: () => Promise<void>,
  ) {}

  async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();

    while (true) {
      const existing = this.active;
      if (existing?.cancelling) {
        await this.waitForCancellation(existing, signal);
        if (signal?.aborted) throw abortError();
        continue;
      }

      const task = existing ?? this.start();
      return this.waitOnTask(task, signal);
    }
  }

  private start(): ActiveAuthenticationTask {
    const task: ActiveAuthenticationTask = {
      controller: new AbortController(),
      promise: Promise.resolve(),
      waiters: new Set<symbol>(),
      settled: false,
      cancelling: false,
    };

    task.promise = Promise.resolve()
      .then(() => this.run(task.controller.signal))
      .finally(() => {
        task.settled = true;
        if (!task.cancelling && this.active === task) {
          this.active = undefined;
        }
      });
    // If every waiter cancels before the runner observes the internal abort,
    // there may temporarily be nobody awaiting this promise. Keep rejection
    // handled while cancellation cleanup joins it below.
    void task.promise.catch(() => undefined);

    this.active = task;
    return task;
  }

  private waitOnTask(
    task: ActiveAuthenticationTask,
    signal?: AbortSignal,
  ): Promise<void> {
    const waiter = Symbol('qwen-web-auth-waiter');
    task.waiters.add(waiter);

    return new Promise<void>((resolve, reject) => {
      let finished = false;

      const release = () => {
        signal?.removeEventListener('abort', onAbort);
        task.waiters.delete(waiter);
      };
      const settle = (callback: () => void) => {
        if (finished) return;
        finished = true;
        release();
        callback();
      };
      const onAbort = () => {
        if (finished) return;
        finished = true;
        release();
        reject(abortError());
        if (!task.settled && task.waiters.size === 0) {
          this.cancel(task);
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      task.promise.then(
        () => settle(resolve),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  private cancel(task: ActiveAuthenticationTask): void {
    if (task.cancelling || task.settled) return;
    task.cancelling = true;
    task.controller.abort();
    const cleanup = Promise.resolve().then(() =>
      this.onLastWaiterCancelled(),
    );
    task.cancellation = Promise.allSettled([task.promise, cleanup]).then(() => {
      if (this.active === task) this.active = undefined;
    });
    void task.cancellation.catch(() => undefined);
  }

  private async waitForCancellation(
    task: ActiveAuthenticationTask,
    signal?: AbortSignal,
  ): Promise<void> {
    const cancellation = task.cancellation ?? Promise.resolve();
    if (!signal) {
      await cancellation;
      return;
    }
    if (signal.aborted) throw abortError();

    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const onAbort = () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      cancellation.then(
        () => {
          if (finished) return;
          finished = true;
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        (error: unknown) => {
          if (finished) return;
          finished = true;
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }
}
