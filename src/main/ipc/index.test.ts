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

import { registerIpcHandlers, MUTATING_CHANNELS } from './index';
import { withOperationLock, setOperationNotifier } from '../services/operation-lock';
import { runSystemAudit } from '../services/system-audit';
import { getPrivacySettings } from '../services/security-privacy';
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
    ];
    for (const channel of expected) {
      expect(MUTATING_CHANNELS.has(channel), `"${channel}" must be serialized`).toBe(true);
    }
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
