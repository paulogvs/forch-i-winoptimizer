import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';

test.describe('Boost', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await page.goto('/');
    await page.click('.sidebar >> text=Boost');
  });

  test('should display boost page', async ({ page }) => {
    await expect(page.locator('h2.page-title')).toHaveText('Boost');
  });

  test('should display optimizable services', async ({ page }) => {
    await expect(page.locator('text=Optimizable Services')).toBeVisible({ timeout: 10000 });
  });

  test('should select services for optimization', async ({ page }) => {
    const toggles = page.locator('.toggle');
    const count = await toggles.count();
    if (count > 0) {
      await toggles.first().click();
      await expect(page.locator('text=1 services selected')).toBeVisible();
    }
  });

  test('should apply optimizations', async ({ page }) => {
    const toggles = page.locator('.toggle');
    const count = await toggles.count();
    if (count > 0) {
      await toggles.first().click();
      await page.click('button:has-text("Apply Selected")');
      await expect(page.locator('text=services selected')).toBeVisible({ timeout: 10000 });
    }
  });
});
