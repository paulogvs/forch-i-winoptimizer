import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAppBundles, checkInstalledApps, installApp, installApps, uninstallApp } from './app-bundles';

vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

import { runPowerShell } from './powershell';

describe('App Bundles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAppBundles', () => {
    it('should return app bundles', () => {
      const bundles = getAppBundles();
      expect(bundles.length).toBeGreaterThan(0);
      expect(bundles[0]).toHaveProperty('id');
      expect(bundles[0]).toHaveProperty('name');
      expect(bundles[0]).toHaveProperty('apps');
    });

    it('should include all categories', () => {
      const bundles = getAppBundles();
      const categories = new Set(bundles.map((b) => b.category));
      expect(categories.has('browsers')).toBe(true);
      expect(categories.has('media')).toBe(true);
      expect(categories.has('devtools')).toBe(true);
      expect(categories.has('utilities')).toBe(true);
      expect(categories.has('games')).toBe(true);
    });

    it('should have apps in each bundle', () => {
      const bundles = getAppBundles();
      for (const bundle of bundles) {
        expect(bundle.apps.length).toBeGreaterThan(0);
      }
    });
  });

  describe('checkInstalledApps', () => {
    it('should return map of installed apps', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify(['Google Chrome', 'Visual Studio Code']),
        stderr: '',
        exitCode: 0,
      });

      const result = await checkInstalledApps();
      expect(result.get('chrome')).toBe(true);
      expect(result.get('vscode')).toBe(true);
      expect(result.get('firefox')).toBe(false);
    });

    it('should handle empty installed list', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify([]),
        stderr: '',
        exitCode: 0,
      });

      const result = await checkInstalledApps();
      expect(result.get('chrome')).toBe(false);
    });

    it('should handle PowerShell error', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Error',
        exitCode: 1,
      });

      const result = await checkInstalledApps();
      expect(result.size).toBe(0);
    });
  });

  describe('installApp', () => {
    it('should install app successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApp('Google.Chrome');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully installed');
    });

    it('should handle install failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Package not found',
        exitCode: 1,
      });

      const result = await installApp('Invalid.Package');
      expect(result.success).toBe(false);
    });

    // ===== P0.2: winget exit code + package id validation =====

    it('rejects a package id containing shell metacharacters without invoking PowerShell', async () => {
      const result = await installApp('Google.Chrome"; Remove-Item C:\\ -Recurse; Write-Output "');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid package id');
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('rejects an empty package id without invoking PowerShell', async () => {
      const result = await installApp('');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid package id');
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('generates a script that checks the winget exit code (never unconditional SUCCESS)', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      await installApp('Google.Chrome');

      const script = String(vi.mocked(runPowerShell).mock.calls[0]?.[0] ?? '');
      expect(script).toContain('$LASTEXITCODE');
      // winget reports failures on stderr/exit code, not via exceptions
      expect(script).not.toMatch(/winget install[\s\S]*Write-Output "SUCCESS"\s*;?\s*catch/);
    });

    it('returns success=false when the script reports a winget failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'FAILED: winget exit 0x8A150014',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApp('Google.Chrome');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to install');
    });

    it('treats "already installed" as success', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS\nGoogle Chrome is already installed',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApp('Google.Chrome');
      expect(result.success).toBe(true);
    });
  });

  describe('installApps', () => {
    it('should install multiple apps', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApps(['Google.Chrome', 'Mozilla.Firefox']);
      expect(result.success).toBe(true);
      expect(result.installed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('should handle partial failures', async () => {
      let callCount = 0;
      vi.mocked(runPowerShell).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            stdout: 'SUCCESS',
            stderr: '',
            exitCode: 0,
          });
        }
        return Promise.resolve({
          success: false,
          stdout: '',
          stderr: 'Error',
          exitCode: 1,
        });
      });

      const result = await installApps(['Google.Chrome', 'Invalid.Package']);
      expect(result.installed).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('counts an injected package id as a failure without invoking PowerShell', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApps(['Google.Chrome', 'bad id; calc']);

      expect(result.installed).toBe(1);
      expect(result.failed).toBe(1);
      expect(runPowerShell).toHaveBeenCalledTimes(1);
    });
  });

  describe('uninstallApp', () => {
    it('should uninstall app successfully', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await uninstallApp('Google.Chrome');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully uninstalled');
    });

    it('should handle uninstall failure', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Package not found',
        exitCode: 1,
      });

      const result = await uninstallApp('Invalid.Package');
      expect(result.success).toBe(false);
    });

    // ===== P0.2: winget exit code + package id validation =====

    it('rejects a malicious package id without invoking PowerShell', async () => {
      const result = await uninstallApp('Google.Chrome; Stop-Computer');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid package id');
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('generates a script that checks the winget exit code', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      await uninstallApp('Google.Chrome');

      const script = String(vi.mocked(runPowerShell).mock.calls[0]?.[0] ?? '');
      expect(script).toContain('$LASTEXITCODE');
    });
  });
});
