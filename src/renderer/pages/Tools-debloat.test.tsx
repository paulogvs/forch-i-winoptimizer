import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Tools } from './Tools';

type Api = Record<string, unknown>;

const catalogFixture = [
  {
    id: 'news1',
    name: 'News One',
    publisher: 'Microsoft',
    category: 'entertainment',
    protection: 'safe',
    description: 'News app one.',
    uninstallString: 'Microsoft.NewsOne',
    size: '~70 MB',
    source: 'winutil',
    installed: true,
  },
  {
    id: 'game1',
    name: 'Game One',
    publisher: 'King',
    category: 'gaming',
    protection: 'safe',
    description: 'Game one.',
    uninstallString: 'king.com.GameOne',
    size: '~150 MB',
    source: 'winutil',
    installed: true,
  },
  {
    id: 'xbox1',
    name: 'Xbox One',
    publisher: 'Microsoft',
    category: 'gaming',
    protection: 'caution',
    description: 'Xbox app one. Removing breaks capture.',
    uninstallString: 'Microsoft.XboxOne',
    size: '~200 MB',
    source: 'winutil',
    installed: true,
  },
  {
    id: 'store1',
    name: 'Store One',
    publisher: 'Microsoft',
    category: 'system',
    protection: 'protected',
    description: 'Store one. Never removed.',
    uninstallString: 'Microsoft.StoreOne',
    size: '—',
    source: 'winutil',
    installed: true,
  },
  {
    id: 'clip1',
    name: 'Clip One',
    publisher: 'Microsoft',
    category: 'entertainment',
    protection: 'safe',
    description: 'Clip one, not installed.',
    uninstallString: 'Clipchamp.ClipOne',
    size: '~200 MB',
    source: 'winutil',
    installed: false,
  },
];

function setApi(api: Api): void {
  (window as unknown as { electronAPI: Api }).electronAPI = api;
}

describe('Tools debloat tab (B3, v0.18.0)', () => {
  const confirmSpy = vi.spyOn(window, 'confirm');

  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy.mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockReset();
  });

  async function openDebloat(getBloatwareCatalog: () => Promise<unknown[]>) {
    const removeBloatware = vi.fn((ids: string[]) =>
      Promise.resolve({
        success: ids.length > 0,
        removed: ids.length,
        skipped: 0,
        failed: 0,
        refused: 0,
        message: `Removed ${ids.length} app(s).`,
        results: ids.map((id) => ({ id, name: id, status: 'removed' })),
      })
    );
    setApi({
      getInstalledApps: () => Promise.resolve([]),
      getStartupApps: () => Promise.resolve([]),
      getBloatwareCatalog,
      removeBloatware,
    });
    render(<Tools />);
    fireEvent.click(screen.getByRole('button', { name: 'Debloat' }));
    await waitFor(() => expect(screen.getByTestId('debloat-check-news1')).toBeInTheDocument());
    return { removeBloatware };
  }

  it('filters rows through the search box', async () => {
    await openDebloat(() => Promise.resolve(catalogFixture));

    fireEvent.change(screen.getByTestId('debloat-search'), { target: { value: 'news' } });

    expect(screen.getByTestId('debloat-check-news1')).toBeInTheDocument();
    expect(screen.queryByTestId('debloat-check-game1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('debloat-check-xbox1')).not.toBeInTheDocument();
  });

  it('selects and clears all selectable apps per category', async () => {
    await openDebloat(() => Promise.resolve(catalogFixture));

    // gaming: game1 (safe, installed) + xbox1 (caution, installed) are
    // selectable; the per-category select-all must take both, never protected.
    fireEvent.click(screen.getByTestId('debloat-select-all-gaming'));

    expect((screen.getByTestId('debloat-check-game1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('debloat-check-xbox1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('debloat-check-news1') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId('debloat-clear-gaming'));

    expect((screen.getByTestId('debloat-check-game1') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('debloat-check-xbox1') as HTMLInputElement).checked).toBe(false);
  });

  it('shows a pre-removal summary with caution warnings before executing', async () => {
    const { removeBloatware } = await openDebloat(() => Promise.resolve(catalogFixture));

    fireEvent.click(screen.getByTestId('debloat-check-game1'));
    fireEvent.click(screen.getByTestId('debloat-check-xbox1'));

    const summary = screen.getByTestId('debloat-summary');
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent('Game One');
    expect(summary).toHaveTextContent('Xbox One');
    // The caution entry must spell out what is lost.
    expect(summary).toHaveTextContent('Removing breaks capture');
    // Nothing runs before the user confirms the removal.
    expect(removeBloatware).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Remove selected \(2\)/ }));
    await waitFor(() => expect(removeBloatware).toHaveBeenCalledWith(['game1', 'xbox1']));
  });

  it('renders the removal receipt and re-reads the catalog as post verification', async () => {
    const getBloatwareCatalog = vi
      .fn()
      .mockResolvedValueOnce(catalogFixture)
      .mockResolvedValueOnce(
        catalogFixture.map((c) => (c.id === 'game1' ? { ...c, installed: false } : c))
      );
    const { removeBloatware } = await openDebloat(getBloatwareCatalog);

    fireEvent.click(screen.getByTestId('debloat-check-game1'));
    fireEvent.click(screen.getByRole('button', { name: /Remove selected \(1\)/ }));

    await waitFor(() => expect(removeBloatware).toHaveBeenCalled());
    // Receipt with the per-app outcome...
    await waitFor(() => expect(screen.getByTestId('debloat-receipt')).toBeInTheDocument());
    const receipt = screen.getByTestId('debloat-receipt');
    expect(within(receipt).getByText('game1')).toBeInTheDocument();
    expect(within(receipt).getByText('removed')).toBeInTheDocument();
    // ...and an explicit post check: the catalog was re-read from
    // Get-AppxPackage after the removal, with a visible note.
    await waitFor(() => expect(getBloatwareCatalog).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('debloat-verify')).toHaveTextContent(/Post-check/);
  });
});
