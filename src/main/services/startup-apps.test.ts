import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as PowerShellModule from './powershell';
import type { PowerShellResult } from './powershell';

/**
 * Dedicated coverage for the `startup:toggle` channel — the last mutating
 * channel that had no test of its own.
 *
 * The whole point of the v0.9.1 fix is that the verdict comes from a *read-back
 * of the registry*, never from a bare PowerShell exit code. A script can print
 * `OK` (or finish with status 0) while the value never changed, so every case
 * below drives the answer from what the read-back reports.
 *
 * `runPowerShell` is mocked: the real registry is never touched.
 */
vi.mock('./powershell', async (importOriginal) => {
  const actual = await importOriginal<typeof PowerShellModule>();
  return { ...actual, runPowerShell: vi.fn() };
});

import { runPowerShell } from './powershell';
import { toggleStartupApp } from './startup-apps';

const mockedRunPowerShell = vi.mocked(runPowerShell);

const ENUMERATION_MARKER = 'New-Object System.Collections.ArrayList';

const STARTUP_ITEM = {
  Name: 'Discord',
  Command: '"C:\\Users\\TestUser\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe',
  Location: 'HKCU',
  Origin: 'hkcu-run',
  ExePath: 'C:\\Users\\TestUser\\AppData\\Local\\Discord\\Update.exe',
  Exists: true,
  SigStatus: 'Valid',
  Signer: 'CN=Discord Inc., O=Discord Inc., C=US',
  UnderSystem: false,
  Running: true,
  CpuSeconds: 12.5,
  MemoryMb: 256,
};

function enumerationResult(items: unknown[] = [STARTUP_ITEM]): PowerShellResult {
  return { success: true, stdout: JSON.stringify(items), stderr: '', exitCode: 0 };
}

/** Wire the mock so enumeration returns `items` and the toggle returns `toggle`. */
function mockPowerShell(toggle: PowerShellResult, items: unknown[] = [STARTUP_ITEM]): void {
  mockedRunPowerShell.mockImplementation(async (script: string) =>
    script.includes(ENUMERATION_MARKER) ? enumerationResult(items) : toggle
  );
}

/** The last script passed to PowerShell (the actual toggle command). */
function lastToggleScript(): string {
  const calls = mockedRunPowerShell.mock.calls;
  const script = calls[calls.length - 1]?.[0];
  if (typeof script !== 'string') throw new Error('no toggle script was captured');
  return script;
}

const OK: PowerShellResult = { success: true, stdout: 'OK', stderr: '', exitCode: 0 };

describe('toggleStartupApp — honest read-back (startup:toggle)', () => {
  beforeEach(() => {
    mockedRunPowerShell.mockReset();
    mockPowerShell(OK);
  });

  it('enables an app when the registry read-back confirms the written value', async () => {
    const result = await toggleStartupApp('startup-Discord', true);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Discord enabled/i);

    // Regression guard: enabling must re-read the value it just wrote instead of
    // trusting the command. If that read-back is ever dropped, this fails.
    const script = lastToggleScript();
    expect(script).toContain('Set-ItemProperty');
    expect(script).toContain('Get-ItemProperty');
    expect(script).toMatch(/value mismatch/i);
  });

  it('disables an app when the HKCU value is gone and no HKLM copy remains', async () => {
    const result = await toggleStartupApp('startup-Discord', false);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Discord disabled/i);

    const script = lastToggleScript();
    expect(script).toContain('Remove-ItemProperty');
    // Must also check the machine-wide key, otherwise a HKLM entry is a silent
    // no-op that used to be reported as success.
    expect(script).toContain('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run');
  });

  it('reports a REAL failure when the enable read-back does not confirm (v0.9.1 bug)', async () => {
    mockPowerShell({
      success: true,
      stdout: 'FAILED: value mismatch',
      stderr: '',
      exitCode: 0,
    });

    const result = await toggleStartupApp('startup-Discord', true);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/failed to enable/i);
    expect(result.message).toMatch(/value mismatch/i);
  });

  it('reports a REAL failure when the entry is machine-wide (HKLM) and cannot be disabled', async () => {
    mockPowerShell({
      success: true,
      stdout: 'FAILED: entry is machine-wide (HKLM)',
      stderr: '',
      exitCode: 0,
    });

    const result = await toggleStartupApp('startup-Discord', false);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/machine-wide/i);
    expect(result.message).toMatch(/failed to disable/i);
  });

  it('reports a REAL failure when the HKCU value is still present after removal', async () => {
    mockPowerShell({
      success: true,
      stdout: 'FAILED: HKCU value still present',
      stderr: '',
      exitCode: 0,
    });

    const result = await toggleStartupApp('startup-Discord', false);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/still present/i);
  });

  it('surfaces the real error and does not claim success without permissions', async () => {
    mockPowerShell({
      success: false,
      stdout: '',
      stderr: 'Access is denied',
      exitCode: 1,
    });

    const result = await toggleStartupApp('startup-Discord', false);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/failed to disable/i);
    expect(result.message).toContain('Access is denied');
  });

  it('reports "not found" and never issues a mutating command for an unknown app', async () => {
    mockPowerShell(OK, []);

    const result = await toggleStartupApp('startup-Ghost', true);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
    // Only the read-only enumeration ran; no registry write was attempted.
    expect(mockedRunPowerShell).toHaveBeenCalledTimes(1);
  });

  it('escapes apostrophes so a name cannot break out of the PowerShell literal', async () => {
    const tricky = {
      ...STARTUP_ITEM,
      Name: "Bob's App",
      Command: "C:\\Tools\\Bob's App.exe",
    };
    mockPowerShell(OK, [tricky]);

    await toggleStartupApp("startup-Bob's App", true);

    const script = lastToggleScript();
    expect(script).toContain("'Bob''s App'");
    expect(script).toContain("'C:\\Tools\\Bob''s App.exe'");
  });
});
