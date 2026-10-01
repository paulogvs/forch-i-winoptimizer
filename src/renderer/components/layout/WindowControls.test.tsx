import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { WindowControls } from './WindowControls';

let maximizeCb: (() => void) | undefined;

const controls = {
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  onMaximized: vi.fn((cb: () => void) => {
    maximizeCb = cb;
    return () => {};
  }),
  onUnmaximized: vi.fn(() => () => {}),
};

describe('WindowControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maximizeCb = undefined;
    controls.isMaximized.mockResolvedValue(false);
    (window as unknown as { electronAPI: unknown }).electronAPI = { window: controls };
  });

  it('renders accessible minimize / maximize / close buttons', () => {
    render(<WindowControls />);
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls the bridge for minimize and close', () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(controls.minimize).toHaveBeenCalledTimes(1);
    expect(controls.close).toHaveBeenCalledTimes(1);
  });

  it('maximizes when not maximized and unmaximizes when maximized', async () => {
    render(<WindowControls />);
    await waitFor(() => expect(controls.isMaximized).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(controls.maximize).toHaveBeenCalledTimes(1);

    act(() => maximizeCb?.());
    const restore = await screen.findByRole('button', { name: 'Restore' });
    fireEvent.click(restore);
    expect(controls.unmaximize).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount (no listener leaks)', () => {
    const offMax = vi.fn();
    const offUnmax = vi.fn();
    controls.onMaximized.mockReturnValue(offMax);
    controls.onUnmaximized.mockReturnValue(offUnmax);

    const { unmount } = render(<WindowControls />);
    unmount();

    expect(offMax).toHaveBeenCalledTimes(1);
    expect(offUnmax).toHaveBeenCalledTimes(1);
  });
});
