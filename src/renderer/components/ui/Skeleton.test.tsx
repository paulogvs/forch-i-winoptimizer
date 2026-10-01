import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonTable, SkeletonList, SkeletonCards } from './Skeleton';

describe('Skeleton', () => {
  it('renders a table skeleton with the requested number of rows', () => {
    const { container } = render(<SkeletonTable rows={4} columns={3} />);
    expect(screen.getByTestId('skeleton-table')).toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton-table-row')).toHaveLength(4);
  });

  it('renders a list skeleton', () => {
    const { container } = render(<SkeletonList rows={3} />);
    expect(screen.getByTestId('skeleton-list')).toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton-list-row')).toHaveLength(3);
  });

  it('renders a card skeleton', () => {
    render(<SkeletonCards count={2} />);
    expect(screen.getByTestId('skeleton-cards')).toBeInTheDocument();
  });
});
