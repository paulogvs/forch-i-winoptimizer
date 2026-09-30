import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';

test.describe('Tools', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await page.goto('/');
    await page.click('.sidebar >> text=Tools');
  });

  test('should display tools page', async ({ page }) => {
    await expect(page.locator('h2.page-title')).toHaveText('Tools');
  });

  test('should display app manager tab', async ({ page }) => {
    await expect(page.locator('button:has-text("App Manager")')).toBeVisible();
  });

  test('should display startup manager tab', async ({ page }) => {
    await expect(page.locator('button:has-text("Startup Manager")')).toBeVisible();
  });

  test('should display utilities tab', async ({ page }) => {
    await expect(page.locator('button:has-text("Utilities")')).toBeVisible();
  });

  test('should switch to app manager tab', async ({ page }) => {
    await page.click('button:has-text("App Manager")');
    await expect(page.locator('text=Installed Apps')).toBeVisible();
  });

  test('should switch to startup manager tab', async ({ page }) => {
    await page.click('button:has-text("Startup Manager")');
    await expect(page.locator('text=Startup Apps')).toBeVisible();
  });

  test('should switch to utilities tab', async ({ page }) => {
    await page.click('button:has-text("Utilities")');
    await expect(page.locator('text=Registry Cleaner')).toBeVisible();
  });

  test('should display installed apps', async ({ page }) => {
    await page.click('button:has-text("App Manager")');
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
  });

  test('should display startup apps', async ({ page }) => {
    await page.click('button:has-text("Startup Manager")');
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
  });
});
