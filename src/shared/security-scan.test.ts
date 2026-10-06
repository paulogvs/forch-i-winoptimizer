import { describe, it, expect } from 'vitest';
import {
  SECURITY_CHECK_CATALOG,
  SECURITY_CHECK_BY_ID,
  SECURITY_STATUSES,
  SEVERITY_WEIGHT,
  computeSecurityScore,
  emptySecuritySummary,
  summarizeSecurityChecks,
  type SecurityCheckResult,
} from './security-scan';

function result(id: string, status: SecurityCheckResult['status']): SecurityCheckResult {
  return { id, status, evidence: 'fixture', reason: 'fixture' };
}

describe('security-scan contract', () => {
  it('catalog ids are unique, well-formed and complete', () => {
    const ids = SECURITY_CHECK_CATALOG.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    for (const definition of SECURITY_CHECK_CATALOG) {
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.reads.length).toBeGreaterThan(0);
      expect(definition.guidance.length).toBeGreaterThan(0);
      expect(definition.possibleStatuses.length).toBeGreaterThan(0);
      for (const status of definition.possibleStatuses) {
        expect(SECURITY_STATUSES).toContain(status);
      }
    }
  });

  it('every catalog entry is reachable through the lookup map', () => {
    for (const definition of SECURITY_CHECK_CATALOG) {
      expect(SECURITY_CHECK_BY_ID.get(definition.id)).toBe(definition);
    }
  });

  it('auto-fixes exactly the reversible checks and nothing else', () => {
    // v0.10.0 ships auto-fix for smb1, guest-account, remote-desktop and
    // smb-signing; v0.18.0 adds smart-app-control and powershell-exec-policy.
    // This guards against silently adding another (every other candidate can
    // lock a user out or is not reversible through a single value).
    const autoFixable = SECURITY_CHECK_CATALOG.filter((definition) => definition.autoFixable).map(
      (definition) => definition.id
    );
    expect(autoFixable.sort()).toEqual([
      'guest-account',
      'powershell-exec-policy',
      'remote-desktop',
      'smart-app-control',
      'smb-signing',
      'smb1',
    ]);
  });

  it('v0.9.0 admin-gated controls are present, read-only and flagged requiresAdmin', () => {
    const ids = [
      'lsass-protection',
      'credential-guard',
      'bitlocker-protectors',
      'admin-accounts',
      'firewall-inbound-rules',
      'winrm-exposure',
    ];
    for (const id of ids) {
      const definition = SECURITY_CHECK_BY_ID.get(id);
      expect(definition, id).toBeDefined();
      expect(definition?.requiresAdmin, id).toBe(true);
      expect(definition?.autoFixable, id).toBe(false);
      expect(definition?.possibleStatuses, id).toContain('requires-admin');
      expect((definition?.reads ?? '').length, id).toBeGreaterThan(0);
    }
    // No other check gained the admin flag by accident, beyond the deliberate
    // v0.18.0 additions (smart-app-control fix + bitlocker-guard advisory).
    const adminGated = SECURITY_CHECK_CATALOG.filter((d) => d.requiresAdmin).map((d) => d.id);
    expect(adminGated.sort()).toEqual([...ids, 'bitlocker-guard', 'smart-app-control'].sort());
  });

  describe('computeSecurityScore', () => {
    it('returns 100 when every scorable check passes', () => {
      const checks = SECURITY_CHECK_CATALOG.map((definition) => result(definition.id, 'pass'));
      const { score, scoredChecks, excludedChecks } = computeSecurityScore(checks);
      expect(score).toBe(100);
      expect(excludedChecks).toBe(0);
      expect(scoredChecks).toBe(checks.length);
    });

    it('excludes unknown / not-applicable / requires-admin from the denominator', () => {
      const checks = [
        result('firewall', 'pass'),
        result('antivirus', 'fail'),
        result('tpm', 'not-applicable'),
        result('smb1', 'unknown'),
        result('bitlocker', 'requires-admin'),
      ];
      const { score, scoredChecks, excludedChecks } = computeSecurityScore(checks);
      // firewall: critical weight 4 × 1 = 4 ; antivirus: critical 4 × 0 = 0
      // denominator = 8 -> 4/8 = 50
      expect(score).toBe(50);
      expect(scoredChecks).toBe(2);
      expect(excludedChecks).toBe(3);
    });

    it('gives half credit to warnings', () => {
      const checks = [result('firewall', 'warn')];
      const { score } = computeSecurityScore(checks);
      expect(score).toBe(50);
    });

    it('returns null (not scored) when nothing is scorable', () => {
      const checks = SECURITY_CHECK_CATALOG.map((definition) => result(definition.id, 'unknown'));
      const { score, scoredChecks, excludedChecks } = computeSecurityScore(checks);
      expect(score).toBeNull();
      expect(scoredChecks).toBe(0);
      expect(excludedChecks).toBe(checks.length);
    });

    it('uses severity weights explicitly', () => {
      expect(SEVERITY_WEIGHT.critical).toBeGreaterThan(SEVERITY_WEIGHT.high);
      expect(SEVERITY_WEIGHT.high).toBeGreaterThan(SEVERITY_WEIGHT.medium);
      expect(SEVERITY_WEIGHT.medium).toBeGreaterThanOrEqual(SEVERITY_WEIGHT.low);
    });
  });

  describe('summarizeSecurityChecks', () => {
    it('counts every status and always returns all keys', () => {
      const summary = summarizeSecurityChecks([
        result('firewall', 'pass'),
        result('antivirus', 'fail'),
        result('tpm', 'not-applicable'),
        result('smb1', 'unknown'),
        result('bitlocker', 'requires-admin'),
        result('uac', 'warn'),
      ]);
      expect(summary).toEqual({
        pass: 1,
        warn: 1,
        fail: 1,
        unknown: 1,
        'not-applicable': 1,
        'requires-admin': 1,
      });
      expect(emptySecuritySummary()).toEqual({
        pass: 0,
        warn: 0,
        fail: 0,
        unknown: 0,
        'not-applicable': 0,
        'requires-admin': 0,
      });
    });
  });
});
