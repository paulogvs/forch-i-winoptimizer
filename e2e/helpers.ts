import type { Page } from '@playwright/test';

/**
 * Transient, machine-level navigation failures. `ERR_NO_BUFFER_SPACE` shows up
 * under contention (the Chromium network service runs out of buffer when the
 * machine is busy); the others cover the dev-server startup window.
 */
const TRANSIENT_NAV_ERROR =
  /ERR_NO_BUFFER_SPACE|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|ERR_INSUFFICIENT_RESOURCES|ERR_ABORTED/i;

/**
 * Wait until the renderer has mounted the header and subscribed to the global
 * operation-status bridge.
 *
 * Root cause of the old `toBeDisabled()` flake: `pushStatus()` broadcasts through
 * `window.__emitOperationStatus`, which only forwards to *registered* listeners.
 * `useOperationStatus()` registers its listener inside a React effect, so calling
 * `gotoApp()` (which used to resolve at `domcontentloaded`) and then immediately
 * emitting could fire before the subscription existed. The event was silently
 * dropped, the action button stayed enabled, and the assertion failed after the
 * full expect timeout — with no logic bug involved.
 *
 * Waiting for the listener to exist makes the emit deterministic: once this
 * resolves, a status pushed from the test is guaranteed to reach the component.
 */
export async function waitForOperationBridge(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __opStatusListeners?: unknown[] };
      return Array.isArray(w.__opStatusListeners) && w.__opStatusListeners.length > 0;
    },
    undefined,
    { timeout }
  );
}

/**
 * Navigate to the app, retrying transient network-layer failures instead of
 * failing the whole test on a one-off Chromium hiccup. This is deliberately a
 * navigation-level retry (not a global timeout bump): real assertion failures
 * still surface immediately.
 *
 * After a successful navigation it also waits for the operation-status bridge,
 * so every spec starts from a fully-mounted app with its push subscriptions
 * live (see `waitForOperationBridge`).
 */
export async function gotoApp(page: Page, path = '/'): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await waitForOperationBridge(page);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === attempts || !TRANSIENT_NAV_ERROR.test(message)) throw error;
      await page.waitForTimeout(250 * attempt);
    }
  }
}
