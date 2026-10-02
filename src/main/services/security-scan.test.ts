import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SECURITY_CHECK_CATALOG,
  type SecurityMachineInfo,
  type SecurityCheckStatus,
} from '@shared/security-scan';
import {
  buildSecurityCheckResults,
  splitSecurityStdout,
  buildMachineInfo,
  buildSecurityScript,
  runSecurityScan,
} from './security-scan';

vi.mock('./powershell', () => ({
  runPowerShell: vi.fn(),
}));

import { runPowerShell } from './powershell';

const ORDER = SECURITY_CHECK_CATALOG.map((definition) => definition.id);

function machine(overrides: Partial<SecurityMachineInfo> = {}): SecurityMachineInfo {
  return {
    osCaption: 'Microsoft Windows 11 Pro',
    osVersion: '10.0.22631',
    osBuild: '22631',
    edition: 'Professional',
    displayVersion: '23H2',
    isAdmin: true,
    collectedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Payload list in catalog order; unknown ids default to a non-readable block. */
function payloads(map: Partial<Record<string, string>>): string[] {
  return ORDER.map((id) => map[id] ?? '');
}

function statusOf(id: string, map: Partial<Record<string, string>>): SecurityCheckStatus {
  const results = buildSecurityCheckResults(payloads(map), machine());
  const check = results.find((result) => result.id === id);
  if (!check) throw new Error(`missing check ${id}`);
  return check.status;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

describe('security-scan engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSecurityScript', () => {
    it('emits one marker per catalog check plus the environment marker', () => {
      const script = buildSecurityScript();
      expect(script).toContain('@@FENV@@');
      for (let index = 0; index < SECURITY_CHECK_CATALOG.length; index++) {
        expect(script).toContain(`@@FSEC_${index}@@`);
      }
    });

    it('has a live query for every catalog id', () => {
      const script = buildSecurityScript();
      for (const definition of SECURITY_CHECK_CATALOG) {
        expect(script.length).toBeGreaterThan(0);
        expect(definition.reads.length).toBeGreaterThan(0);
      }
    });
  });

  describe('splitSecurityStdout', () => {
    it('separates env and per-check payloads', () => {
      const stdout = ['@@FENV@@', '{"isAdmin":true}', '@@FSEC_0@@', '{"a":1}', '@@FSEC_1@@', '{"b":2}'].join(
        '\n'
      );
      const { env, payloads: blocks } = splitSecurityStdout(stdout, 2);
      expect(env).toBe('{"isAdmin":true}');
      expect(blocks[0]).toBe('{"a":1}');
      expect(blocks[1]).toBe('{"b":2}');
    });

    it('yields empty payloads when markers are missing (aborted run)', () => {
      const { env, payloads: blocks } = splitSecurityStdout('random output', 3);
      expect(env).toBe('');
      expect(blocks).toEqual(['', '', '']);
    });
  });

  describe('buildMachineInfo', () => {
    it('reads real values and admin flag', () => {
      const info = buildMachineInfo(
        '{"caption":"Microsoft Windows 10 Home","build":"19045","edition":"Core","isAdmin":false}'
      );
      expect(info.osCaption).toContain('Windows 10 Home');
      expect(info.edition).toBe('Core');
      expect(info.isAdmin).toBe(false);
    });

    it('degrades safely on corrupt env payload', () => {
      const info = buildMachineInfo('not json');
      expect(info.osCaption).toBe('');
      expect(info.isAdmin).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Per-check state coverage
  // -------------------------------------------------------------------------

  describe('antivirus (SecurityCenter2, no product-name list)', () => {
    it('passes for a third-party product with live real-time protection', () => {
      expect(
        statusOf('antivirus', {
          antivirus: '{"kind":"products","items":[{"name":"SomeThirdParty AV","state":"266496"}]}',
        })
      ).toBe('pass');
    });

    it('warns when real-time is on but signatures are out of date', () => {
      expect(
        statusOf('antivirus', {
          antivirus: '{"kind":"products","items":[{"name":"SomeThirdParty AV","state":"266512"}]}',
        })
      ).toBe('warn');
    });

    it('fails when a product is registered but real-time is off', () => {
      expect(
        statusOf('antivirus', {
          antivirus: '{"kind":"products","items":[{"name":"SomeThirdParty AV","state":"16"}]}',
        })
      ).toBe('fail');
    });

    it('fails when no product is registered', () => {
      expect(statusOf('antivirus', { antivirus: '{"kind":"empty"}' })).toBe('fail');
    });

    it('reports requires-admin on an access-denied read', () => {
      expect(
        statusOf('antivirus', { antivirus: '{"kind":"unreadable","message":"Access is denied"}' })
      ).toBe('requires-admin');
    });

    it('reports unknown when unreadable without an access error', () => {
      expect(statusOf('antivirus', { antivirus: '{"kind":"unreadable","message":"boom"}' })).toBe(
        'unknown'
      );
    });
  });

  describe('firewall', () => {
    it('passes when every profile is on', () => {
      expect(
        statusOf('firewall', {
          firewall:
            '{"kind":"profiles","profiles":[{"name":"Domain","enabled":true},{"name":"Private","enabled":true},{"name":"Public","enabled":true}]}',
        })
      ).toBe('pass');
    });

    it('warns when only some profiles are on', () => {
      expect(
        statusOf('firewall', {
          firewall:
            '{"kind":"profiles","profiles":[{"name":"Domain","enabled":true},{"name":"Public","enabled":false}]}',
        })
      ).toBe('warn');
    });

    it('fails when all profiles are off', () => {
      expect(
        statusOf('firewall', {
          firewall: '{"kind":"profiles","profiles":[{"name":"Domain","enabled":false}]}',
        })
      ).toBe('fail');
    });

    it('reports requires-admin when the read is denied', () => {
      expect(
        statusOf('firewall', { firewall: '{"kind":"unreadable","message":"Access is denied"}' })
      ).toBe('requires-admin');
    });
  });

  describe('uac', () => {
    it('passes at a recommended level', () => {
      expect(
        statusOf('uac', {
          uac: '{"kind":"uac","enableLua":1,"consentPrompt":5,"secureDesktop":1}',
        })
      ).toBe('pass');
    });

    it('warns when the prompt is below recommended', () => {
      expect(
        statusOf('uac', { uac: '{"kind":"uac","enableLua":1,"consentPrompt":0,"secureDesktop":1}' })
      ).toBe('warn');
    });

    it('fails when UAC is disabled', () => {
      expect(
        statusOf('uac', { uac: '{"kind":"uac","enableLua":0,"consentPrompt":0,"secureDesktop":1}' })
      ).toBe('fail');
    });

    it('reports unknown when the policy is missing', () => {
      expect(statusOf('uac', { uac: '{"kind":"missing"}' })).toBe('unknown');
    });
  });

  describe('smb1', () => {
    it('passes when SMBv1 is disabled', () => {
      expect(statusOf('smb1', { smb1: '{"kind":"smb","enabled":false}' })).toBe('pass');
    });

    it('fails when SMBv1 is enabled', () => {
      expect(statusOf('smb1', { smb1: '{"kind":"smb","enabled":true}' })).toBe('fail');
    });

    it('reports requires-admin on an access-denied read', () => {
      expect(
        statusOf('smb1', { smb1: '{"kind":"unreadable","message":"Access is denied"}' })
      ).toBe('requires-admin');
    });

    it('reports unknown when unreadable without an access error', () => {
      expect(statusOf('smb1', { smb1: '{"kind":"unreadable"}' })).toBe('unknown');
    });
  });

  describe('secure-boot', () => {
    it('passes when enabled', () => {
      expect(statusOf('secure-boot', { 'secure-boot': '{"kind":"ok","value":true}' })).toBe('pass');
    });

    it('fails when disabled', () => {
      expect(statusOf('secure-boot', { 'secure-boot': '{"kind":"ok","value":false}' })).toBe('fail');
    });

    it('is not-applicable on legacy BIOS', () => {
      expect(
        statusOf('secure-boot', {
          'secure-boot': '{"kind":"not-uefi","firmware":"Legacy"}',
        })
      ).toBe('not-applicable');
    });

    it('reports requires-admin on access denied', () => {
      expect(
        statusOf('secure-boot', {
          'secure-boot': '{"kind":"error","message":"Access is denied"}',
        })
      ).toBe('requires-admin');
    });

    it('reports unknown on an unrecognised error', () => {
      expect(
        statusOf('secure-boot', { 'secure-boot': '{"kind":"error","message":"weird"}' })
      ).toBe('unknown');
    });
  });

  describe('tpm', () => {
    it('passes when enabled and activated', () => {
      expect(
        statusOf('tpm', { tpm: '{"kind":"tpm","enabled":true,"activated":true,"spec":"2.0"}' })
      ).toBe('pass');
    });

    it('warns when present but not ready', () => {
      expect(
        statusOf('tpm', { tpm: '{"kind":"tpm","enabled":true,"activated":false,"spec":"2.0"}' })
      ).toBe('warn');
    });

    it('is not-applicable when no TPM is present (VM)', () => {
      expect(statusOf('tpm', { tpm: '{"kind":"absent"}' })).toBe('not-applicable');
    });

    it('reports requires-admin on access denied', () => {
      expect(
        statusOf('tpm', { tpm: '{"kind":"error","message":"Access is denied"}' })
      ).toBe('requires-admin');
    });
  });

  describe('bitlocker', () => {
    it('passes when the system drive is protected', () => {
      expect(
        statusOf('bitlocker', {
          bitlocker: '{"kind":"bl","protection":"On","percent":100,"edition":"Professional"}',
        })
      ).toBe('pass');
    });

    it('fails when the system drive is unencrypted', () => {
      expect(
        statusOf('bitlocker', {
          bitlocker: '{"kind":"bl","protection":"Off","percent":0,"edition":"Professional"}',
        })
      ).toBe('fail');
    });

    it('is not-applicable on a Home edition without the cmdlet', () => {
      expect(
        statusOf('bitlocker', {
          bitlocker:
            "{\"kind\":\"error\",\"message\":\"The term 'Get-BitLockerVolume' is not recognized\",\"edition\":\"Core\"}",
        })
      ).toBe('not-applicable');
    });

    it('is unknown when the cmdlet is missing on a non-Home edition', () => {
      expect(
        statusOf('bitlocker', {
          bitlocker:
            "{\"kind\":\"error\",\"message\":\"The term 'Get-BitLockerVolume' is not recognized\",\"edition\":\"Enterprise\"}",
        })
      ).toBe('unknown');
    });

    it('reports requires-admin on access denied', () => {
      expect(
        statusOf('bitlocker', {
          bitlocker: '{"kind":"error","message":"Access is denied","edition":"Professional"}',
        })
      ).toBe('requires-admin');
    });
  });

  describe('windows-update', () => {
    it('passes for a recent update', () => {
      expect(
        statusOf('windows-update', {
          'windows-update': `{"kind":"wu","last":"${daysAgo(10)}","pendingReboot":false}`,
        })
      ).toBe('pass');
    });

    it('warns for an old update', () => {
      expect(
        statusOf('windows-update', {
          'windows-update': `{"kind":"wu","last":"${daysAgo(90)}","pendingReboot":false}`,
        })
      ).toBe('warn');
    });

    it('fails for a very old update', () => {
      expect(
        statusOf('windows-update', {
          'windows-update': `{"kind":"wu","last":"${daysAgo(200)}","pendingReboot":false}`,
        })
      ).toBe('fail');
    });

    it('warns when a reboot is pending', () => {
      expect(
        statusOf('windows-update', {
          'windows-update': `{"kind":"wu","last":"${daysAgo(5)}","pendingReboot":true}`,
        })
      ).toBe('warn');
    });

    it('reports unknown when patch history is unavailable', () => {
      expect(
        statusOf('windows-update', { 'windows-update': '{"kind":"wu","last":null,"pendingReboot":false}' })
      ).toBe('unknown');
    });
  });

  describe('guest-account (matched by RID 501, not name)', () => {
    it('passes when the account is absent', () => {
      expect(statusOf('guest-account', { 'guest-account': '{"kind":"absent"}' })).toBe('pass');
    });

    it('passes when present but disabled', () => {
      expect(
        statusOf('guest-account', { 'guest-account': '{"kind":"guest","enabled":false}' })
      ).toBe('pass');
    });

    it('fails when enabled', () => {
      expect(statusOf('guest-account', { 'guest-account': '{"kind":"guest","enabled":true}' })).toBe(
        'fail'
      );
    });

    it('reports requires-admin on access denied', () => {
      expect(
        statusOf('guest-account', {
          'guest-account': '{"kind":"error","message":"Access is denied"}',
        })
      ).toBe('requires-admin');
    });
  });

  describe('remote-desktop', () => {
    it('passes when RDP is denied', () => {
      expect(statusOf('remote-desktop', { 'remote-desktop': '{"kind":"rdp","deny":1}' })).toBe(
        'pass'
      );
    });

    it('warns when RDP is enabled', () => {
      expect(statusOf('remote-desktop', { 'remote-desktop': '{"kind":"rdp","deny":0}' })).toBe(
        'warn'
      );
    });

    it('reports unknown when unreadable', () => {
      expect(statusOf('remote-desktop', { 'remote-desktop': '{"kind":"unreadable"}' })).toBe(
        'unknown'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Distinct machine configurations
  // -------------------------------------------------------------------------

  describe('machine configuration fixtures', () => {
    it('Win11 Pro complete: every check is scorable', () => {
      const results = buildSecurityCheckResults(
        payloads({
          antivirus: '{"kind":"products","items":[{"name":"Windows Security","state":"266496"}]}',
          firewall: '{"kind":"profiles","profiles":[{"name":"Domain","enabled":true},{"name":"Private","enabled":true},{"name":"Public","enabled":true}]}',
          uac: '{"kind":"uac","enableLua":1,"consentPrompt":5,"secureDesktop":1}',
          smb1: '{"kind":"smb","enabled":false}',
          'secure-boot': '{"kind":"ok","value":true}',
          tpm: '{"kind":"tpm","enabled":true,"activated":true,"spec":"2.0"}',
          bitlocker: '{"kind":"bl","protection":"On","percent":100,"edition":"Professional"}',
          'windows-update': `{"kind":"wu","last":"${daysAgo(10)}","pendingReboot":false}`,
          'guest-account': '{"kind":"guest","enabled":false}',
          'remote-desktop': '{"kind":"rdp","deny":1}',
        }),
        machine()
      );
      expect(results).toHaveLength(SECURITY_CHECK_CATALOG.length);
      expect(results.every((result) => result.status === 'pass')).toBe(true);
      expect(results.every((result) => result.evidence.length > 0)).toBe(true);
    });

    it('Win10 Home without BitLocker: not-applicable instead of fail', () => {
      const results = buildSecurityCheckResults(
        payloads({
          bitlocker:
            "{\"kind\":\"error\",\"message\":\"The term 'Get-BitLockerVolume' is not recognized\",\"edition\":\"Core\"}",
          tpm: '{"kind":"absent"}',
          'secure-boot': '{"kind":"ok","value":false}',
        }),
        machine({ osCaption: 'Microsoft Windows 10 Home', edition: 'Core', osBuild: '19045' })
      );
      const statuses = Object.fromEntries(results.map((result) => [result.id, result.status]));
      expect(statuses.bitlocker).toBe('not-applicable');
      expect(statuses.tpm).toBe('not-applicable');
      expect(statuses['secure-boot']).toBe('fail');
    });

    it('VM without TPM/Secure Boot: both not-applicable', () => {
      const results = buildSecurityCheckResults(
        payloads({
          tpm: '{"kind":"absent"}',
          'secure-boot': '{"kind":"not-uefi","firmware":"Legacy"}',
        }),
        machine({ osCaption: 'Microsoft Windows 11 Pro', isAdmin: false })
      );
      const statuses = Object.fromEntries(results.map((result) => [result.id, result.status]));
      expect(statuses.tpm).toBe('not-applicable');
      expect(statuses['secure-boot']).toBe('not-applicable');
    });

    it('third-party antivirus: detection is data-driven', () => {
      const results = buildSecurityCheckResults(
        payloads({
          antivirus:
            '{"kind":"products","items":[{"name":"Totally Different AV","state":"266496"}]}',
        }),
        machine()
      );
      const av = results.find((result) => result.id === 'antivirus');
      expect(av?.status).toBe('pass');
      expect(av?.evidence).toContain('Totally Different AV');
    });

    it('running without admin: permission errors become requires-admin', () => {
      const results = buildSecurityCheckResults(
        payloads({
          firewall: '{"kind":"unreadable","message":"Access is denied"}',
          smb1: '{"kind":"unreadable","message":"Access is denied"}',
          'guest-account': '{"kind":"error","message":"Access is denied"}',
        }),
        machine({ isAdmin: false })
      );
      const statuses = Object.fromEntries(results.map((result) => [result.id, result.status]));
      expect(statuses.firewall).toBe('requires-admin');
      expect(statuses.smb1).toBe('requires-admin');
      expect(statuses['guest-account']).toBe('requires-admin');
    });

    it('corrupt / non-JSON payloads degrade to unknown without throwing', () => {
      const corrupt = ORDER.map(() => '<not json>');
      const results = buildSecurityCheckResults(corrupt, machine());
      expect(results).toHaveLength(SECURITY_CHECK_CATALOG.length);
      expect(results.every((result) => result.status === 'unknown')).toBe(true);
    });

    it('an array payload (not an object) is treated as unknown', () => {
      const results = buildSecurityCheckResults(payloads({ antivirus: '[1,2,3]' }), machine());
      expect(results.find((result) => result.id === 'antivirus')?.status).toBe('unknown');
    });
  });

  // -------------------------------------------------------------------------
  // runSecurityScan (full pipeline with mocked PowerShell)
  // -------------------------------------------------------------------------

  describe('runSecurityScan', () => {
    it('produces a report with summary, score and machine info', async () => {
      const env =
        '{"caption":"Microsoft Windows 11 Pro","version":"10.0.22631","build":"22631","edition":"Professional","displayVersion":"23H2","isAdmin":true}';
      const blocks = payloads({
        antivirus: '{"kind":"products","items":[{"name":"Windows Security","state":"266496"}]}',
        firewall: '{"kind":"profiles","profiles":[{"name":"Domain","enabled":true},{"name":"Private","enabled":true},{"name":"Public","enabled":true}]}',
        uac: '{"kind":"uac","enableLua":1,"consentPrompt":5,"secureDesktop":1}',
        smb1: '{"kind":"smb","enabled":false}',
        'secure-boot': '{"kind":"ok","value":true}',
        tpm: '{"kind":"tpm","enabled":true,"activated":true,"spec":"2.0"}',
        bitlocker: '{"kind":"bl","protection":"On","percent":100,"edition":"Professional"}',
        'windows-update': `{"kind":"wu","last":"${daysAgo(10)}","pendingReboot":false}`,
        'guest-account': '{"kind":"guest","enabled":false}',
        'remote-desktop': '{"kind":"rdp","deny":1}',
      });
      const stdout = [`@@FENV@@\n${env}`]
        .concat(blocks.map((block, index) => `@@FSEC_${index}@@\n${block}`))
        .join('\n');

      vi.mocked(runPowerShell).mockResolvedValue({
        success: true,
        stdout,
        stderr: '',
        exitCode: 0,
      });

      const report = await runSecurityScan();
      expect(report.checks).toHaveLength(SECURITY_CHECK_CATALOG.length);
      expect(report.totalChecks).toBe(SECURITY_CHECK_CATALOG.length);
      expect(report.machine.isAdmin).toBe(true);
      expect(report.machine.edition).toBe('Professional');
      expect(report.score).toBe(100);
      expect(report.scoredChecks).toBe(SECURITY_CHECK_CATALOG.length);
      expect(report.excludedChecks).toBe(0);
      expect(report.summary.pass).toBe(SECURITY_CHECK_CATALOG.length);
      expect(typeof report.timestamp).toBe('string');
    });

    it('never fails the whole scan when PowerShell returns nothing', async () => {
      vi.mocked(runPowerShell).mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'boom',
        exitCode: 1,
      });
      const report = await runSecurityScan();
      expect(report.checks).toHaveLength(SECURITY_CHECK_CATALOG.length);
      expect(report.score).toBeNull();
      expect(report.excludedChecks).toBe(SECURITY_CHECK_CATALOG.length);
      expect(Object.values(report.summary).reduce((sum, count) => sum + count, 0)).toBe(
        SECURITY_CHECK_CATALOG.length
      );
    });
  });
});
