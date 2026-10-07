import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GlobalBusyOverlay } from './GlobalBusyOverlay';

function setBridge(status: { busy: boolean; current: string | null; queued: number }) {
  (window as unknown as Record<string, unknown>).electronAPI = {
    getOperationStatus: () => Promise.resolve({ ...status, startedAt: Date.now() }),
    onOperationStatus: () => () => {},
  };
}

describe('GlobalBusyOverlay (Fase C: elite thinking indicator)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('stays hidden when idle', () => {
    setBridge({ busy: false, current: null, queued: 0 });
    render(<GlobalBusyOverlay />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId('global-busy')).not.toBeInTheDocument();
  });

  it('stays hidden for quick operations (under the threshold)', async () => {
    setBridge({ busy: true, current: 'cleaner:delete', queued: 0 });
    render(<GlobalBusyOverlay />);
    await Promise.resolve();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('global-busy')).not.toBeInTheDocument();
  });

  it('appears for long operations and never blocks pointer input', async () => {
    setBridge({ busy: true, current: 'cleaner:delete', queued: 2 });
    render(<GlobalBusyOverlay />);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    const overlay = screen.getByTestId('global-busy');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveTextContent(/Working/);
    expect(overlay).toHaveTextContent(/\+2/);
    expect(overlay).toHaveAttribute('role', 'status');
  });
});
