import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Tools → Utilities — real Windows tools (v0.5.0)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
    await page.click('.sidebar >> text=Tools');
    await page.click('button:has-text("Utilities")');
  });

  test('lists launchable Windows utilities', async ({ page }) => {
    await expect(page.getByTestId('launch-tool-task-manager')).toBeVisible();
    await expect(page.getByTestId('launch-tool-disk-cleanup')).toBeVisible();
    await expect(page.getByTestId('launch-tool-device-manager')).toBeVisible();
  });

  test('launches a tool and reports success', async ({ page }) => {
    await page.getByTestId('launch-tool-task-manager').click();
    await expect(page.getByTestId('tool-feedback')).toHaveText(/Opened task-manager/);
  });

  test('reports a failure honestly when the binary is missing', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __toolLaunchResult?: unknown }).__toolLaunchResult = {
        success: false,
        message: 'Utility not found on this system: taskmgr.exe',
      };
    });
    await page.getByTestId('launch-tool-task-manager').click();
    await expect(page.getByTestId('tool-feedback')).toHaveText(/not found/);
  });
});
