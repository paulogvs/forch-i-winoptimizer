import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Audit } from './Audit';
import type { AuditCategory } from '@shared/types';

/**
 * Fase 5.3: the Audit page must load scans lazily, one category per tab.
 * A full 31-check audit must never run at mount.
 */
describe('Audit lazy per-category loading (Fase 5.3)', () => {
  const reportFor = (category: AuditCategory) => ({
    checks: [
      {
        id: `${category}-check`,
        name: `${category} check`,
        category,
        status: 'pass' as const,
        description: '',
        recommendation: '',
        impact: 'low' as const,
        autoFixable: false,
      },
    ],
    totalChecks: 1,
    passedCount: 1,
    warningCount: 0,
    criticalCount: 0,
    score: 100,
    timestamp: new Date(),
  });

  let run: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    run = vi.fn().mockImplementation((options?: { categories?: AuditCategory[] }) => {
      const category = options?.categories?.[0] ?? 'privacy';
      return Promise.resolve(reportFor(category));
    });
    (window as unknown as { winoptimizer: unknown }).winoptimizer = { audit: { run } };
  });

  it('scans only the landing category on mount (not all six)', async () => {
    render(<Audit />);

    await waitFor(() => expect(screen.getByText('privacy check')).toBeInTheDocument());

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual({ categories: ['privacy'] });
  });

  it('scans a category only when its tab is opened', async () => {
    render(<Audit />);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('audit-tab-performance'));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]?.[0]).toEqual({ categories: ['performance'] });
    // The first category stays cached: no third call when going back to it.
    fireEvent.click(screen.getByTestId('audit-tab-privacy'));
    await waitFor(() => expect(screen.getByText('privacy check')).toBeInTheDocument());
    expect(run).toHaveBeenCalledTimes(2);
  });
});
