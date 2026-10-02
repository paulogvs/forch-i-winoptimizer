import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

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

/** Inject a large installed-apps list to prove Tools → Apps virtualization. */
async function mockManyInstalledApps(page: Parameters<typeof setupElectronMock>[0], count: number): Promise<void> {
  await setupElectronMock(page);
  await page.addInitScript((n: number) => {
    const apps = Array.from({ length: n }, (_, i) => ({
      id: `app${i}`,
      name: `Application ${i}`,
      version: '1.0.0',
      publisher: 'Publisher',
      installDate: new Date().toISOString(),
      size: 1024,
      installLocation: `C:\\Apps\\App${i}`,
      uninstallString: `C:\\Apps\\App${i}\\uninstall.exe`,
      protection: 'safe',
      category: 'win32',
    }));
    const target = window as unknown as {
      electronAPI: { getInstalledApps: () => Promise<unknown> };
    };
    target.electronAPI.getInstalledApps = () => Promise.resolve(apps);
  }, count);
}

test.describe('Performance / virtualization', () => {
  test('renders a long driver list with a reduced DOM', async ({ page }) => {
    await mockManyDrivers(page, 500);
    await gotoApp(page);
    await page.click('.sidebar >> text=Drivers');

    await expect(page.locator('.virtual-list')).toBeVisible();

    const renderedRows = await page.locator('.driver-row').count();
    expect(renderedRows).toBeGreaterThan(0);
    // Virtualization + chunked reveal must keep the DOM far below the full list.
    expect(renderedRows).toBeLessThan(120);
  });

  test('renders a long installed-apps list in Tools → Apps with a reduced DOM', async ({ page }) => {
    await mockManyInstalledApps(page, 500);
    await gotoApp(page);
    await page.click('.sidebar >> text=Tools');
    await page.click('button:has-text("App Manager")');

    await expect(page.locator('[data-testid="installed-apps"].virtual-list')).toBeVisible();

    const renderedRows = await page.locator('.app-row').count();
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(120);
  });

  test('long sections skip off-screen work via content-visibility', async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
    await page.click('.sidebar >> text=Tweaks');
    const contentVisibility = await page
      .locator('.tweak-section')
      .first()
      .evaluate((el) => getComputedStyle(el).contentVisibility);
    expect(contentVisibility).toBe('auto');
  });
});
