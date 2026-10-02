import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
  });

  test('should display dashboard page', async ({ page }) => {
    await expect(page.locator('h2.page-title')).toHaveText('Dashboard');
  });

  test('should display CPU usage', async ({ page }) => {
    await expect(page.locator('text=CPU Usage')).toBeVisible();
  });

  test('should display memory usage', async ({ page }) => {
    await expect(page.locator('text=Memory')).toBeVisible();
  });

  test('should display disk usage', async ({ page }) => {
    await expect(page.locator('text=Disk')).toBeVisible();
  });

  test('should display system information', async ({ page }) => {
    await expect(page.locator('text=System Information')).toBeVisible();
  });

  test('should display GPU information', async ({ page }) => {
    await expect(page.locator('text=GPU Information')).toBeVisible();
  });

  test('should display quick actions', async ({ page }) => {
    await expect(page.locator('text=Quick Actions')).toBeVisible();
  });

  test('should refresh system info', async ({ page }) => {
    await page.click('button:has-text("Refresh")');
    await expect(page.locator('text=CPU Usage')).toBeVisible({ timeout: 10000 });
  });
});
