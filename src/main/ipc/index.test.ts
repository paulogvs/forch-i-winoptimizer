import { describe, it, expect, vi, beforeEach } from 'vitest';

type Listener = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Listener>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: Listener) => {
      handlers.set(channel, listener);
    },
  },
}));

vi.mock('../services/operation-lock', () => ({
  withOperationLock: vi.fn(async (_label: string, fn: () => unknown) => fn()),
  getOperationStatus: vi.fn(() => ({ busy: false, current: null, queued: 0, startedAt: null })),
  setOperationNotifier: vi.fn(),
}));

vi.mock('../services/tweaks', () => ({
  getTweaks: vi.fn(() => []),
  previewTweak: vi.fn(async () => ({ ok: true })),
  applyTweak: vi.fn(async () => ({ success: true, message: 'applied' })),
  restoreTweak: vi.fn(async () => ({ success: true, message: 'restored' })),
  applyTweaks: vi.fn(async () => ({ applied: 0, failed: 0 })),
  restoreTweaks: vi.fn(async () => ({ restored: 0, failed: 0 })),
}));

vi.mock('../services/system-audit', () => ({
  runSystemAudit: vi.fn(),
}));

vi.mock('../services/security-privacy', () => ({
  getPrivacySettings: vi.fn(),
  applyPrivacySetting: vi.fn(),
  applyAllPrivacySettings: vi.fn(),
  runSecurityAction: vi.fn(),
  getSecurityActions: vi.fn(),
  benchmarkDNS: vi.fn(),
  setDNS: vi.fn(),
}));

vi.mock('../services/quick-fixes', () => ({
  cleanTempQuick: vi.fn(async () => ({
    success: true,
    scanned: 2,
    scannedBytes: 2048,
    deleted: 2,
    freedBytes: 2048,
    failed: 0,
    errors: [],
    message: 'Cleaned 2 file(s), freed 0.00 MB.',
  })),
  flushDns: vi.fn(async () => ({
    success: true,
    entriesBefore: 20,
    entriesAfter: 0,
    message: 'DNS cache flushed (20 → 0 entries).',
  })),
}));

vi.mock('../services/stats', () => ({
  recordStatsEvent: vi.fn(),
  getStatsEvents: vi.fn(() => []),
  defaultStatsFileName: vi.fn(() => 'stats.csv'),
  exportStatsCsv: vi.fn(),
}));

vi.mock('../services/yara-engine', () => ({
  getYaraEngine: vi.fn(),
  getMalwareScanScopes: vi.fn(() => []),
}));

import { registerIpcHandlers, MUTATING_CHANNELS } from './index';
import { withOperationLock, setOperationNotifier } from '../services/operation-lock';
import { getMalwareScanScopes, getYaraEngine } from '../services/yara-engine';
import { runSystemAudit } from '../services/system-audit';
import { getPrivacySettings } from '../services/security-privacy';
import { cleanTempQuick, flushDns } from '../services/quick-fixes';
import { recordStatsEvent } from '../services/stats';
import { cache } from '../services/cache';
import type { AuditReport, PrivacySetting } from '@shared/types';

describe('IPC handler registration (P0.3 global mutex)', () => {
  beforeEach(() => {
    handlers.clear();
    vi.mocked(withOperationLock).mockClear();
    vi.mocked(setOperationNotifier).mockClear();
    registerIpcHandlers(null);
  });

  it('registers the operation status channel', () => {
    expect(handlers.has('system:op-status')).toBe(true);
    const status = handlers.get('system:op-status')?.({});
    expect(status).toEqual({ busy: false, current: null, queued: 0, startedAt: null });
  });

  it('registers a renderer status notifier', () => {
    expect(vi.mocked(setOperationNotifier)).toHaveBeenCalledTimes(1);
    expect(typeof vi.mocked(setOperationNotifier).mock.calls[0]?.[0]).toBe('function');
  });

  it('routes mutating channels through the global lock', async () => {
    const apply = handlers.get('tweaks:apply');
    expect(apply).toBeDefined();

    const result = await apply?.({}, 'some-tweak');

    expect(vi.mocked(withOperationLock)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(withOperationLock).mock.calls[0]?.[0]).toBe('tweaks:apply');
    expect(result).toEqual({ success: true, message: 'applied' });
  });

  it('does not lock pure read channels', async () => {
    const get = handlers.get('tweaks:get');
    expect(get).toBeDefined();

    await get?.({});

    expect(withOperationLock).not.toHaveBeenCalled();
  });

  it('keeps the mutating channel list in sync with the registered handlers', () => {
    for (const channel of MUTATING_CHANNELS) {
      expect(handlers.has(channel), `missing handler for mutating channel "${channel}"`).toBe(true);
    }
  });

  it('covers every system-mutating channel family', () => {
    const expected = [
      'tweaks:apply',
      'tweaks:restore',
      'bundles:install',
      'bundles:uninstall',
      'apps:uninstall',
      'services:toggle',
      'cleaner:delete',
      'cleaning:run-now',
      'privacy:apply-setting',
      'security:run-action',
      'dns:set',
      'drivers:install',
      'network:fix',
      'startup:toggle',
      'drift:reapply',
      'memory:free',
      'debloat:remove',
      'quickfix:clean-temp',
      'quickfix:restore-point',
      'quickfix:scan-drivers',
      'network:flush-dns',
    ];
    for (const channel of expected) {
      expect(MUTATING_CHANNELS.has(channel), `"${channel}" must be serialized`).toBe(true);
    }
  });
});

describe('Quick fixes IPC (Fase 3)', () => {
  beforeEach(() => {
    handlers.clear();
    vi.mocked(withOperationLock).mockClear();
    vi.mocked(cleanTempQuick).mockClear();
    vi.mocked(flushDns).mockClear();
    vi.mocked(recordStatsEvent).mockClear();
    registerIpcHandlers(null);
  });

  it('registers all four quick-fix channels', () => {
    expect(handlers.has('quickfix:clean-temp')).toBe(true);
    expect(handlers.has('network:flush-dns')).toBe(true);
    expect(handlers.has('quickfix:restore-point')).toBe(true);
    expect(handlers.has('quickfix:scan-drivers')).toBe(true);
  });

  it('routes Clean Temp through the lock and records the real cleanup', async () => {
    const result = await handlers.get('quickfix:clean-temp')?.({});

    expect(vi.mocked(withOperationLock)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(withOperationLock).mock.calls[0]?.[0]).toBe('quickfix:clean-temp');
    expect(result).toMatchObject({ deleted: 2, freedBytes: 2048 });
    expect(vi.mocked(recordStatsEvent)).toHaveBeenCalledWith({
      type: 'clean',
      files: 2,
      bytes: 2048,
    });
  });

  it('records a maintenance event only when Flush DNS is verified', async () => {
    await handlers.get('network:flush-dns')?.({});

    expect(vi.mocked(withOperationLock).mock.calls[0]?.[0]).toBe('network:flush-dns');
    expect(vi.mocked(recordStatsEvent)).toHaveBeenCalledWith({ type: 'maintenance', files: 1 });
  });
});

// Regression: `privacy:get-settings` and `audit:run` both used `withCache('health')`
// with no params, so the second channel was served the first channel's payload.
// The renderer then crashed on `report.checks.filter(...)` and React unmounted the
// whole tree (blank window). Each channel must own a distinct cache module.
describe('cache module isolation between channels', () => {
  const auditReport: AuditReport = {
    checks: [
      {
        id: 'audit-1',
        name: 'Audit check',
        category: 'privacy',
        status: 'pass',
        description: '',
        recommendation: '',
        impact: 'low',
        autoFixable: false,
      },
    ],
    totalChecks: 1,
    passedCount: 1,
    warningCount: 0,
    criticalCount: 0,
    score: 90,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
  };

  const privacySettings: PrivacySetting[] = [
    {
      id: 'privacy-1',
      name: 'Telemetry off',
      description: '',
      category: 'telemetry',
      registryPath: 'HKLM\\Software\\Test',
      valueName: 'TestValue',
      recommendedValue: 0,
      currentValue: 1,
      isApplied: false,
      impact: 'low',
    },
  ];

  beforeEach(() => {
    handlers.clear();
    cache.clear();
    vi.mocked(runSystemAudit).mockReset();
    vi.mocked(getPrivacySettings).mockReset();
    registerIpcHandlers(null);
  });

  it('does not serve privacy:get-settings from an audit:run entry', async () => {
    vi.mocked(runSystemAudit).mockResolvedValue(auditReport);
    vi.mocked(getPrivacySettings).mockResolvedValue(privacySettings);

    await handlers.get('audit:run')?.({});
    const privacy = await handlers.get('privacy:get-settings')?.({});

    expect(privacy).toEqual(privacySettings);
  });

  it('does not serve audit:run from a privacy:get-settings entry', async () => {
    vi.mocked(runSystemAudit).mockResolvedValue(auditReport);
    vi.mocked(getPrivacySettings).mockResolvedValue(privacySettings);

    await handlers.get('privacy:get-settings')?.({});
    const audit = await handlers.get('audit:run')?.({});

    expect(audit).toMatchObject({ checks: auditReport.checks, score: auditReport.score });
    expect(Array.isArray((audit as AuditReport).checks)).toBe(true);
  });

  it('invalidates the privacy module after applying a privacy setting', async () => {
    vi.mocked(getPrivacySettings).mockResolvedValue(privacySettings);

    await handlers.get('privacy:get-settings')?.({});
    expect(vi.mocked(getPrivacySettings)).toHaveBeenCalledTimes(1);

    await handlers.get('privacy:apply-setting')?.({}, 'privacy-1');
    await handlers.get('privacy:get-settings')?.({});

    expect(vi.mocked(getPrivacySettings)).toHaveBeenCalledTimes(2);
  });
});

describe('Malware scan IPC (Fase 4.4)', () => {
  const report = {
    scope: ['C:\\scan'],
    files: [],
    summary: { clean: 1, infected: 0, unknown: 0, total: 1 },
    rulesVersion: '1.0.0',
    engine: 'yara-x 0.7.5 (worker_thread)',
    scannedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    durationMs: 12,
    note: null,
  };

  beforeEach(() => {
    handlers.clear();
    vi.mocked(withOperationLock).mockClear();
    vi.mocked(getYaraEngine).mockReset();
    vi.mocked(getMalwareScanScopes).mockReset();
    registerIpcHandlers(null);
  });

  it('serializes malware scans through the global lock', async () => {
    const scanPaths = vi.fn(async () => report);
    vi.mocked(getYaraEngine).mockReturnValue({ scanPaths } as unknown as ReturnType<
      typeof getYaraEngine
    >);

    const result = await handlers.get('malware:scan')?.({}, { paths: ['C:\\scan'] });

    expect(vi.mocked(withOperationLock)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(withOperationLock).mock.calls[0]?.[0]).toBe('malware:scan');
    expect(scanPaths).toHaveBeenCalledWith(['C:\\scan'], undefined);
    expect(result).toEqual(report);
    expect(recordStatsEvent).toHaveBeenCalledWith({ type: 'maintenance', files: 1 });
  });

  it('rejects empty malware scan scopes without touching the engine', async () => {
    await expect(handlers.get('malware:scan')?.({}, { paths: [] })).rejects.toThrow(
      /at least one path/i
    );
    expect(vi.mocked(getYaraEngine)).not.toHaveBeenCalled();
  });

  it('keeps malware:cancel out of the lock so it always preempts', async () => {
    const cancel = vi.fn(async () => undefined);
    vi.mocked(getYaraEngine).mockReturnValue({ cancel } as unknown as ReturnType<
      typeof getYaraEngine
    >);

    const result = await handlers.get('malware:cancel')?.({});

    expect(vi.mocked(withOperationLock)).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, message: 'Malware scan cancelled.' });
  });

  it('serves live preset scopes without the lock', async () => {
    const scopes = [{ id: 'temp', label: 'Windows Temp folder', path: 'C:\\Temp' }];
    vi.mocked(getMalwareScanScopes).mockReturnValue(scopes);

    const result = await handlers.get('malware:scopes')?.({});

    expect(vi.mocked(withOperationLock)).not.toHaveBeenCalled();
    expect(result).toEqual(scopes);
  });
});
