import { describe, it, expect } from 'vitest';
import {
  SECURITY_FIX_IDS,
  SECURITY_FIX_TITLES,
  SECURITY_FIX_DESCRIPTIONS,
  UAC_LEVEL_FIX_IDS,
  UAC_LEVEL_TRIPLES,
  isSecurityFixId,
  type SecurityFixId,
} from '@shared/security-fix';
import { SECURITY_CHECK_CATALOG, SECURITY_CHECK_BY_ID } from '@shared/security-scan';
import {
  buildApplyCommand,
  buildFixPreview,
  buildRevertCommand,
  decodeFixObservation,
  encodeOriginal,
  formatObservation,
  isOriginalObservation,
  isTargetObservation,
  type FixObservation,
} from './security-fix';
import { buildSecurityCheckResults } from './security-scan';
import type { SecurityCheckResult, SecurityMachineInfo } from '@shared/security-scan';

/**
 * Lote 2 (A4): OS security toggles.
 *
 * - UAC in 5 levels (dedicated fix per level; Never notify carries an
 *   explicit risk warning).
 * - Smart App Control enforce toggle (admin, reversible).
 * - PowerShell execution-policy toggle (admin, reversible).
 * - BitLocker-guard is ADVISORY ONLY: a read-only check, never a fix, and the
 *   app must never encrypt anything.
 *
 * Pure planners only: no fix is ever executed against the host here.
 */

const ADMIN = { isAdmin: true, storedOriginal: null };
const NO_ADMIN = { isAdmin: false, storedOriginal: null };

function machine(isAdmin: boolean): SecurityMachineInfo {
  return {
    osCaption: 'test-os',
    osVersion: '10.0.22631',
    osBuild: '22631',
    edition: 'Professional',
    displayVersion: '23H2',
    isAdmin,
    collectedAt: new Date(0).toISOString(),
  };
}

function resultsFor(
  checkId: string,
  payload: Record<string, unknown>,
  isAdmin: boolean
): SecurityCheckResult {
  const index = SECURITY_CHECK_CATALOG.findIndex((d) => d.id === checkId);
  expect(index).toBeGreaterThanOrEqual(0);
  const payloads = SECURITY_CHECK_CATALOG.map((_, i) =>
    i === index ? JSON.stringify(payload) : ''
  );
  const found = buildSecurityCheckResults(payloads, machine(isAdmin)).find((c) => c.id === checkId);
  expect(found, `scan must return check ${checkId}`).toBeDefined();
  return found as SecurityCheckResult;
}

describe('A4 fix registry (shared contract)', () => {
  it('registers the 5 UAC levels + Smart App Control + execution policy', () => {
    const expected: SecurityFixId[] = [
      'uac-always',
      'uac-credentials',
      'uac-default',
      'uac-nodim',
      'uac-never',
      'smart-app-control',
      'powershell-exec-policy',
    ];
    for (const id of expected) {
      expect(SECURITY_FIX_IDS).toContain(id);
      expect(isSecurityFixId(id)).toBe(true);
      expect(SECURITY_FIX_TITLES[id]).toBeTruthy();
      expect(SECURITY_FIX_DESCRIPTIONS[id]).toBeTruthy();
    }
    expect(UAC_LEVEL_FIX_IDS).toHaveLength(5);
  });

  it('declares the documented UAC triples per level', () => {
    expect(UAC_LEVEL_TRIPLES['uac-always']).toEqual({ lua: 1, consent: 2, secure: 1 });
    expect(UAC_LEVEL_TRIPLES['uac-credentials']).toEqual({ lua: 1, consent: 1, secure: 1 });
    expect(UAC_LEVEL_TRIPLES['uac-default']).toEqual({ lua: 1, consent: 5, secure: 1 });
    expect(UAC_LEVEL_TRIPLES['uac-nodim']).toEqual({ lua: 1, consent: 5, secure: 0 });
    expect(UAC_LEVEL_TRIPLES['uac-never']).toEqual({ lua: 1, consent: 0, secure: 0 });
  });

  it('warns explicitly about the Never notify risk in its description', () => {
    expect(SECURITY_FIX_DESCRIPTIONS['uac-never']).toMatch(/least secure|warning/i);
    expect(SECURITY_FIX_TITLES['uac-never']).toMatch(/not recommended/i);
  });

  it('keeps BitLocker-guard out of the fix registry (advisory only)', () => {
    expect(isSecurityFixId('bitlocker-guard')).toBe(false);
    expect(SECURITY_CHECK_BY_ID.get('bitlocker-guard')?.autoFixable).toBe(false);
  });

  it('marks the new checks auto-fixable (except the guard) and admin-gated', () => {
    expect(SECURITY_CHECK_BY_ID.get('smart-app-control')?.autoFixable).toBe(true);
    expect(SECURITY_CHECK_BY_ID.get('smart-app-control')?.requiresAdmin).toBe(true);
    expect(SECURITY_CHECK_BY_ID.get('powershell-exec-policy')?.autoFixable).toBe(true);
    expect(SECURITY_CHECK_BY_ID.get('uac')?.autoFixable).toBe(false);
  });
});

describe('A4 UAC level previews (admin gate + already-applied + unavailable)', () => {
  const defaultObs = decodeFixObservation('uac-default', {
    available: true,
    lua: 1,
    consent: 2,
    secure: 1,
  });

  it('allows each level when elevated and not yet in place', () => {
    for (const id of UAC_LEVEL_FIX_IDS) {
      const preview = buildFixPreview(id, defaultObs, ADMIN);
      expect(preview.canApply).toBe(true);
      expect(preview.requiresAdmin).toBe(true);
      expect(preview.reversible).toBe(true);
    }
  });

  it('blocks every level with requires-admin when not elevated', () => {
    for (const id of UAC_LEVEL_FIX_IDS) {
      const preview = buildFixPreview(id, defaultObs, NO_ADMIN);
      expect(preview.canApply).toBe(false);
      expect(preview.blockedReason).toBe('requires-admin');
    }
  });

  it('reports already-applied instead of a no-op', () => {
    const atDefault = decodeFixObservation('uac-default', {
      available: true,
      lua: 1,
      consent: 5,
      secure: 1,
    });
    expect(buildFixPreview('uac-default', atDefault, ADMIN).blockedReason).toBe('already-applied');
  });

  it('reports unavailable when the values cannot be read', () => {
    const missing = decodeFixObservation('uac-default', { available: false });
    expect(buildFixPreview('uac-default', missing, ADMIN).blockedReason).toBe('unavailable');
  });

  it('describes the observed level in plain language', () => {
    expect(formatObservation(defaultObs)).toMatch(/always notify/i);
  });
});

describe('A4 UAC revert round-trip restores the exact triple', () => {
  it('encodes the observed triple as a canonical token', () => {
    const obs = decodeFixObservation('uac-nodim', {
      available: true,
      lua: 1,
      consent: 5,
      secure: 0,
    });
    expect(encodeOriginal(obs)).toBe('lua=1;consent=5;secure=0');
  });

  it('restores every value of the captured triple', () => {
    const revert = buildRevertCommand('uac-default', 'lua=1;consent=2;secure=1');
    expect(revert).toMatch(/EnableLUA/);
    expect(revert).toMatch(/ConsentPromptBehaviorAdmin/);
    expect(revert).toMatch(/PromptOnSecureDesktop/);
    expect(revert).toMatch(/-Value 1[\s\S]*-Value 2[\s\S]*-Value 1/);
  });

  it('matches target/original observations exactly', () => {
    const obs = decodeFixObservation('uac-always', {
      available: true,
      lua: 1,
      consent: 2,
      secure: 1,
    });
    expect(isTargetObservation('uac-always', obs)).toBe(true);
    expect(isTargetObservation('uac-default', obs)).toBe(false);
    expect(isOriginalObservation('uac-always', obs, 'lua=1;consent=2;secure=1')).toBe(true);
    expect(isOriginalObservation('uac-always', obs, 'lua=1;consent=5;secure=1')).toBe(false);
  });

  it('emits an apply script per level (never empty)', () => {
    for (const id of UAC_LEVEL_FIX_IDS) {
      expect(buildApplyCommand(id)).toMatch(/Set-ItemProperty/);
    }
  });
});

describe('A4 Smart App Control toggle', () => {
  const off: FixObservation = decodeFixObservation('smart-app-control', {
    available: true,
    state: 0,
  });

  it('offers enforce when off, gated by admin', () => {
    expect(buildFixPreview('smart-app-control', off, ADMIN).canApply).toBe(true);
    const blocked = buildFixPreview('smart-app-control', off, NO_ADMIN);
    expect(blocked.blockedReason).toBe('requires-admin');
  });

  it('reports already-applied when already enforced', () => {
    const enforced = decodeFixObservation('smart-app-control', {
      available: true,
      state: 1,
    });
    expect(buildFixPreview('smart-app-control', enforced, ADMIN).blockedReason).toBe(
      'already-applied'
    );
  });

  it('round-trips off/evaluation/absent through the revert script', () => {
    expect(encodeOriginal(off)).toBe('0');
    expect(buildRevertCommand('smart-app-control', '0')).toMatch(
      /VerifiedAndReputablePolicyState[\s\S]*-Value 0/
    );
    expect(buildRevertCommand('smart-app-control', 'absent')).toMatch(/Remove-ItemProperty/);
    expect(
      isOriginalObservation(
        'smart-app-control',
        decodeFixObservation('smart-app-control', { available: true, state: 2 }),
        '2'
      )
    ).toBe(true);
    expect(
      isTargetObservation(
        'smart-app-control',
        decodeFixObservation('smart-app-control', { available: true, state: 1 })
      )
    ).toBe(true);
  });
});

describe('A4 PowerShell execution-policy toggle', () => {
  const unrestricted: FixObservation = decodeFixObservation('powershell-exec-policy', {
    available: true,
    policy: 'Unrestricted',
  });

  it('targets RemoteSigned, gated by admin', () => {
    const preview = buildFixPreview('powershell-exec-policy', unrestricted, ADMIN);
    expect(preview.canApply).toBe(true);
    expect(preview.target).toMatch(/RemoteSigned/);
    expect(buildFixPreview('powershell-exec-policy', unrestricted, NO_ADMIN).blockedReason).toBe(
      'requires-admin'
    );
  });

  it('reports already-applied at RemoteSigned', () => {
    const atTarget = decodeFixObservation('powershell-exec-policy', {
      available: true,
      policy: 'RemoteSigned',
    });
    expect(buildFixPreview('powershell-exec-policy', atTarget, ADMIN).blockedReason).toBe(
      'already-applied'
    );
  });

  it('restores absent by removing the value, never by inventing one', () => {
    expect(encodeOriginal(unrestricted)).toBe('Unrestricted');
    expect(buildRevertCommand('powershell-exec-policy', 'absent')).toMatch(/Remove-ItemProperty/);
    expect(buildRevertCommand('powershell-exec-policy', 'Restricted')).toMatch(/Restricted/);
  });
});

describe('A4 live scan builders (read-only, dynamic)', () => {
  it('scores Smart App Control off/evaluation/enforced honestly', () => {
    expect(resultsFor('smart-app-control', { kind: 'sac', state: 1 }, true)).toMatchObject({
      id: 'smart-app-control',
      status: 'pass',
    });
    expect(resultsFor('smart-app-control', { kind: 'sac', state: 2 }, true)).toMatchObject({
      status: 'warn',
    });
    expect(resultsFor('smart-app-control', { kind: 'sac', state: 0 }, true)).toMatchObject({
      status: 'fail',
    });
  });

  it('fails open execution policies, passes the recommended one', () => {
    expect(
      resultsFor('powershell-exec-policy', { kind: 'exec', policy: 'RemoteSigned' }, true)
    ).toMatchObject({ status: 'pass' });
    expect(
      resultsFor('powershell-exec-policy', { kind: 'exec', policy: 'Unrestricted' }, true)
    ).toMatchObject({ status: 'fail' });
    expect(
      resultsFor('powershell-exec-policy', { kind: 'exec', policy: 'Bypass' }, true)
    ).toMatchObject({ status: 'fail' });
  });

  it('keeps the BitLocker guard advisory: warn at worst, never fail, never fix', () => {
    const off = resultsFor('bitlocker-guard', { kind: 'blg', protection: 'Off' }, true);
    expect(off.status).toBe('warn');
    expect(off.reason).toMatch(/never|automatically/i);
    expect(resultsFor('bitlocker-guard', { kind: 'blg', protection: 'On' }, true)).toMatchObject({
      status: 'pass',
    });
  });

  it('reports requires-admin without elevation instead of guessing', () => {
    for (const id of ['smart-app-control', 'bitlocker-guard']) {
      const check = resultsFor(id, { kind: 'x' }, false);
      expect(check.status).toBe('requires-admin');
    }
  });
});
