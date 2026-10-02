import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

test.describe('Statistics — real data (v0.5.0)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
  });

  test('shows an honest empty state with no recorded activity', async ({ page }) => {
    await page.click('.sidebar >> text=Statistics');
    await expect(page.getByText('No activity recorded yet')).toBeVisible();
  });

  test('renders real charts from seeded events', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __statsEvents?: unknown }).__statsEvents = [
        {
          id: '1',
          type: 'scan',
          timestamp: '2026-01-01T10:00:00.000Z',
          files: 4,
          bytes: 1048576,
          score: null,
        },
        {
          id: '2',
          type: 'clean',
          timestamp: '2026-01-01T10:05:00.000Z',
          files: 4,
          bytes: 1048576,
          score: null,
        },
        {
          id: '3',
          type: 'audit',
          timestamp: '2026-01-01T10:10:00.000Z',
          files: 0,
          bytes: 0,
          score: 88,
        },
      ];
    });
    await page.click('.sidebar >> text=Statistics');
    await expect(page.getByTestId('chart-scan')).toBeVisible();
    await expect(page.getByTestId('chart-clean')).toBeVisible();
    await expect(page.getByTestId('chart-audit')).toBeVisible();
  });

  test('exports CSV and surfaces the result', async ({ page }) => {
    await page.click('.sidebar >> text=Statistics');
    await page.getByTestId('export-csv').click();
    await expect(page.getByText(/Exported .* event/)).toBeVisible();
  });
});
