import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useOperationStatus } from './useOperationStatus';
import type { OperationStatus } from '@shared/electron-api';

type Listener = (status: OperationStatus) => void;

function bridgeWith(initial: OperationStatus) {
  const listeners: Listener[] = [];
  return {
    listeners,
    api: {
      getOperationStatus: vi.fn(() => Promise.resolve(initial)),
      onOperationStatus: vi.fn((cb: Listener) => {
        listeners.push(cb);
        return () => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        };
      }),
    },
  };
}

const IDLE: OperationStatus = { busy: false, current: null, queued: 0, startedAt: null };
const BUSY: OperationStatus = {
  busy: true,
  current: 'tweaks:apply',
  queued: 1,
  startedAt: 1700000000000,
};

describe('useOperationStatus (P0.3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Remove any bridge left behind by a test.
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('starts idle when the bridge reports no operation', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = bridgeWith(IDLE).api;

    const { result } = renderHook(() => useOperationStatus());

    expect(result.current).toEqual(IDLE);
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it('reflects the initial status reported by the main process', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = bridgeWith(BUSY).api;

    const { result } = renderHook(() => useOperationStatus());

    await waitFor(() => expect(result.current).toEqual(BUSY));
  });

  it('updates when a status change is pushed from the main process', async () => {
    const bridge = bridgeWith(IDLE);
    (window as unknown as { electronAPI: unknown }).electronAPI = bridge.api;

    const { result } = renderHook(() => useOperationStatus());
    await waitFor(() => expect(result.current.busy).toBe(false));

    act(() => {
      bridge.listeners.forEach((cb) => cb(BUSY));
    });

    expect(result.current).toEqual(BUSY);
  });

  it('unsubscribes on unmount', async () => {
    const bridge = bridgeWith(IDLE);
    (window as unknown as { electronAPI: unknown }).electronAPI = bridge.api;

    const { unmount } = renderHook(() => useOperationStatus());
    unmount();

    expect(bridge.listeners).toHaveLength(0);
  });

  it('stays idle when the preload bridge is absent (plain browser)', () => {
    const { result } = renderHook(() => useOperationStatus());
    expect(result.current).toEqual(IDLE);
  });
});
