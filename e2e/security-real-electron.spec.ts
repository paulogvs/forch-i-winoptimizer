import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

/**
 * Real-Electron end-to-end for the live security scanner (v0.6.0).
 *
 * Unlike the mocked browser suite, this launches the packaged main process and
 * verifies that `security:scan` reads the real machine end-to-end (renderer ->
 * preload -> IPC -> main -> PowerShell -> back). Assertions are intentionally
 * config-agnostic so the test is valid on Win10/11, Home/Pro/Ent, VMs, machines
 * with third-party AV, and without admin: we assert shape + honesty (valid
 * status, evidence always present), never a specific expected pass/fail.
 *
 * Run: npm run test:e2e:electron
 */

const VALID_STATUSES = [
  'pass',
  'warn',
  'fail',
  'unknown',
  'not-applicable',
  'requires-admin',
];

interface ScanCheck {
  id: string;
  status: string;
  evidence: string;
  reason: string;
}
interface ScanReport {
  checks: ScanCheck[];
  totalChecks: number;
  score: number | null;
  machine: { osCaption: string; isAdmin: boolean };
}

test('security scan runs in the real Electron main process', async () => {
  const appRoot = process.cwd();
  const app = await electron.launch({
    args: ['.'],
    cwd: appRoot,
    env: { ...process.env, FORCHI_E2E: '1' },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Wait until the React app has mounted its sidebar.
    await page.waitForSelector('.sidebar', { timeout: 60_000 });

    await page.click('.sidebar >> text=Security');
    await expect(page.locator('h2.page-title')).toHaveText('Security & Privacy');

    // Drive the scan through the real UI (not a direct IPC call). The first
    // run may take ~30 s end to end on a cold machine.
    await page.click('[data-testid="security-scan-button"]');
    await expect(page.locator('[data-testid="security-report"]')).toBeVisible({ timeout: 150_000 });

    const renderedChecks = await page.locator('[data-testid^="security-check-"]').count();
    expect(renderedChecks).toBeGreaterThanOrEqual(8);

    // Read the live report through the preload bridge: this proves the whole
    // main-process pipeline (PowerShell) produced data, not a renderer fixture.
    const report = await page.evaluate(async (): Promise<ScanReport> => {
      const api = (window as unknown as {
        winoptimizer: { security: { scan: (o?: { force?: boolean }) => Promise<ScanReport> } };
      }).winoptimizer;
      return api.security.scan({ force: true });
    });

    expect(report.checks.length).toBeGreaterThanOrEqual(8);
    expect(report.totalChecks).toBe(report.checks.length);

    for (const check of report.checks) {
      expect(VALID_STATUSES, `status of ${check.id}`).toContain(check.status);
      // Honesty invariant: every check must carry observed evidence, even when
      // it could not be measured.
      expect(check.evidence.length, `evidence of ${check.id}`).toBeGreaterThan(0);
      expect(check.reason.length, `reason of ${check.id}`).toBeGreaterThan(0);
    }

    // The score must be either a real 0-100 value or null (not scored) — never
    // a fabricated number.
    if (report.score !== null) {
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    }

    // Log the real report so the run is auditable.
    console.log('[security-live] report:', JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
});
