import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Settings } from './Settings';
import { ToastProvider } from '../components/ui/Toast';
import { DEFAULT_SETTINGS, type AppSettings, type AppEnvironment } from '@shared/settings';
import { serializeConfigProfile, type ConfigProfile } from '@shared/config-profile';

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
    exportProfile: () =>
      Promise.resolve({
        kind: 'forchi-winoptimizer-profile',
        version: 1,
        exportedAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
        settings,
        appliedTweaks: [],
      }),
    previewProfile: () =>
      Promise.resolve({ success: false as const, error: 'Invalid profile file.' }),
    applyProfile: () =>
      Promise.resolve({
        success: true,
        applied: [],
        failed: [],
        skipped: [],
        settingsUpdated: true,
        settingsMessage: 'Settings saved.',
        message: 'Profile import: 0 applied, 0 failed, 0 skipped.',
      }),
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

describe('Settings configuration profile (A3)', () => {
  const profile: ConfigProfile = {
    kind: 'forchi-winoptimizer-profile',
    version: 1,
    exportedAt: new Date('2026-10-01T00:00:00.000Z').toISOString(),
    appVersion: '0.17.0',
    settings: { ...DEFAULT_SETTINGS, enableNotifications: false },
    appliedTweaks: ['show-file-extensions'],
  };

  function renderWithToast(): void {
    render(
      <ToastProvider>
        <Settings theme="dark" onThemeToggle={() => {}} />
      </ToastProvider>
    );
  }

  function chooseFile(json: string): void {
    const input = screen.getByTestId('profile-file') as HTMLInputElement;
    const file = new File([json], 'profile.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  }

  beforeEach(() => {
    setApi(makeApi());
    vi.stubGlobal('URL', {
      ...(URL as unknown as Record<string, unknown>),
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('shows Export and Import profile actions', async () => {
    renderWithToast();
    await screen.findByText('Start with Windows');
    expect(screen.getByTestId('profile-export')).toBeInTheDocument();
    expect(screen.getByTestId('profile-import')).toBeInTheDocument();
  });

  it('exports the profile to a JSON download and toasts the real result', async () => {
    const exportProfile = vi.fn(() => Promise.resolve(profile));
    setApi(makeApi({} as never));
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      ...makeApi(),
      exportProfile,
    };
    renderWithToast();
    await screen.findByText('Start with Windows');

    fireEvent.click(screen.getByTestId('profile-export'));

    await waitFor(() => expect(exportProfile).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    await screen.findByTestId('profile-result');
    expect(screen.getByTestId('profile-result')).toHaveTextContent(/Exported 1 tweak/);
    expect(screen.getByTestId('toast')).toBeInTheDocument();
    expect(within(screen.getByTestId('toast')).getByText(/Profile exported/)).toBeInTheDocument();
  });

  it('rejects an invalid profile without ever applying it', async () => {
    const applyProfile = vi.fn();
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      ...makeApi(),
      previewProfile: () =>
        Promise.resolve({ success: false as const, error: 'Invalid profile: not valid JSON.' }),
      applyProfile,
    };
    renderWithToast();
    await screen.findByText('Start with Windows');

    chooseFile('{nope');

    await screen.findByTestId('profile-error');
    expect(screen.getByTestId('profile-error')).toHaveTextContent(/not valid JSON/i);
    expect(screen.queryByTestId('profile-preview')).not.toBeInTheDocument();
    expect(applyProfile).not.toHaveBeenCalled();
  });

  it('previews a valid profile and only applies after confirmation', async () => {
    const applyProfile = vi.fn(() =>
      Promise.resolve({
        success: true,
        applied: ['show-file-extensions'],
        failed: [],
        skipped: [],
        settingsUpdated: true,
        settingsMessage: 'Settings saved.',
        message: 'Profile import: 1 applied, 0 failed, 0 skipped.',
      })
    );
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      ...makeApi(),
      previewProfile: () =>
        Promise.resolve({
          success: true as const,
          profile,
          preview: {
            settingsChanges: [{ key: 'enableNotifications', from: true, to: false }],
            tweaksToApply: ['show-file-extensions'],
            tweaksAlreadyApplied: [],
            tweaksUnknown: [],
            extrasKept: [],
            counts: { settingsChanges: 1, toApply: 1, alreadyApplied: 0, unknown: 0 },
          },
        }),
      applyProfile,
    };
    renderWithToast();
    await screen.findByText('Start with Windows');

    chooseFile(serializeConfigProfile(profile));

    await screen.findByTestId('profile-preview');
    expect(screen.getByTestId('profile-preview')).toHaveTextContent(/will change 1 setting/);
    // Nothing applied yet: confirmation is mandatory.
    expect(applyProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('profile-apply-confirm'));

    await waitFor(() => expect(applyProfile).toHaveBeenCalledTimes(1));
    expect(applyProfile).toHaveBeenCalledWith(profile);
    await screen.findByTestId('profile-result');
    expect(screen.getByTestId('profile-result')).toHaveTextContent(
      /1 applied, 0 failed, 0 skipped/
    );
  });

  it('reports partial failures honestly (applied / failed / skipped)', async () => {
    const applyProfile = vi.fn(() =>
      Promise.resolve({
        success: true,
        applied: ['tweak-a'],
        failed: [{ id: 'tweak-fails', message: 'Registry denied.' }],
        skipped: [{ id: 'ghost-id', reason: 'Unknown tweak id.' }],
        settingsUpdated: true,
        settingsMessage: 'Settings saved.',
        message: 'Profile import: 1 applied, 1 failed, 1 skipped.',
      })
    );
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      ...makeApi(),
      previewProfile: () =>
        Promise.resolve({
          success: true as const,
          profile,
          preview: {
            settingsChanges: [],
            tweaksToApply: ['tweak-a', 'tweak-fails'],
            tweaksAlreadyApplied: [],
            tweaksUnknown: ['ghost-id'],
            extrasKept: [],
            counts: { settingsChanges: 0, toApply: 2, alreadyApplied: 0, unknown: 1 },
          },
        }),
      applyProfile,
    };
    renderWithToast();
    await screen.findByText('Start with Windows');

    chooseFile(serializeConfigProfile(profile));
    await screen.findByTestId('profile-preview');
    expect(screen.getByTestId('profile-preview')).toHaveTextContent(/Unknown ids/);
    fireEvent.click(screen.getByTestId('profile-apply-confirm'));

    await screen.findByTestId('profile-result');
    expect(screen.getByTestId('profile-result')).toHaveTextContent(
      /1 applied, 1 failed, 1 skipped/
    );
    expect(screen.getByTestId('profile-result')).toHaveTextContent(/tweak-fails: Registry denied/);
  });
});
