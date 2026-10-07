import { describe, it, expect } from 'vitest';
import { planBitLocker, planPerMachineMsi, planOfferedDriverInstall } from './elevated-kit-modes';

describe('planBitLocker', () => {
  const basePrereqs = {
    editionSupportsBitLocker: true,
    allowBitLockerWithoutTpm: true,
    freeSpaceOk: true,
    hasTpm: false,
    firmware: 'Legacy' as const,
    usbKeyPresent: false,
    passwordProvided: false,
    recoveryPathProvided: true,
  };

  it('aborts when the edition does not support BitLocker', () => {
    const plan = planBitLocker({ ...basePrereqs, editionSupportsBitLocker: false });
    expect(plan.ready).toBe(false);
    expect(plan.abortReason).toMatch(/edition/i);
    expect(plan.readyCommand).toBeTruthy();
  });

  it('aborts without forcing when the no-TPM policy is missing', () => {
    const plan = planBitLocker({ ...basePrereqs, allowBitLockerWithoutTpm: false });
    expect(plan.ready).toBe(false);
    expect(plan.abortReason).toMatch(/policy/i);
    // Must explain how to enable it, never force it blindly.
    expect(plan.readyCommand).toMatch(/gpedit|reg/i);
  });

  it('aborts when there is no viable protector (no USB and no password)', () => {
    const plan = planBitLocker({ ...basePrereqs });
    expect(plan.ready).toBe(false);
    expect(plan.protector).toBeNull();
    expect(plan.readyCommand).toMatch(/BitLockerPassword|USB/i);
  });

  it('prefers the USB startup key when a removable drive is present', () => {
    const plan = planBitLocker({ ...basePrereqs, usbKeyPresent: true, passwordProvided: true });
    expect(plan.ready).toBe(true);
    expect(plan.protector).toBe('usb-startup-key');
    expect(plan.tradeOff).toBeTruthy();
  });

  it('falls back to password protector on Legacy BIOS without TPM', () => {
    const plan = planBitLocker({ ...basePrereqs, passwordProvided: true });
    expect(plan.ready).toBe(true);
    expect(plan.protector).toBe('password');
    expect(plan.tradeOff).toMatch(/USB/i);
  });

  it('never encrypts without a recovery backup path', () => {
    const plan = planBitLocker({
      ...basePrereqs,
      passwordProvided: true,
      recoveryPathProvided: false,
    });
    expect(plan.ready).toBe(false);
    expect(plan.abortReason).toMatch(/recovery/i);
  });

  it('uses Used Space Only and requires verified recovery copy before encrypting', () => {
    const plan = planBitLocker({ ...basePrereqs, passwordProvided: true });
    expect(plan.ready).toBe(true);
    expect(plan.steps.join('\n')).toMatch(/Used Space Only/i);
    // Recovery backup + verification must precede the encrypt step.
    const recoveryIdx = plan.steps.findIndex((s) => /recovery/i.test(s));
    const encryptIdx = plan.steps.findIndex((s) => /enable-bitlocker|encrypt/i.test(s));
    expect(recoveryIdx).toBeGreaterThanOrEqual(0);
    expect(encryptIdx).toBeGreaterThan(recoveryIdx);
    expect(plan.revert).toMatch(/manage-bde|decrypt/i);
  });
});

describe('planPerMachineMsi', () => {
  it('resolves a real 7-Zip MSI uninstall string through the MSI channel', () => {
    const plan = planPerMachineMsi({
      displayName: '7-Zip',
      uninstallString: 'MsiExec.exe /X{23170F69-40C1-2702-1806-000001000000}',
    });
    expect(plan.ready).toBe(true);
    expect(plan.channel).toBe('msi');
    expect(plan.guid).toBe('23170F69-40C1-2702-1806-000001000000');
  });

  it('accepts an /I-registered MSI string via the canonical /x channel (documents the app-parser gap)', () => {
    // Real finding (2026-10-07): 7-Zip per-machine registers
    // `MsiExec.exe /I{...}` (modify), which the app parser (strict /X)
    // refuses. The product code is identical, so the kit extracts it and
    // always executes the canonical `msiexec /x {GUID}` uninstall.
    const plan = planPerMachineMsi({
      displayName: '7-Zip 25.01 (x64)',
      uninstallString: 'MsiExec.exe /I{23170F69-40C1-2702-2603-000001000000}',
    });
    expect(plan.ready).toBe(true);
    expect(plan.channel).toBe('msi-product-code');
    expect(plan.guid).toBe('23170F69-40C1-2702-2603-000001000000');
    expect(plan.note).toMatch(/\/x/i);
  });

  it('refuses an unparseable uninstall string without touching the system', () => {
    const plan = planPerMachineMsi({
      displayName: '7-Zip',
      uninstallString: 'rundll32.exe foo.dll,Bar',
    });
    expect(plan.ready).toBe(false);
    expect(plan.abortReason).toMatch(/uninstall string/i);
  });

  it('reports not-installed when there is no registry entry (DryRun reads only)', () => {
    const plan = planPerMachineMsi(null);
    expect(plan.ready).toBe(false);
    expect(plan.abortReason).toMatch(/not installed/i);
  });
});

describe('planOfferedDriverInstall', () => {
  it('is a no-op when Windows Update offers zero drivers', () => {
    const plan = planOfferedDriverInstall({ wuResponded: true, offeredCount: 0 });
    expect(plan.action).toBe('noop');
    expect(plan.reason).toMatch(/nothing to install|0 offered/i);
    expect(plan.steps.join('\n')).not.toMatch(/Install the offered|restore point/i);
  });

  it('never claims up-to-date when Windows Update did not answer', () => {
    const plan = planOfferedDriverInstall({ wuResponded: false, offeredCount: 0 });
    expect(plan.action).toBe('noop');
    expect(plan.reason).toMatch(/did not answer|no response/i);
  });

  it('runs the real pipeline only when at least one driver is offered', () => {
    const plan = planOfferedDriverInstall({ wuResponded: true, offeredCount: 2 });
    expect(plan.action).toBe('install-pipeline');
    const text = plan.steps.join('\n');
    expect(text).toMatch(/restore point/i);
    expect(text).toMatch(/install/i);
    expect(text).toMatch(/re-verify|verify/i);
  });
});
