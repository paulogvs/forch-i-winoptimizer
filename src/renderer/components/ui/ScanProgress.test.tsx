import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanProgress } from './ScanProgress';

describe('ScanProgress', () => {
  it('renders nothing without an event', () => {
    const { container } = render(<ScanProgress event={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current stage and percentage', () => {
    render(<ScanProgress event={{ module: 'system', stage: 'parse', percent: 70, message: 'Parsing...' }} />);
    const root = screen.getByTestId('scan-progress');
    expect(root).toHaveAttribute('data-stage', 'parse');
    expect(root).toHaveTextContent('Parsing');
    expect(root).toHaveTextContent('70%');
    expect(root).toHaveTextContent('Parsing...');
  });

  it('marks earlier stages as done and hides the stepper on error', () => {
    const { rerender } = render(<ScanProgress event={{ module: 'junk', stage: 'normalize', percent: 90 }} />);
    expect(screen.getAllByText('Query')[0]).toBeInTheDocument();

    rerender(<ScanProgress event={{ module: 'junk', stage: 'error', percent: 100 }} />);
    expect(screen.queryByText('Discover')).not.toBeInTheDocument();
  });
});
