import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';

test.describe('Advanced feature pages', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await page.goto('/');
  });

  const pages: { nav: string; title: string }[] = [
    { nav: 'Drivers', title: 'Driver Updater' },
    { nav: 'Network', title: 'Network Fixer' },
    { nav: 'Audit', title: 'System Audit' },
    { nav: 'Benchmark', title: 'Benchmark' },
    { nav: 'Bundles', title: 'App Bundles' },
    { nav: 'Cleaning', title: 'Scheduled Cleaning' },
  ];

  for (const { nav, title } of pages) {
    test(`should navigate to ${nav}`, async ({ page }) => {
      await page.click(`.sidebar >> text=${nav}`);
      await expect(page.locator('h2.page-title')).toHaveText(title);
    });
  }
});
