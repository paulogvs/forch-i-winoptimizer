import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Cleaner', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
    await page.click('text=Cleaner');
  });

  test('should display cleaner page', async ({ page }) => {
    await expect(page.locator('h2.page-title')).toHaveText('Cleaner');
  });

  test('should scan for junk files', async ({ page }) => {
    await page.click('button:has-text("Scan")');
    await expect(page.locator('button:has-text("Clean (")')).toBeVisible({ timeout: 30000 });
  });

  test('should display scan results', async ({ page }) => {
    await page.click('button:has-text("Scan")');
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 30000 });
  });

  test('should clean selected files', async ({ page }) => {
    await page.click('button:has-text("Scan")');
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 30000 });

    const cleanButton = page.locator('button:has-text("Clean (")');
    if (await cleanButton.isEnabled()) {
      await cleanButton.click();
      await expect(page.locator('.card').first()).toBeHidden({ timeout: 30000 });
    }
  });
});
