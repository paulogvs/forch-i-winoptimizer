import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Tweaks', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
    await page.click('.sidebar >> text=Tweaks');
  });

  test('renders the Tweaks page and a safe tweak', async ({ page }) => {
    await expect(page.locator('h2.page-title')).toHaveText('Tweaks');
    await expect(page.locator('.tweak-name')).toContainText('Show file extensions');
    await expect(page.locator('.badge', { hasText: 'Safe' }).first()).toBeVisible();
    await expect(page.locator('.badge', { hasText: 'Reversible: Yes' }).first()).toBeVisible();
  });

  test('opens the preview modal with exact operations', async ({ page }) => {
    await page.getByRole('button', { name: 'Preview' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.tweak-preview-list').first()).toContainText('HideFileExt');
  });

  test('applies a tweak and reports feedback', async ({ page }) => {
    await page.locator('.tweak-actions').getByRole('button', { name: 'Apply' }).first().click();
    await expect(page.locator('.tweak-message').first()).toContainText('ok');
  });
});
