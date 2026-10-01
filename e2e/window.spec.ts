import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';

test.describe('Window controls', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await page.goto('/');
  });

  test('renders minimize, maximize and close controls', async ({ page }) => {
    await expect(page.getByTestId('window-controls')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Minimize' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Maximize' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  test('window controls are keyboard focusable', async ({ page }) => {
    const minimize = page.getByRole('button', { name: 'Minimize' });
    await minimize.focus();
    await expect(minimize).toBeFocused();
  });

  test('the header is the drag region and controls opt out', async ({ page }) => {
    const header = page.locator('header.titlebar');
    await expect(header).toBeVisible();
    const appRegion = await header.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim()
    );
    expect(appRegion).toBe('drag');
  });
});
