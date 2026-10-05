import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Audit } from './Audit';

describe('Audit SWR (Fase 1.2)', () => {
  const cached = {
    checks: [],
    totalChecks: 0,
    passedCount: 0,
    warningCount: 0,
    criticalCount: 0,
    score: 80,
    timestamp: new Date(),
  };
  const fresh = { ...cached, score: 90 };

  beforeEach(() => {
    vi.clearAllMocks();
    const run = vi.fn();
    run.mockResolvedValueOnce(cached).mockResolvedValue(fresh);
    (window as unknown as { winoptimizer: unknown }).winoptimizer = { audit: { run } };
    (window as unknown as { __auditRun: unknown }).__auditRun = run;
  });

  it('paints from cache first, then silently revalidates with force:true', async () => {
    render(<Audit />);

    await waitFor(() => expect(screen.getByText('90')).toBeInTheDocument());

    const run = (window as unknown as { __auditRun: ReturnType<typeof vi.fn> }).__auditRun;
    // First paint: cache (no force). Background revalidation: force:true.
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toBeUndefined();
    expect(run.mock.calls[1]?.[0]).toEqual({ force: true });
    // The visible report is the revalidated one.
    expect(screen.getByText('90')).toBeInTheDocument();
  });
});
