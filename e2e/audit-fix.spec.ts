import { test, expect } from '@playwright/test';
import { setupElectronMock } from './setup';
import { gotoApp } from './helpers';

const report = {
  checks: [
    {
      id: 'privacy-telemetry',
      name: 'Telemetry Level',
      category: 'privacy',
      status: 'critical',
      description: 'Telemetry is at default level',
      recommendation: 'Set telemetry to 0',
      impact: 'medium',
      autoFixable: true,
    },
  ],
  totalChecks: 1,
  passedCount: 0,
  warningCount: 0,
  criticalCount: 1,
  score: 85,
  timestamp: new Date().toISOString(),
};

test.describe('Audit — Fix navigation (v0.5.0)', () => {
  test.beforeEach(async ({ page }) => {
    await setupElectronMock(page);
    await gotoApp(page);
  });

  test('navigates a privacy fix to Security → Privacy instead of mutating blindly', async ({
    page,
  }) => {
    await page.evaluate((data) => {
      (window as unknown as { __auditReport?: unknown }).__auditReport = data;
    }, report);

    await page.click('.sidebar >> text=Audit');
    const fix = page.getByTestId('audit-fix-privacy-telemetry');
    await expect(fix).toBeVisible();
    await fix.click();

    await expect(page.locator('h2.page-title')).toHaveText('Security & Privacy');
    // The Privacy tab is selected by the Fix action.
    await expect(page.getByText('Apply All Privacy Settings')).toBeVisible();
  });
});
