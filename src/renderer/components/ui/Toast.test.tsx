import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider } from './Toast';
import { useToast } from './toast-context';

function Harness({ onAction }: { onAction?: () => void }) {
  const { notify, dismiss } = useToast();
  return (
    <div>
      <button
        data-testid="emit"
        onClick={() =>
          notify({
            title: 'RAM freed',
            message: 'Freed 42 MB (this app: 1024 → 982 MB).',
            variant: 'success',
            action: { label: 'View in Statistics', onClick: () => onAction?.() },
          })
        }
      >
        emit
      </button>
      <button data-testid="emit-error" onClick={() => notify({ title: 'Boom', variant: 'error' })}>
        emit-error
      </button>
      <button data-testid="dismiss-all" onClick={() => dismiss('toast-1')}>
        dismiss
      </button>
    </div>
  );
}

describe('Toast system (Fase 3.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an aria-live polite region and the real message', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );

    const container = screen.getByTestId('toast-container');
    expect(container).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(screen.getByTestId('emit'));

    expect(screen.getByTestId('toast')).toBeInTheDocument();
    expect(screen.getByText('RAM freed')).toBeInTheDocument();
    expect(screen.getByText(/Freed 42 MB/)).toBeInTheDocument();
  });

  it('runs the action link and dismisses the toast', () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <Harness onAction={onAction} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('emit'));
    fireEvent.click(screen.getByRole('button', { name: 'View in Statistics' }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });

  it('can be dismissed manually', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('emit-error'));
    expect(screen.getByText('Boom')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Boom')).not.toBeInTheDocument();
  });

  it('auto-dismisses after the default duration', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('emit-error'));
    expect(screen.getByText('Boom')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryByText('Boom')).not.toBeInTheDocument();
  });

  it('degrades to a no-op without a provider (never throws)', () => {
    render(<Harness />);
    expect(() => fireEvent.click(screen.getByTestId('emit'))).not.toThrow();
  });
});
