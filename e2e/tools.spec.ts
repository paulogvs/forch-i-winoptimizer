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

    // The catalog renders after its async load, so wait for each row to exist
    // before asserting its enabled/disabled state.
    const safeRow = page.getByTestId('debloat-check-bingnews');
    const protectedRow = page.getByTestId('debloat-check-windowsstore');
    const notInstalledRow = page.getByTestId('debloat-check-clipchamp');
    await expect(safeRow).toBeVisible();
    await expect(protectedRow).toBeVisible();
    await expect(notInstalledRow).toBeVisible();

    await expect(safeRow).toBeEnabled();
    // Protected and not-installed rows must never be selectable.
    await expect(protectedRow).toBeDisabled();
    await expect(notInstalledRow).toBeDisabled();
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
    await expect(page.locator('text=Bloatware Removal')).toBeVisible();
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('debloat-check-bingnews').check();
    await page.click('button:has-text("Remove selected")');
    await expect(page.getByTestId('debloat-result')).toBeVisible();
    const protectedRow = page.getByTestId('debloat-check-windowsstore');
    await expect(protectedRow).toBeVisible();
    await expect(protectedRow).toBeDisabled();
  });

  test('should filter the debloat catalog through search (B3)', async ({ page }) => {
    await page.click('button:has-text("Debloat")');
    await expect(page.getByTestId('debloat-check-bingnews')).toBeVisible();
    await page.getByTestId('debloat-search').fill('news');
    await expect(page.getByTestId('debloat-check-bingnews')).toBeVisible();
    await expect(page.getByTestId('debloat-check-todo')).toBeHidden();
    await expect(page.getByTestId('debloat-check-xbox')).toBeHidden();
  });

  test('should select/clear selectable apps per category with a pre-removal summary (B3)', async ({
    page,
  }) => {
    await page.click('button:has-text("Debloat")');
    await expect(page.getByTestId('debloat-check-bingnews')).toBeVisible();

    await page.getByTestId('debloat-select-all-bloatware').click();
    await expect(page.getByTestId('debloat-check-bingnews')).toBeChecked();
    await expect(page.getByTestId('debloat-check-todo')).toBeChecked();
    await expect(page.getByTestId('debloat-check-xbox')).toBeChecked();
    // Protected and not-installed rows are never taken by select-all.
    await expect(page.getByTestId('debloat-check-windowsstore')).not.toBeChecked();
    await expect(page.getByTestId('debloat-check-clipchamp')).not.toBeChecked();

    const summary = page.getByTestId('debloat-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('MSN News');
    await expect(summary).toContainText('Xbox App');

    await page.getByTestId('debloat-clear-bloatware').click();
    await expect(page.getByTestId('debloat-check-bingnews')).not.toBeChecked();
    await expect(summary).toBeHidden();
  });

  test('should show a receipt and a post-check note after removal (B3)', async ({ page }) => {
    await page.click('button:has-text("Debloat")');
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('debloat-check-bingnews').check();
    await page.click('button:has-text("Remove selected")');
    await expect(page.getByTestId('debloat-result')).toHaveText(/Removed 1 app/);
    const receipt = page.getByTestId('debloat-receipt');
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('bingnews');
    await expect(receipt).toContainText('removed');
    await expect(page.getByTestId('debloat-verify')).toContainText(/Post-check/);
  });

  test('should switch to app manager tab', async ({ page }) => {
    await page.click('button:has-text("App Manager")');
    await expect(page.locator('text=Installed Apps')).toBeVisible();
  });

  test('should switch to startup manager tab', async ({ page }) => {
    await page.click('button:has-text("Startup Manager")');
    await expect(page.locator('text=Startup Apps')).toBeVisible();
  });

  test('should switch to utilities tab and list real Windows tools', async ({ page }) => {
    await page.click('button:has-text("Utilities")');
    await expect(page.locator('text=Task Manager')).toBeVisible();
    await expect(page.getByTestId('launch-tool-task-manager')).toBeVisible();
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
