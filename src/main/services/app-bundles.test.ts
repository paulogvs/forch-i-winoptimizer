import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAppBundles,
  checkInstalledApps,
  installApp,
  installApps,
  uninstallApp,
} from './app-bundles';

vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
  runPowerShellScript: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

import { runPowerShell, runPowerShellScript } from './powershell';

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

  // ===== P1.3: expanded winget catalog (IDs validated live in winget, 2026-10-01) =====

  describe('P1.3 catalog expansion', () => {
    const allApps = () => getAppBundles().flatMap((b) => b.apps);

    it('adds the productivity, communication and security bundles', () => {
      const bundles = getAppBundles();
      for (const category of ['productivity', 'communication', 'security'] as const) {
        const bundle = bundles.find((b) => b.category === category);
        expect(bundle, `missing bundle: ${category}`).toBeDefined();
        expect(bundle?.name.length).toBeGreaterThan(0);
        expect(bundle?.description.length).toBeGreaterThan(0);
        expect((bundle?.icon ?? '').length).toBeGreaterThan(0);
        expect(bundle?.apps.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('updates legacy entries to the winget ids validated in 2026', () => {
      const apps = allApps();
      expect(apps.find((a) => a.id === 'python')?.wingetId).toBe('Python.Python.3.13');
      expect(apps.find((a) => a.id === 'nodejs')?.wingetId).toBe('OpenJS.NodeJS.LTS');
      // JustinFinebel.HandBrake does NOT exist in winget; the official id does:
      expect(apps.find((a) => a.id === 'handbrake')?.wingetId).toBe('HandBrake.HandBrake');
      expect(apps.find((a) => a.id === 'everything')?.wingetId).toBe('voidtools.Everything');
    });

    it('ships every P1.3 plan winget id (live-validated)', () => {
      const wingetIds = new Set(allApps().map((a) => a.wingetId));
      const expected = [
        'Microsoft.PowerToys',
        'voidtools.Everything',
        'Python.Python.3.13',
        'OpenJS.NodeJS.LTS',
        'Microsoft.WindowsTerminal',
        'Microsoft.PowerShell',
        'Gyan.FFmpeg',
        'Obsidian.Obsidian',
        'Notion.Notion',
        'HandBrake.HandBrake',
        'Zoom.Zoom',
        'Telegram.TelegramDesktop',
        'SlackTechnologies.Slack',
        'OpenWhisperSystems.Signal',
        'Bitwarden.Bitwarden',
        'KeePassXCTeam.KeePassXC',
        'Malwarebytes.Malwarebytes',
        'WiresharkFoundation.Wireshark',
        'Flow-Launcher.Flow-Launcher',
        '9NKSQGP7F2NH',
      ];
      for (const id of expected) expect(wingetIds.has(id), `missing winget id: ${id}`).toBe(true);
    });

    it('keeps app ids and winget ids unique across all bundles', () => {
      const apps = allApps();
      const ids = apps.map((a) => a.id);
      expect(new Set(ids).size, 'duplicate app id').toBe(ids.length);
      const wids = apps.map((a) => a.wingetId);
      expect(new Set(wids).size, 'duplicate winget id').toBe(wids.length);
    });

    it('every winget id passes the P0.2 validation grammar', () => {
      const grammar = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
      for (const app of allApps()) {
        expect(app.wingetId, app.id).toMatch(grammar);
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

    it('detects a single installed app emitted as a bare JSON string (ConvertTo-Json single-item case)', async () => {
      // PowerShell `ConvertTo-Json` collapses a one-element pipeline into a bare
      // string, not an array. The old code called `.some()` on that string,
      // threw, and swallowed the error -> every bundle app reported "not installed".
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: JSON.stringify('Google Chrome'),
        stderr: '',
        exitCode: 0,
      });

      const result = await checkInstalledApps();
      expect(result.get('chrome')).toBe(true);
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
      vi.mocked(runPowerShellScript).mockResolvedValue({
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
      vi.mocked(runPowerShellScript).mockResolvedValue({
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
      expect(runPowerShellScript).not.toHaveBeenCalled();
    });

    it('rejects an empty package id without invoking PowerShell', async () => {
      const result = await installApp('');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid package id');
      expect(runPowerShellScript).not.toHaveBeenCalled();
    });

    it('generates a script that checks the winget exit code (never unconditional SUCCESS)', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      await installApp('Google.Chrome');

      const script = String(vi.mocked(runPowerShellScript).mock.calls[0]?.[0] ?? '');
      expect(script).toContain('$LASTEXITCODE');
      // winget reports failures on stderr/exit code, not via exceptions
      expect(script).not.toMatch(/winget install[\s\S]*Write-Output "SUCCESS"\s*;?\s*catch/);
    });

    it('returns success=false when the script reports a winget failure', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
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
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS\nGoogle Chrome is already installed',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApp('Google.Chrome');
      expect(result.success).toBe(true);
    });

    // ===== v0.10.1: honest, distinguishable timeout handling (BUG B) =====

    it('runs winget install with the long runner (not the 60s one) so slow installs are not killed', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      await installApp('Google.Chrome');

      expect(runPowerShellScript).toHaveBeenCalledTimes(1);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('does not misreport a slow-but-successful install as a failure', async () => {
      // Real measured case: 55 941 ms returned SUCCESS.
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApp('Google.Chrome');
      expect(result.success).toBe(true);
      expect(result.state).toBe('ok');
    });

    it('re-reads the real state after a timeout and reports success when the package did get installed', async () => {
      // Install was killed at the long timeout...
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Operation timed out',
        exitCode: 124,
      });
      // ...but the re-read proves winget actually finished installing it.
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'INSTALLED',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApp('Google.Chrome');

      expect(result.success).toBe(true);
      expect(result.state).toBe('timeout');
      expect(result.verified).toBe(true);
      expect(result.message.toLowerCase()).toContain('timed out');
      expect(result.message.toLowerCase()).toContain('installed');
    });

    it('does not claim success after a timeout when the package is not detected', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Operation timed out',
        exitCode: 124,
      });
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'NOT_INSTALLED',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApp('Google.Chrome');

      expect(result.success).toBe(false);
      expect(result.state).toBe('timeout');
      expect(result.verified).toBe(true);
      expect(result.message.toLowerCase()).toContain('timed out');
      expect(result.message.toLowerCase()).toContain('not detected');
    });
  });

  describe('installApps', () => {
    it('should install multiple apps', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
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
      vi.mocked(runPowerShellScript).mockImplementation(() => {
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
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      const result = await installApps(['Google.Chrome', 'bad id; calc']);

      expect(result.installed).toBe(1);
      expect(result.failed).toBe(1);
      expect(runPowerShellScript).toHaveBeenCalledTimes(1);
    });
  });

  describe('uninstallApp', () => {
    it('should uninstall app successfully', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
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
      vi.mocked(runPowerShellScript).mockResolvedValue({
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
      expect(runPowerShellScript).not.toHaveBeenCalled();
    });

    it('generates a script that checks the winget exit code', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      await uninstallApp('Google.Chrome');

      const script = String(vi.mocked(runPowerShellScript).mock.calls[0]?.[0] ?? '');
      expect(script).toContain('$LASTEXITCODE');
    });

    it('runs winget uninstall with the long runner so slow uninstalls are not killed', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: true,
        stdout: 'SUCCESS',
        stderr: '',
        exitCode: 0,
      });

      await uninstallApp('Google.Chrome');

      expect(runPowerShellScript).toHaveBeenCalledTimes(1);
      expect(runPowerShell).not.toHaveBeenCalled();
    });

    it('treats a timed-out uninstall whose package is gone as success', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Operation timed out',
        exitCode: 124,
      });
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'NOT_INSTALLED',
        stderr: '',
        exitCode: 0,
      });

      const result = await uninstallApp('Google.Chrome');

      expect(result.success).toBe(true);
      expect(result.state).toBe('timeout');
      expect(result.verified).toBe(true);
    });

    it('does not claim a timed-out uninstall succeeded while the package is still present', async () => {
      vi.mocked(runPowerShellScript).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Operation timed out',
        exitCode: 124,
      });
      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout: 'INSTALLED',
        stderr: '',
        exitCode: 0,
      });

      const result = await uninstallApp('Google.Chrome');

      expect(result.success).toBe(false);
      expect(result.state).toBe('timeout');
      expect(result.message.toLowerCase()).toContain('timed out');
    });
  });
});
