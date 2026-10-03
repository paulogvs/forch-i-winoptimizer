import { describe, it, expect } from 'vitest';
import {
  buildApplyCommand,
  buildFixPreview,
  buildRevertCommand,
  decodeFixObservation,
  encodeOriginal,
  formatObservation,
  formatOriginal,
  isOriginalObservation,
  isTargetObservation,
  type FixObservation,
} from './security-fix';

/**
 * These tests never execute a fix. They exercise the pure planners and prove
 * the preview/apply/revert round-trip restores the EXACT captured value.
 */

const smbEnabled: FixObservation = { checkId: 'smb1', available: true, enabled: true };
const smbDisabled: FixObservation = { checkId: 'smb1', available: true, enabled: false };
const guestEnabled: FixObservation = {
  checkId: 'guest-account',
  available: true,
  name: 'Guest',
  enabled: true,
};
const rdpAllowed: FixObservation = { checkId: 'remote-desktop', available: true, deny: 0 };
const rdpDenied: FixObservation = { checkId: 'remote-desktop', available: true, deny: 1 };

describe('buildFixPreview', () => {
  it('blocks with requires-admin when not elevated (never silently)', () => {
    const preview = buildFixPreview('smb1', smbEnabled, { isAdmin: false, storedOriginal: null });
    expect(preview.canApply).toBe(false);
    expect(preview.blockedReason).toBe('requires-admin');
    expect(preview.blockedMessage).toMatch(/administrator/i);
    // The observed current value is still shown to the user.
    expect(preview.current).toBe('SMBv1 enabled');
    expect(preview.target).toBe('SMBv1 disabled');
  });

  it('allows the change when elevated and the target is not yet in place', () => {
    const preview = buildFixPreview('smb1', smbEnabled, { isAdmin: true, storedOriginal: null });
    expect(preview.canApply).toBe(true);
    expect(preview.blockedReason).toBeNull();
    expect(preview.reversible).toBe(true);
    expect(preview.requiresAdmin).toBe(true);
  });

  it('reports already-applied instead of offering a no-op', () => {
    expect(
      buildFixPreview('smb1', smbDisabled, { isAdmin: true, storedOriginal: null }).blockedReason
    ).toBe('already-applied');
    expect(
      buildFixPreview('remote-desktop', rdpDenied, { isAdmin: true, storedOriginal: null })
        .blockedReason
    ).toBe('already-applied');
  });

  it('reports unavailable when the value cannot be read', () => {
    const preview = buildFixPreview(
      'smb1',
      { checkId: 'smb1', available: false, enabled: null },
      { isAdmin: true, storedOriginal: null }
    );
    expect(preview.blockedReason).toBe('unavailable');
    expect(preview.canApply).toBe(false);
  });

  it('exposes revert only when an original is stored AND the user is elevated', () => {
    const withOriginal = buildFixPreview('smb1', smbEnabled, {
      isAdmin: true,
      storedOriginal: 'disabled',
    });
    expect(withOriginal.canRevert).toBe(true);
    expect(withOriginal.original).toBe('SMBv1 disabled');

    const noAdmin = buildFixPreview('smb1', smbEnabled, {
      isAdmin: false,
      storedOriginal: 'disabled',
    });
    expect(noAdmin.canRevert).toBe(false);
  });

  it('describes the Guest and RDP changes with the observed value', () => {
    const guest = buildFixPreview('guest-account', guestEnabled, {
      isAdmin: true,
      storedOriginal: null,
    });
    expect(guest.current).toBe('Guest account (Guest) enabled');
    expect(guest.target).toBe('Guest account disabled');

    const rdp = buildFixPreview('remote-desktop', rdpAllowed, {
      isAdmin: true,
      storedOriginal: null,
    });
    expect(rdp.current).toBe('fDenyTSConnections=0');
    expect(rdp.target).toBe('fDenyTSConnections=1');
  });
});

describe('round-trip: apply then revert restores the exact previous value', () => {
  it('smb1 restores enabled', () => {
    const original = encodeOriginal(smbEnabled);
    expect(original).toBe('enabled');
    const revert = buildRevertCommand('smb1', original);
    expect(revert).toMatch(/\$target = \$true/);
    expect(revert).toMatch(/-Name 'SMB1' -Value 1/);
  });

  it('smb1 restores disabled', () => {
    const original = encodeOriginal(smbDisabled);
    expect(original).toBe('disabled');
    expect(buildRevertCommand('smb1', original)).toMatch(/\$target = \$false/);
    expect(buildRevertCommand('smb1', original)).toMatch(/-Name 'SMB1' -Value 0/);
  });

  it('guest restores the enabled account', () => {
    const original = encodeOriginal(guestEnabled);
    expect(original).toBe('enabled');
    expect(buildRevertCommand('guest-account', original)).toMatch(/Enable-LocalUser/);
  });

  it('rdp restores the exact previous numeric value', () => {
    const original = encodeOriginal(rdpAllowed);
    expect(original).toBe('0');
    const revert = buildRevertCommand('remote-desktop', original);
    expect(revert).toMatch(/-Name 'fDenyTSConnections' -Value 0/);
  });

  it('apply commands write the safe value for each fix', () => {
    expect(buildApplyCommand('smb1')).toMatch(/-EnableSMB1Protocol \$false/);
    expect(buildApplyCommand('guest-account')).toMatch(/Disable-LocalUser/);
    expect(buildApplyCommand('remote-desktop')).toMatch(/-Name 'fDenyTSConnections' -Value 1/);
  });
});

describe('decodeFixObservation', () => {
  it('decodes payloads for every fix', () => {
    expect(decodeFixObservation('smb1', { available: true, enabled: true })).toEqual({
      checkId: 'smb1',
      available: true,
      enabled: true,
    });
    expect(
      decodeFixObservation('guest-account', { available: true, name: 'Guest', enabled: false })
    ).toEqual({ checkId: 'guest-account', available: true, name: 'Guest', enabled: false });
    expect(decodeFixObservation('remote-desktop', { available: true, deny: '0' })).toEqual({
      checkId: 'remote-desktop',
      available: true,
      deny: 0,
    });
  });

  it('degrades to unavailable for missing payloads', () => {
    expect(decodeFixObservation('smb1', null)).toEqual({
      checkId: 'smb1',
      available: false,
      enabled: null,
    });
  });
});

describe('formatting helpers', () => {
  it('renders observations and canonical originals', () => {
    expect(formatObservation(smbEnabled)).toBe('SMBv1 enabled');
    expect(formatObservation(rdpAllowed)).toBe('fDenyTSConnections=0');
    expect(formatOriginal('guest-account', 'enabled')).toBe('Guest account enabled');
    expect(formatOriginal('remote-desktop', '0')).toBe('fDenyTSConnections=0');
    expect(formatOriginal('smb1', null)).toBeNull();
  });
});

// The verdict must come from the RE-READ value, not from a stdout marker.
describe('success predicates', () => {
  it('recognises the hardened target for each fix', () => {
    expect(isTargetObservation('smb1', smbDisabled)).toBe(true);
    expect(isTargetObservation('smb1', smbEnabled)).toBe(false);
    expect(isTargetObservation('remote-desktop', rdpDenied)).toBe(true);
    expect(isTargetObservation('remote-desktop', rdpAllowed)).toBe(false);
    expect(
      isTargetObservation('guest-account', {
        checkId: 'guest-account',
        available: true,
        name: 'Guest',
        enabled: false,
      })
    ).toBe(true);
    expect(isTargetObservation('smb1', { checkId: 'smb1', available: false, enabled: null })).toBe(
      false
    );
  });

  it('recognises a return to the captured original', () => {
    expect(isOriginalObservation('smb1', smbEnabled, 'enabled')).toBe(true);
    expect(isOriginalObservation('smb1', smbDisabled, 'enabled')).toBe(false);
    expect(isOriginalObservation('remote-desktop', rdpAllowed, '0')).toBe(true);
    expect(isOriginalObservation('remote-desktop', rdpDenied, '0')).toBe(false);
  });
});

// ===================== v0.10.0: smb-signing auto-fix =====================
const smbSigOff: FixObservation = {
  checkId: 'smb-signing',
  available: true,
  require: false,
  enable: false,
};
const smbSigOn: FixObservation = {
  checkId: 'smb-signing',
  available: true,
  require: true,
  enable: true,
};

describe('smb-signing auto-fix (preview)', () => {
  it('blocks with requires-admin when not elevated but still shows the observed value', () => {
    const preview = buildFixPreview('smb-signing', smbSigOff, {
      isAdmin: false,
      storedOriginal: null,
    });
    expect(preview.canApply).toBe(false);
    expect(preview.blockedReason).toBe('requires-admin');
    // The observed current value is always shown, even when blocked.
    expect(preview.current).toBe('RequireSecuritySignature=False, EnableSecuritySignature=False');
    expect(preview.target).toBe('RequireSecuritySignature=True, EnableSecuritySignature=True');
  });

  it('allows the change when elevated and signing is not required yet', () => {
    const preview = buildFixPreview('smb-signing', smbSigOff, {
      isAdmin: true,
      storedOriginal: null,
    });
    expect(preview.canApply).toBe(true);
    expect(preview.blockedReason).toBeNull();
    expect(preview.reversible).toBe(true);
    expect(preview.requiresAdmin).toBe(true);
  });

  it('reports already-applied instead of offering a no-op', () => {
    expect(
      buildFixPreview('smb-signing', smbSigOn, { isAdmin: true, storedOriginal: null })
        .blockedReason
    ).toBe('already-applied');
  });

  it('reports unavailable when the value cannot be read', () => {
    const preview = buildFixPreview(
      'smb-signing',
      { checkId: 'smb-signing', available: false, require: null, enable: null },
      { isAdmin: true, storedOriginal: null }
    );
    expect(preview.blockedReason).toBe('unavailable');
    expect(preview.canApply).toBe(false);
  });

  it('offers revert only when an original is stored AND the user is elevated', () => {
    const withOriginal = buildFixPreview('smb-signing', smbSigOff, {
      isAdmin: true,
      storedOriginal: 'require=0;enable=0',
    });
    expect(withOriginal.canRevert).toBe(true);
    expect(withOriginal.original).toBe(
      'RequireSecuritySignature=False, EnableSecuritySignature=False'
    );
  });
});

describe('smb-signing auto-fix (apply/revert planners)', () => {
  it('apply requires signing on the server and enables it on the client', () => {
    const apply = buildApplyCommand('smb-signing');
    expect(apply).toMatch(/-RequireSecuritySignature \$true/);
    expect(apply).toMatch(/-EnableSecuritySignature \$true/);
    // Registry fallback writes both values.
    expect(apply).toMatch(/Set-ItemProperty/);
    expect(apply).toMatch(/-Name 'RequireSecuritySignature' -Value 1/);
    expect(apply).toMatch(/-Name 'EnableSecuritySignature' -Value 1/);
  });

  it('round-trips the exact previous values (both disabled)', () => {
    const token = encodeOriginal(smbSigOff);
    expect(token).toBe('require=0;enable=0');
    const revert = buildRevertCommand('smb-signing', token);
    expect(revert).toMatch(/-RequireSecuritySignature \$false -EnableSecuritySignature \$false/);
    expect(revert).toMatch(/-Name 'EnableSecuritySignature' -Value 0/);
  });

  it('round-trips a mixed original exactly (require=0;enable=1)', () => {
    const token = encodeOriginal({
      checkId: 'smb-signing',
      available: true,
      require: false,
      enable: true,
    });
    expect(token).toBe('require=0;enable=1');
    expect(buildRevertCommand('smb-signing', token)).toMatch(
      /-RequireSecuritySignature \$false -EnableSecuritySignature \$true/
    );
  });

  it('preserves an absent value by removing it on revert (never assumes a default)', () => {
    const token = encodeOriginal({
      checkId: 'smb-signing',
      available: true,
      require: false,
      enable: null,
    });
    expect(token).toBe('require=0;enable=absent');
    const revert = buildRevertCommand('smb-signing', token);
    expect(revert).toMatch(/Remove-ItemProperty -Path \$base -Name 'EnableSecuritySignature'/);
    // The absent branch must not write a made-up value.
    expect(revert).not.toMatch(/-Name 'EnableSecuritySignature' -Value/);
  });

  it('reports FAILED when neither the cmdlet nor the registry write succeeds', () => {
    expect(buildApplyCommand('smb-signing')).toMatch(/Write-Output 'FAILED'/);
    expect(buildRevertCommand('smb-signing', 'require=0;enable=0')).toMatch(
      /Write-Output 'FAILED'/
    );
  });
});

describe('smb-signing auto-fix (decode + predicates)', () => {
  it('decodes the read payload for every value shape', () => {
    expect(
      decodeFixObservation('smb-signing', { available: true, require: true, enable: false })
    ).toEqual({ checkId: 'smb-signing', available: true, require: true, enable: false });
    expect(
      decodeFixObservation('smb-signing', { available: true, require: 'true', enable: null })
    ).toEqual({ checkId: 'smb-signing', available: true, require: true, enable: null });
    expect(
      decodeFixObservation('smb-signing', { available: false, require: null, enable: null })
    ).toEqual({ checkId: 'smb-signing', available: false, require: null, enable: null });
  });

  it('formats observations and canonical originals', () => {
    expect(formatObservation(smbSigOff)).toBe(
      'RequireSecuritySignature=False, EnableSecuritySignature=False'
    );
    expect(formatObservation(smbSigOn)).toBe(
      'RequireSecuritySignature=True, EnableSecuritySignature=True'
    );
    expect(formatOriginal('smb-signing', 'require=0;enable=1')).toBe(
      'RequireSecuritySignature=False, EnableSecuritySignature=True'
    );
    expect(formatOriginal('smb-signing', 'require=0;enable=absent')).toBe(
      'RequireSecuritySignature=False, EnableSecuritySignature=absent'
    );
    expect(formatOriginal('smb-signing', null)).toBeNull();
  });

  it('treats require=true as the hardened target (enable-only is not enough)', () => {
    expect(isTargetObservation('smb-signing', smbSigOn)).toBe(true);
    expect(isTargetObservation('smb-signing', smbSigOff)).toBe(false);
    expect(
      isTargetObservation('smb-signing', {
        checkId: 'smb-signing',
        available: true,
        require: false,
        enable: true,
      })
    ).toBe(false);
    expect(
      isTargetObservation('smb-signing', {
        checkId: 'smb-signing',
        available: false,
        require: null,
        enable: null,
      })
    ).toBe(false);
  });

  it('recognises a return to the captured original (including absent)', () => {
    expect(isOriginalObservation('smb-signing', smbSigOff, 'require=0;enable=0')).toBe(true);
    expect(isOriginalObservation('smb-signing', smbSigOn, 'require=0;enable=0')).toBe(false);
    expect(
      isOriginalObservation(
        'smb-signing',
        { checkId: 'smb-signing', available: true, require: false, enable: null },
        'require=0;enable=absent'
      )
    ).toBe(true);
  });
});
