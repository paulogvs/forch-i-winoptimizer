import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
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

  test('should show configuration profile actions', async ({ page }) => {
    await expect(page.getByTestId('profile-export')).toBeVisible();
    await expect(page.getByTestId('profile-import')).toBeVisible();
  });

  test('should reject an invalid profile file without applying anything', async ({ page }) => {
    await page.setInputFiles('[data-testid="profile-file"]', {
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{nope'),
    });
    await expect(page.getByTestId('profile-error')).toContainText(/not valid JSON/i);
    await expect(page.getByTestId('profile-preview')).toHaveCount(0);
  });

  test('should preview a valid profile and apply it after confirmation', async ({ page }) => {
    const profile = {
      kind: 'forchi-winoptimizer-profile',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        accentColor: '#06B6D4',
        startWithWindows: false,
        minimizeToTrayOnClose: false,
        enableNotifications: false,
        automaticUpdates: false,
        scanBrowserCache: true,
        scanWindowsTempFiles: true,
        scanRecycleBin: false,
        excludePaths: [],
      },
      appliedTweaks: [],
    };
    await page.setInputFiles('[data-testid="profile-file"]', {
      name: 'profile.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(profile)),
    });
    await expect(page.getByTestId('profile-preview')).toBeVisible();
    await page.getByTestId('profile-apply-confirm').click();
    await expect(page.getByTestId('profile-result')).toContainText(
      /0 applied, 0 failed, 0 skipped/
    );
  });
});
