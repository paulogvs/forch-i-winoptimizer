import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Free RAM quick action (P1.1)', () => {
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

  test('shows the Free RAM button in the header', async ({ page }) => {
    await expect(page.locator('[data-testid="free-ram"]')).toBeVisible();
    await expect(page.locator('[data-testid="free-ram"]')).toHaveText('Free RAM');
  });

  test('frees memory and reports the trimmed amount with its scope', async ({ page }) => {
    await page.click('[data-testid="free-ram"]');
    // Fase 0.6: honest scope — the amount plus the fact it is this app's own
    // working set (before → after), never system-wide RAM.
    await expect(page.locator('[data-testid="free-ram"]')).toContainText('Freed 42 MB');
    await expect(page.locator('[data-testid="free-ram"]')).toContainText('1024→982 MB');
    // Auto-resets to the idle label.
    await expect(page.locator('[data-testid="free-ram"]')).toHaveText('Free RAM', {
      timeout: 5000,
    });
  });

  test('discloses that it only frees this app’s own memory', async ({ page }) => {
    const btn = page.locator('[data-testid="free-ram"]');
    await expect(btn).toHaveAttribute('title', /this app only/i);
  });

  test('shows a failure state when the backend reports an error', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as { __freeMemoryResult?: unknown };
      w.__freeMemoryResult = {
        success: false,
        freedMb: 0,
        rssBeforeMb: 100,
        rssAfterMb: 100,
        error: 'denied',
      };
    });

    await page.click('[data-testid="free-ram"]');
    await expect(page.locator('[data-testid="free-ram"]')).toHaveText('Free failed');
  });

  test('is disabled while another operation owns the lock', async ({ page }) => {
    const freeRam = page.locator('[data-testid="free-ram"]');
    await expect(freeRam).toBeVisible();

    await pushStatus(page, {
      busy: true,
      current: 'tweaks:apply',
      queued: 0,
      startedAt: Date.now(),
    });
    // Wait for the busy badge first: it proves the pushed status reached the
    // live subscriber (the bridge drops events emitted before mount).
    await expect(page.locator('[data-testid="op-status"]')).toBeVisible();
    await expect(freeRam).toBeDisabled();

    await pushStatus(page, { busy: false, current: null, queued: 0, startedAt: null });
    await expect(page.locator('[data-testid="op-status"]')).toHaveCount(0);
    await expect(freeRam).toBeEnabled();
  });
});
