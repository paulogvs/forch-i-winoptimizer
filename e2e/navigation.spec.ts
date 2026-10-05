import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
  });

  test('should display sidebar', async ({ page }) => {
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('should display all nav items', async ({ page }) => {
    await expect(page.locator('.sidebar >> text=Dashboard')).toBeVisible();
    await expect(page.locator('.sidebar >> text=Cleaner')).toBeVisible();
    await expect(page.locator('.sidebar >> text=Boost')).toBeVisible();
    await expect(page.locator('.sidebar >> text=Tools')).toBeVisible();
    await expect(page.locator('.sidebar >> text=Security')).toBeVisible();
    await expect(page.locator('.sidebar >> text=Settings')).toBeVisible();
  });

  test('should navigate to cleaner', async ({ page }) => {
    await page.click('.sidebar >> text=Cleaner');
    await expect(page.locator('h2.page-title')).toHaveText('Cleaner');
  });

  test('should navigate to boost', async ({ page }) => {
    await page.click('.sidebar >> text=Boost');
    await expect(page.locator('h2.page-title')).toHaveText('Boost');
  });

  test('should navigate to tools', async ({ page }) => {
    await page.click('.sidebar >> text=Tools');
    await expect(page.locator('h2.page-title')).toHaveText('Tools');
  });

  test('should navigate to security', async ({ page }) => {
    await page.click('.sidebar >> text=Security');
    await expect(page.locator('h2.page-title')).toHaveText('Security & Privacy');
  });

  test('should navigate to settings', async ({ page }) => {
    await page.click('.sidebar >> text=Settings');
    await expect(page.locator('h2.page-title')).toHaveText('Settings');
  });

  test('Fase 0.1: header gear opens Settings', async ({ page }) => {
    await page.click('[data-testid="open-settings"]');
    await expect(page.locator('h2.page-title')).toHaveText('Settings');
  });

  test('should display brand badge', async ({ page }) => {
    await expect(page.locator('text=Built with FORCH.i by Paulo Velasco')).toBeVisible();
  });

  test('should display status bar', async ({ page }) => {
    await expect(page.locator('.status-bar')).toBeVisible();
  });

  test('should display version in status bar', async ({ page }) => {
    await expect(page.locator('.status-bar')).toContainText(/v\d+\.\d+\.\d+/);
  });
});
