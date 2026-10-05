import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

const outdatedDriver = {
  id: 'PCI\\VEN_10DE&DEV_2206',
  name: 'NVIDIA GeForce RTX 3080',
  manufacturer: 'NVIDIA',
  currentVersion: '500.0.0',
  latestVersion: '551.86',
  isUpToDate: false,
  status: 'update-available',
  deviceClass: 'Display',
  hardwareId: 'PCI\\VEN_10DE&DEV_2206',
  releaseDate: '2025-03-15',
  downloadUrl: '',
  size: 650_000_000,
  source: 'windows-update',
  updateTitle: 'NVIDIA - Display - 551.86',
  automatic: true,
  requiresAdmin: true,
};

async function mockOutdatedDriver(page: Page) {
  // Override the scan AFTER the bridge mocks exist but BEFORE the Drivers
  // page mounts (it scans on mount), so the UI renders one outdated driver.
  await page.evaluate((driver) => {
    const w = window as unknown as {
      winoptimizer: { drivers: { scan: () => Promise<unknown> } };
    };
    w.winoptimizer.drivers.scan = () =>
      Promise.resolve({
        drivers: [driver],
        totalDevices: 1,
        outdatedCount: 1,
        upToDateCount: 0,
        unknownCount: 0,
        wuStatus: 'ok',
        wuMessage: '',
        scanDate: new Date(),
      });
  }, outdatedDriver);
}

test.describe('Drivers honesty (Fase 0.2 / Fase 2.6)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
    await mockOutdatedDriver(page);
    await page.click('.sidebar >> text=Drivers');
  });

  test('Update reports a manual action, never a fake success', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
    await page.getByRole('button', { name: 'Update' }).click();
    const status = page.getByRole('status');
    await expect(status).toContainText(/manual action required/i);
    // The message must name the URL that was opened (the E2E bridge mock
    // answers with its fixed manual-action payload).
    await expect(status).toContainText('https://example.com/driver');
  });

  test('offers a real Rollback button, not the old "Restart device" label', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Rollback' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restart device' })).toHaveCount(0);
  });

  test('shows the reboot notice and the verified restore point after a completed install', async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as unknown as { __driverInstallResult?: unknown }).__driverInstallResult = {
        success: true,
        status: 'completed',
        driverId: 'PCI\\VEN_10DE&DEV_2206',
        verified: true,
        restorePointCreated: true,
        rebootRequired: true,
        rollbackAvailable: true,
        message: 'Installed 551.86 and verified (device OK).',
      };
    });
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByRole('alert')).toContainText(/reboot is required/i);
    await expect(page.getByText(/restore point created and verified/i)).toBeVisible();
  });
});
