import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Settings } from './Settings';
import { DEFAULT_SETTINGS, type AppSettings, type AppEnvironment } from '@shared/settings';

type Api = Record<string, unknown>;

const environment: AppEnvironment = {
  portable: false,
  loginItemSupported: true,
  platform: 'win32',
};

function makeApi(
  options: {
    settings?: Partial<AppSettings>;
    environment?: Partial<AppEnvironment>;
    updateSettings?: (patch: Partial<AppSettings>) => Promise<unknown>;
  } = {}
): Api {
  const settings = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) };
  const env = { ...environment, ...(options.environment ?? {}) };
  return {
    getSettings: () => Promise.resolve({ settings, environment: env }),
    updateSettings:
      options.updateSettings ??
      ((patch: Partial<AppSettings>) =>
        Promise.resolve({
          settings: { ...settings, ...patch },
          environment: env,
          ok: true,
          message: 'Settings saved.',
        })),
    getUpdateStatus: () =>
      Promise.resolve({ state: 'idle', version: null, percent: null, message: null }),
    checkForUpdates: () =>
      Promise.resolve({
        currentVersion: '0.5.0',
        latestVersion: '0.5.0',
        updateAvailable: false,
        releaseNotes: '',
        downloadUrl: '',
        publishedAt: new Date(),
        size: 0,
      }),
    checkForUpdatesNow: () =>
      Promise.resolve({ state: 'checking', version: null, percent: null, message: null }),
    downloadUpdateNow: () =>
      Promise.resolve({ state: 'downloading', version: null, percent: 0, message: null }),
    installUpdateNow: () => Promise.resolve({ success: true, message: 'ok' }),
    onUpdateStatus: () => () => {},
    onUpdateProgress: () => () => {},
  };
}

function setApi(api: Api): void {
  (window as unknown as { electronAPI: Api }).electronAPI = api;
}

describe('Settings page', () => {
  beforeEach(() => {
    setApi(makeApi());
  });

  it('no longer shows the old disabled stubs', async () => {
    render(<Settings theme="dark" onThemeToggle={() => {}} />);
    await screen.findByText('Start with Windows');
    expect(screen.queryByTitle('Not implemented yet')).not.toBeInTheDocument();
    expect(
      screen.queryByTitle('Accent color customization is not implemented yet')
    ).not.toBeInTheDocument();
  });

  it('persists a toggle change through updateSettings', async () => {
    const updateSettings = vi.fn((patch: Partial<AppSettings>) =>
      Promise.resolve({
        settings: { ...DEFAULT_SETTINGS, ...patch },
        environment,
        ok: true,
        message: 'Settings saved.',
      })
    );
    setApi(makeApi({ updateSettings }));
    render(<Settings theme="dark" onThemeToggle={() => {}} />);

    const toggle = await screen.findByRole('switch', { name: 'Enable notifications' });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ enableNotifications: false })
    );
  });

  it('applies and persists an accent colour', async () => {
    const updateSettings = vi.fn((patch: Partial<AppSettings>) =>
      Promise.resolve({
        settings: { ...DEFAULT_SETTINGS, ...patch },
        environment,
        ok: true,
        message: 'Settings saved.',
      })
    );
    setApi(makeApi({ updateSettings }));
    render(<Settings theme="dark" onThemeToggle={() => {}} />);

    const input = await screen.findByLabelText('Accent Color');
    fireEvent.change(input, { target: { value: '#FF0000' } });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        accentColor: expect.stringMatching(/^#ff0000$/i),
      })
    );
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toMatch(/^#FF0000$/i);
  });

  it('disables Start with Windows and explains it in the portable build', async () => {
    setApi(makeApi({ environment: { portable: true, loginItemSupported: false } }));
    render(<Settings theme="dark" onThemeToggle={() => {}} />);

    const toggle = await screen.findByRole('switch', { name: 'Start with Windows' });
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText(/Start with Windows is not available in the portable build/i)
    ).toBeInTheDocument();
  });
});
