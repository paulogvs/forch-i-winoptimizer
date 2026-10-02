import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Tools', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
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

  test('should display debloat tab', async ({ page }) => {
    await expect(page.locator('button:has-text("Debloat")')).toBeVisible();
  });

  test('should list the curated catalog with protection guards (P1.4)', async ({ page }) => {
    await page.click('button:has-text("Debloat")');
    await expect(page.locator('text=Bloatware Removal')).toBeVisible();
    await expect(page.getByTestId('debloat-check-bingnews')).toBeEnabled();
    // Protected and not-installed rows must never be selectable.
    await expect(page.getByTestId('debloat-check-windowsstore')).toBeDisabled();
    await expect(page.getByTestId('debloat-check-clipchamp')).toBeDisabled();
    await expect(page.getByText('protected', { exact: true })).toBeVisible();
    await expect(page.locator('text=not installed').first()).toBeVisible();
  });

  test('should confirm and remove selected safe apps (P1.4)', async ({ page }) => {
    await page.click('button:has-text("Debloat")');
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('debloat-check-bingnews').check();
    await page.getByTestId('debloat-check-todo').check();
    await page.click('button:has-text("Remove selected")');
    await expect(page.getByTestId('debloat-result')).toHaveText(/Removed 2 app/);
  });

  test('should keep protected apps unselectable even after a removal (P1.4)', async ({ page }) => {
    await page.click('button:has-text("Debloat")');
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('debloat-check-bingnews').check();
    await page.click('button:has-text("Remove selected")');
    await expect(page.getByTestId('debloat-result')).toBeVisible();
    await expect(page.getByTestId('debloat-check-windowsstore')).toBeDisabled();
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
