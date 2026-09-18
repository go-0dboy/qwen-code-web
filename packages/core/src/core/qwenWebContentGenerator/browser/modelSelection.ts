/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

export function normalizeQwenWebModelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function assertQwenWebModelSelection(
  requested: string,
  selected: string,
): void {
  if (
    normalizeQwenWebModelName(selected) !==
    normalizeQwenWebModelName(requested)
  ) {
    throw new Error(
      `Qwen Web model mismatch: requested '${requested}', selected '${selected}'.`,
    );
  }
}
