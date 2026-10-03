import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

type PushStatus = (status: {
  busy: boolean;
  current: string | null;
  queued: number;
  startedAt: number | null;
}) => void;

test.describe('Global operation mutex (P0.3)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
  });

  const pushStatus = (page: Page, status: Parameters<PushStatus>[0]) =>
    page.evaluate((payload) => {
      const w = window as unknown as { __emitOperationStatus?: PushStatus };
      w.__emitOperationStatus?.(payload);
    }, status);

  test('shows no busy indicator while idle', async ({ page }) => {
    await expect(page.locator('[data-testid="op-status"]')).toHaveCount(0);
  });

  test('exposes the operation status bridge to the renderer', async ({ page }) => {
    const status = await page.evaluate(() =>
      (
        window as unknown as { electronAPI: { getOperationStatus: () => Promise<unknown> } }
      ).electronAPI.getOperationStatus()
    );
    expect(status).toEqual({ busy: false, current: null, queued: 0, startedAt: null });
  });

  test('shows the busy indicator while an operation owns the lock', async ({ page }) => {
    await pushStatus(page, {
      busy: true,
      current: 'tweaks:apply',
      queued: 1,
      startedAt: Date.now(),
    });

    const badge = page.locator('[data-testid="op-status"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Applying tweak');
    await expect(badge).toContainText('+1 queued');
  });

  test('hides the indicator when the lock is released', async ({ page }) => {
    await pushStatus(page, {
      busy: true,
      current: 'bundles:install',
      queued: 0,
      startedAt: Date.now(),
    });
    await expect(page.locator('[data-testid="op-status"]')).toBeVisible();

    await pushStatus(page, { busy: false, current: null, queued: 0, startedAt: null });
    await expect(page.locator('[data-testid="op-status"]')).toHaveCount(0);
  });

  test('disables tweak actions while another operation is running', async ({ page }) => {
    await page.click('.sidebar >> text=Tweaks');
    await page.check('input[aria-label="Select Show file extensions"]');

    const applyButton = page.locator('button:has-text("Apply selected (1)")');
    await expect(applyButton).toBeVisible();
    await expect(applyButton).toBeEnabled();

    await pushStatus(page, {
      busy: true,
      current: 'cleaning:run-now',
      queued: 0,
      startedAt: Date.now(),
    });
    // Confirm the status landed before asserting the disabled state.
    await expect(page.locator('[data-testid="op-status"]')).toBeVisible();
    await expect(applyButton).toBeDisabled();

    await pushStatus(page, { busy: false, current: null, queued: 0, startedAt: null });
    await expect(page.locator('[data-testid="op-status"]')).toHaveCount(0);
    await expect(applyButton).toBeEnabled();
  });
});
