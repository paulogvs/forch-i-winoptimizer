import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';

/** Inject a large driver list to prove virtualization + chunked reveal (P0.4). */
async function mockManyDrivers(page: Parameters<typeof setupElectronMock>[0], count: number): Promise<void> {
  await setupElectronMock(page);
  await page.addInitScript((n: number) => {
    const drivers = Array.from({ length: n }, (_, i) => ({
      id: `d${i}`,
      name: `Device ${i}`,
      manufacturer: 'Generic',
      currentVersion: '1.0.0.0',
      latestVersion: '1.0.0.0',
      isUpToDate: true,
      deviceClass: 'System',
      hardwareId: `HW${i}`,
      releaseDate: '2025-01-01',
      downloadUrl: '',
      size: 0,
    }));
    const target = window as unknown as {
      winoptimizer: { drivers: { scan: () => Promise<unknown> } };
    };
    target.winoptimizer.drivers.scan = () =>
      Promise.resolve({ drivers, totalDevices: n, outdatedCount: 0, upToDateCount: n, scanDate: new Date() });
  }, count);
}

test.describe('Performance / virtualization', () => {
  test('renders a long driver list with a reduced DOM', async ({ page }) => {
    await mockManyDrivers(page, 500);
    await page.goto('/');
    await page.click('.sidebar >> text=Drivers');

    await expect(page.locator('.virtual-list')).toBeVisible();

    const renderedRows = await page.locator('.driver-row').count();
    expect(renderedRows).toBeGreaterThan(0);
    // Virtualization + chunked reveal must keep the DOM far below the full list.
    expect(renderedRows).toBeLessThan(120);
  });

  test('long sections skip off-screen work via content-visibility', async ({ page }) => {
    await setupElectronMock(page);
    await page.goto('/');
    await page.click('.sidebar >> text=Tweaks');
    const contentVisibility = await page
      .locator('.tweak-section')
      .first()
      .evaluate((el) => getComputedStyle(el).contentVisibility);
    expect(contentVisibility).toBe('auto');
  });
});
