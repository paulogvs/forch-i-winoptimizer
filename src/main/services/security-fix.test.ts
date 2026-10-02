import { describe, it, expect } from 'vitest';
import {
  buildApplyCommand,
  buildFixPreview,
  buildRevertCommand,
  decodeFixObservation,
  encodeOriginal,
  formatObservation,
  formatOriginal,
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
