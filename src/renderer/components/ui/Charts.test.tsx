import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarChart } from './BarChart';
import { LineChart } from './LineChart';

describe('BarChart', () => {
  it('shows an honest empty state when there is no data', () => {
    render(<BarChart data={[]} ariaLabel="test" emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders one bar per datum with an accessible mirror list', () => {
    const { container } = render(
      <BarChart
        data={[
          { label: 'A', value: 10 },
          { label: 'B', value: 20 },
        ]}
        ariaLabel="Values over time"
        formatValue={(v) => `${v} MB`}
      />
    );
    expect(screen.getByRole('img', { name: 'Values over time' })).toBeInTheDocument();
    expect(container.querySelectorAll('rect')).toHaveLength(2);
    // Not colour-only: values are exposed to assistive tech (tooltip + list).
    expect(screen.getAllByText('A: 10 MB').length).toBeGreaterThan(0);
    expect(screen.getAllByText('B: 20 MB').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('ul.sr-only li')).toHaveLength(2);
  });
});

describe('LineChart', () => {
  it('renders an empty state without data', () => {
    render(<LineChart data={[]} ariaLabel="score" emptyMessage="No audits yet" />);
    expect(screen.getByText('No audits yet')).toBeInTheDocument();
  });

  it('renders a polyline and one point per datum', () => {
    const { container } = render(
      <LineChart
        data={[
          { label: 'A', value: 50 },
          { label: 'B', value: 80 },
        ]}
        ariaLabel="Audit score"
        max={100}
      />
    );
    expect(screen.getByRole('img', { name: 'Audit score' })).toBeInTheDocument();
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });
});
