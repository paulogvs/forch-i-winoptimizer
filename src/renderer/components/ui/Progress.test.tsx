import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Progress } from './Progress';

describe('Progress', () => {
  it('renders progress bar', () => {
    render(<Progress value={50} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('sets aria attributes correctly', () => {
    render(<Progress value={75} max={100} label="CPU Usage" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '75');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('applies variant class', () => {
    render(<Progress value={50} variant="success" />);
    expect(screen.getByRole('progressbar').firstChild).toHaveClass('progress-bar-success');
  });

  it('shows label', () => {
    render(<Progress value={50} label="Memory" />);
    expect(screen.getByText('Memory')).toBeInTheDocument();
  });

  it('shows percentage value', () => {
    render(<Progress value={50} showValue />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('clamps value to 0-100 range', () => {
    render(<Progress value={150} showValue />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
