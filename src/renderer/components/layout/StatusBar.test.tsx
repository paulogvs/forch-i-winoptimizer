import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';

afterEach(() => {
  // Keep the bridge absent unless a test installs it.
  delete (window as unknown as Record<string, unknown>).electronAPI;
});

describe('StatusBar (Fase B: honest state)', () => {
  it('shows version and Windows version', () => {
    render(<StatusBar version="0.18.0" windowsVersion="Windows 11" lastScan={null} />);
    expect(screen.getByText('v0.18.0')).toBeInTheDocument();
    expect(screen.getByText('Windows 11')).toBeInTheDocument();
  });

  it('carries the FORCH.i brand badge in the footer', () => {
    render(<StatusBar version="0.18.0" windowsVersion="Windows 11" lastScan={null} />);
    const badge = screen.getByTitle('Built with FORCH.i by Paulo Velasco');
    expect(badge).toHaveAttribute('href', 'https://github.com/forchia-ecosystem');
  });

  it('shows Ready when idle (no bridge)', () => {
    render(<StatusBar version="0.18.0" windowsVersion="Windows 11" lastScan={null} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('shows the last scan date when idle and provided', () => {
    render(
      <StatusBar version="0.18.0" windowsVersion="Windows 11" lastScan={new Date(2026, 9, 1)} />
    );
    expect(screen.getByText(/Last scan:/)).toBeInTheDocument();
  });

  it('shows Working while an operation owns the lock', async () => {
    (window as unknown as Record<string, unknown>).electronAPI = {
      getOperationStatus: () =>
        Promise.resolve({
          busy: true,
          current: 'cleaner:delete',
          queued: 2,
          startedAt: Date.now(),
        }),
      onOperationStatus: () => () => {},
    };
    render(<StatusBar version="0.18.0" windowsVersion="Windows 11" lastScan={null} />);
    expect(await screen.findByText(/Working/)).toBeInTheDocument();
  });
});
