import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Tools → Utilities → Disk repair (Fase 4.9)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
    await page.click('.sidebar >> text=Tools');
    await page.click('button:has-text("Utilities")');
  });

  test('lists the real repair tools with honest labels', async ({ page }) => {
    await expect(page.getByTestId('disk-repair-dism-restore-health')).toBeVisible();
    await expect(page.getByTestId('disk-repair-sfc-scannow')).toBeVisible();
    await expect(page.getByTestId('disk-repair-chkdsk')).toBeVisible();
    await expect(page.getByTestId('disk-repair-trim')).toBeVisible();
  });

  test('confirms, runs and shows the real summary', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('disk-repair-sfc-scannow').click();
    await expect(page.getByTestId('disk-repair-summary')).toHaveText(/No integrity violations/);
  });

  test('offers "Restart as administrator" when blocked by elevation', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __diskRepairResult?: unknown }).__diskRepairResult = {
        toolId: 'sfc-scannow',
        toolName: 'System File Checker',
        success: false,
        status: 'requires-admin',
        exitCode: null,
        summary: 'System File Checker requires administrator rights.',
        lines: [],
        durationMs: 1,
        requiresAdmin: true,
        repairNeeded: null,
      };
    });
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('disk-repair-sfc-scannow').click();
    await expect(page.getByTestId('disk-repair-relaunch')).toBeVisible();
  });
});
