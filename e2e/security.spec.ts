import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';

test.describe('Security', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await page.goto('/');
    await page.click('.sidebar >> text=Security');
  });

  test('should display security page', async ({ page }) => {
    await expect(page.locator('h2.page-title')).toHaveText('Security');
  });

  test('should run security scan', async ({ page }) => {
    await page.click('button:has-text("Run Security Scan")');
    await expect(page.locator('text=Passed')).toBeVisible({ timeout: 10000 });
  });

  test('should display security checks', async ({ page }) => {
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
  });

  test('should display passed checks', async ({ page }) => {
    await expect(page.locator('text=Passed')).toBeVisible({ timeout: 10000 });
  });

  test('should display warnings', async ({ page }) => {
    await expect(page.locator('text=Warnings')).toBeVisible({ timeout: 10000 });
  });
});
