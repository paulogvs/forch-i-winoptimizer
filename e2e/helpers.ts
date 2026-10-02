import type { Page } from '@playwright/test';

/**
 * Transient, machine-level navigation failures. `ERR_NO_BUFFER_SPACE` shows up
 * under contention (the Chromium network service runs out of buffer when the
 * machine is busy); the others cover the dev-server startup window.
 */
const TRANSIENT_NAV_ERROR =
  /ERR_NO_BUFFER_SPACE|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|ERR_INSUFFICIENT_RESOURCES|ERR_ABORTED/i;

/**
 * Navigate to the app, retrying transient network-layer failures instead of
 * failing the whole test on a one-off Chromium hiccup. This is deliberately a
 * navigation-level retry (not a global timeout bump): real assertion failures
 * still surface immediately.
 */
export async function gotoApp(page: Page, path = '/'): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === attempts || !TRANSIENT_NAV_ERROR.test(message)) throw error;
      await page.waitForTimeout(250 * attempt);
    }
  }
}
