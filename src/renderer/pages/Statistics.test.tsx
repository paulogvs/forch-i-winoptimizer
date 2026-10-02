import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Statistics } from './Statistics';
import type { StatsEvent } from '@shared/stats';

type Api = Record<string, unknown>;

function setApi(api: Api): void {
  (window as unknown as { electronAPI: Api }).electronAPI = api;
}

const events: StatsEvent[] = [
  {
    id: '1',
    type: 'scan',
    timestamp: '2026-01-01T10:00:00.000Z',
    files: 4,
    bytes: 4096,
    score: null,
  },
  {
    id: '2',
    type: 'clean',
    timestamp: '2026-01-01T10:05:00.000Z',
    files: 4,
    bytes: 4096,
    score: null,
  },
  { id: '3', type: 'audit', timestamp: '2026-01-01T10:10:00.000Z', files: 0, bytes: 0, score: 88 },
  {
    id: '4',
    type: 'boost',
    timestamp: '2026-01-01T10:15:00.000Z',
    files: 0,
    bytes: 2048,
    score: null,
  },
];

describe('Statistics page', () => {
  beforeEach(() => {
    setApi({
      getStats: () => Promise.resolve([]),
      exportStats: () => Promise.resolve({ success: true, message: 'ok' }),
    });
  });

  it('shows an honest empty state with no recorded activity', async () => {
    render(<Statistics />);
    expect(await screen.findByText('No activity recorded yet')).toBeInTheDocument();
  });

  it('renders real charts from recorded events', async () => {
    setApi({ getStats: () => Promise.resolve(events) });
    render(<Statistics />);

    expect(await screen.findByTestId('chart-scan')).toBeInTheDocument();
    expect(screen.getByTestId('chart-clean')).toBeInTheDocument();
    expect(screen.getByTestId('chart-audit')).toBeInTheDocument();
    expect(screen.getByTestId('chart-boost')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /junk bytes/i })).toBeInTheDocument();
  });

  it('exports CSV through the main process and reports the result', async () => {
    const exportStats = vi
      .fn()
      .mockResolvedValue({ success: true, message: 'Exported 4 event(s).' });
    setApi({ getStats: () => Promise.resolve(events), exportStats });
    render(<Statistics />);

    fireEvent.click(await screen.findByTestId('export-csv'));

    await waitFor(() => expect(exportStats).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Exported 4 event(s).')).toBeInTheDocument();
  });
});
