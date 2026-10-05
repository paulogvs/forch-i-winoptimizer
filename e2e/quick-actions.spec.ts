import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp, waitForOperationBridge } from './helpers';

/**
 * Fase 3 — Quick fixes bar on the Dashboard.
 *
 * The browser suite mocks `window.electronAPI.quickFixes`, so these tests assert
 * the wiring (real API call + real toast + navigation) rather than the OS work,
 * which is covered by the unit tests for the main-process service.
 */
test.describe('Quick fixes (Fase 3)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
  });

  const pushStatus = (
    page: Page,
    status: { busy: boolean; current: string | null; queued: number; startedAt: number | null }
  ) =>
    page.evaluate((payload) => {
      const w = window as unknown as { __emitOperationStatus?: (s: unknown) => void };
      w.__emitOperationStatus?.(payload);
    }, status);

  test('shows the visible quick-fix bar with all five actions', async ({ page }) => {
    await expect(page.locator('text=Quick fixes')).toBeVisible();
    for (const id of ['free-ram', 'clean-temp', 'flush-dns', 'restore-point', 'scan-drivers']) {
      await expect(page.locator(`[data-testid="quickfix-${id}"]`)).toBeVisible();
    }
  });

  test('Free RAM is one click and toasts the real result with a Statistics link', async ({
    page,
  }) => {
    await page.click('[data-testid="quickfix-free-ram"]');

    const toast = page.locator('[data-testid="toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Freed 42 MB');
    await expect(toast).toContainText('1024 → 982 MB');

    await page.click('[data-testid="toast"] >> text=View in Statistics');
    await expect(page.locator('h2.page-title')).toHaveText('Statistics');
  });

  test('Clean Temp confirms once and reports the real cleanup', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());

    await page.click('[data-testid="quickfix-clean-temp"]');
    await expect(page.locator('[data-testid="toast"]')).toContainText('Cleaned 3 file(s)');
  });

  test('Flush DNS is one click and reports the verified cache delta', async ({ page }) => {
    await page.click('[data-testid="quickfix-flush-dns"]');
    await expect(page.locator('[data-testid="toast"]')).toContainText('20 → 0 entries');
  });

  test('disables the actions while another operation holds the lock', async ({ page }) => {
    await waitForOperationBridge(page);
    await pushStatus(page, {
      busy: true,
      current: 'tweaks:apply',
      queued: 0,
      startedAt: Date.now(),
    });

    await expect(page.locator('[data-testid="op-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="quickfix-free-ram"]')).toBeDisabled();
  });
});
