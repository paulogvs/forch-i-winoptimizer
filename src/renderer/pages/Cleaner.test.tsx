import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { Cleaner } from './Cleaner';

// jsdom has no layout, so the real virtualizer measures a 0-height viewport
// and mounts 0 rows. Mock the window (not the contract): render the first 20
// rows like a real viewport window would, with the same DOM hooks.
vi.mock('../components/ui/VirtualList', () => ({
  VirtualList: ({ items, renderItem, getKey, testId }: never) => {
    const list = items as unknown[];
    const windowed = list.slice(0, 20);
    return React.createElement(
      'div',
      { 'data-testid': (testId as string) ?? 'virtual-list', 'data-count': list.length },
      windowed.map((item, index) =>
        React.createElement(
          'div',
          {
            key: (getKey as (item: unknown, i: number) => string)(item, index),
            className: 'virtual-list-row',
          },
          (renderItem as (item: never, i: number) => React.ReactNode)(item as never, index)
        )
      )
    );
  },
}));

type Api = Record<string, unknown>;

const files = [
  {
    id: 'f1',
    name: 'temp1.tmp',
    path: 'C:\\Temp\\temp1.tmp',
    size: 1024,
    category: 'temp',
    lastModified: new Date(),
    safeToDelete: true,
  },
  {
    id: 'f2',
    name: 'temp2.tmp',
    path: 'C:\\Temp\\temp2.tmp',
    size: 2048,
    category: 'temp',
    lastModified: new Date(),
    safeToDelete: true,
  },
];

function setApi(api: Api): void {
  (window as unknown as { electronAPI: Api }).electronAPI = api;
}

describe('Cleaner (Fase 0.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps files visible + shows error + offers retry when cleaning fails', async () => {
    setApi({
      scanForJunkFiles: () =>
        Promise.resolve({ files, totalSize: 3072, totalCount: 2, categories: {} }),
      deleteFiles: () =>
        Promise.resolve({ success: false, deleted: 0, failed: 2, errors: ['EACCES'] }),
    });

    render(<Cleaner />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));

    await waitFor(() => expect(screen.getByText('temp1.tmp')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /clean/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Files must STAY visible on failure (honest UI, no silent hiding).
    expect(screen.getByText('temp1.tmp')).toBeInTheDocument();
    expect(screen.getByText('temp2.tmp')).toBeInTheDocument();
    // A retry path must exist.
    expect(screen.getByRole('button', { name: /retry|try again|reintentar/i })).toBeInTheDocument();
  });
});

describe('Cleaner virtualization (Fase 1.5)', () => {
  function setApi(api: Api): void {
    (window as unknown as { electronAPI: Api }).electronAPI = api;
  }

  const manyFiles = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `f${i}`,
      name: `temp${i}.tmp`,
      path: `C:\\Temp\\temp${i}.tmp`,
      size: 1024,
      category: 'temp',
      lastModified: new Date(),
      safeToDelete: true,
    }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a plain list below the shared threshold', async () => {
    const two = manyFiles(2);
    setApi({
      scanForJunkFiles: () =>
        Promise.resolve({ files: two, totalSize: 2048, totalCount: 2, categories: {} }),
      deleteFiles: () => Promise.resolve({ success: true, deleted: 2, failed: 0, errors: [] }),
    });

    render(<Cleaner />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));

    await waitFor(() => expect(screen.getByText('temp0.tmp')).toBeInTheDocument());
    expect(screen.queryByTestId('cleaner-files')).not.toBeInTheDocument();
  });

  it('virtualizes past the threshold so 5000 files stay out of the DOM', async () => {
    const all = manyFiles(5000);
    setApi({
      scanForJunkFiles: () =>
        Promise.resolve({ files: all, totalSize: 5000 * 1024, totalCount: 5000, categories: {} }),
      deleteFiles: () => Promise.resolve({ success: true, deleted: 0, failed: 0, errors: [] }),
    });

    render(<Cleaner />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));

    await waitFor(() => expect(screen.getByTestId('cleaner-files')).toBeInTheDocument());
    // The full result set reaches the list (nothing silently dropped)…
    expect(screen.getByTestId('cleaner-files').getAttribute('data-count')).toBe('5000');
    // …but only the viewport window (+overscan) is mounted — never thousands.
    const rows = document.querySelectorAll('[data-testid="cleaner-files"] .virtual-list-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(200);
  }, 30000);
});
