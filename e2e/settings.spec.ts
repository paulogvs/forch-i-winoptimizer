import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await page.goto('/');
    await page.click('.sidebar >> text=Settings');
  });

  test('should display settings page', async ({ page }) => {
    await expect(page.locator('h2.page-title')).toHaveText('Settings');
  });

  test('should display appearance settings', async ({ page }) => {
    await expect(page.locator('h3.card-title:has-text("Appearance")')).toBeVisible();
  });

  test('should display general settings', async ({ page }) => {
    await expect(page.locator('h3.card-title:has-text("General")')).toBeVisible();
  });

  test('should display cleaner settings', async ({ page }) => {
    await expect(page.locator('h3.card-title:has-text("Cleaner")')).toBeVisible();
  });

  test('should display updates section', async ({ page }) => {
    await expect(page.locator('h3.card-title:has-text("Updates")')).toBeVisible();
  });

  test('should display about section', async ({ page }) => {
    await expect(page.locator('h3.card-title:has-text("About")')).toBeVisible();
  });

  test('should check for updates', async ({ page }) => {
    await page.click('button:has-text("Check for Updates")');
    await expect(page.locator('text=Up to Date')).toBeVisible({ timeout: 10000 });
  });

  test('should toggle dark mode', async ({ page }) => {
    const toggle = page.locator('.toggle').first();
    const wasChecked = await toggle.getAttribute('aria-checked');
    await toggle.click();
    const isChecked = await toggle.getAttribute('aria-checked');
    expect(isChecked).not.toBe(wasChecked);
  });
});
