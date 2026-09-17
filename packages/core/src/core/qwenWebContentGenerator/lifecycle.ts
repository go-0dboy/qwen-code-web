/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Closes Qwen Web process-wide browser resources if they were created.
 *
 * The browser module is imported only when cleanup actually runs, preserving
 * the provider's lazy startup contract for help/configuration paths.
 */
export async function closeQwenWebProcessResources(): Promise<void> {
  const { closeQwenWebBrowserServiceIfCreated } = await import(
    './browserService.js'
  );
  await closeQwenWebBrowserServiceIfCreated();
}
