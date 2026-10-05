import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Cleaner } from './Cleaner';

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
