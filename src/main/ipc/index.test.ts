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

import { registerIpcHandlers, MUTATING_CHANNELS } from './index';
import { withOperationLock, setOperationNotifier } from '../services/operation-lock';

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
    ];
    for (const channel of expected) {
      expect(MUTATING_CHANNELS.has(channel), `"${channel}" must be serialized`).toBe(true);
    }
  });
});
