import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Settings — live controls (v0.5.0)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
    await page.click('.sidebar >> text=Settings');
  });

  test('renders no disabled "Not implemented yet" stubs', async ({ page }) => {
    await expect(page.locator('[title="Not implemented yet"]')).toHaveCount(0);
    await expect(
      page.locator('button[title="Accent color customization is not implemented yet"]')
    ).toHaveCount(0);
  });

  test('persists a toggle change and reflects the authoritative state', async ({ page }) => {
    const toggle = page.getByRole('switch', { name: 'Enable notifications' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('applies the accent colour to the document root', async ({ page }) => {
    // Playwright's fill() does not fire the input event for type=color inputs,
    // and React ignores a plain `value` assignment. Use the native setter so
    // React's value tracker sees the change, then dispatch `input`.
    await page.locator('input[type="color"]').evaluate((element) => {
      const input = element as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      nativeSetter?.call(input, '#ff0000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--color-accent').toLowerCase()
        )
      )
      .toBe('#ff0000');
  });

  test('disables Start with Windows and explains it in the portable build', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __environment?: unknown }).__environment = {
        portable: true,
        loginItemSupported: false,
      };
    });
    // Remount Settings so it re-reads the environment.
    await page.click('.sidebar >> text=Dashboard');
    await page.click('.sidebar >> text=Settings');

    await expect(page.getByRole('switch', { name: 'Start with Windows' })).toBeDisabled();
    await expect(
      page.getByText(/Start with Windows is not available in the portable build/i)
    ).toBeVisible();
  });

  test('exposes the automatic updates status panel with a Check now action', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Check now' })).toBeVisible();
  });
});
