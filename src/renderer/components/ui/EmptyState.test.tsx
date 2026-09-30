import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No data" />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(<EmptyState title="No data" description="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('renders action button', () => {
    render(<EmptyState title="No data" actionLabel="Refresh" onAction={() => {}} />);
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('calls onAction when button is clicked', () => {
    const handleAction = vi.fn();
    render(<EmptyState title="No data" actionLabel="Refresh" onAction={handleAction} />);
    fireEvent.click(screen.getByText('Refresh'));
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('does not render action button without onAction', () => {
    render(<EmptyState title="No data" actionLabel="Refresh" />);
    expect(screen.queryByText('Refresh')).not.toBeInTheDocument();
  });
});
