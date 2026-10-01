import { runPowerShell } from './powershell';
import type { AppBundle } from '@shared/types';

const APP_BUNDLES: AppBundle[] = [
  {
    id: 'browsers',
    name: 'Web Browsers',
    description: 'Popular web browsers for all your browsing needs',
    category: 'browsers',
    icon: '🌐',
    apps: [
      { id: 'chrome', name: 'Google Chrome', wingetId: 'Google.Chrome', description: 'Fast, secure browser by Google', size: 0, isInstalled: false, isSelected: false },
      { id: 'firefox', name: 'Mozilla Firefox', wingetId: 'Mozilla.Firefox', description: 'Open-source browser by Mozilla', size: 0, isInstalled: false, isSelected: false },
      { id: 'edge', name: 'Microsoft Edge', wingetId: 'Microsoft.Edge', description: 'Chromium-based browser by Microsoft', size: 0, isInstalled: false, isSelected: false },
      { id: 'brave', name: 'Brave Browser', wingetId: 'Brave.Brave', description: 'Privacy-focused browser with ad-blocking', size: 0, isInstalled: false, isSelected: false },
      { id: 'opera', name: 'Opera', wingetId: 'Opera.Opera', description: 'Feature-rich browser with built-in VPN', size: 0, isInstalled: false, isSelected: false },
      { id: 'vivaldi', name: 'Vivaldi', wingetId: 'Vivaldi.Vivaldi', description: 'Highly customizable browser', size: 0, isInstalled: false, isSelected: false },
    ],
  },
  {
    id: 'media',
    name: 'Media Players',
    description: 'Music and video players for your media library',
    category: 'media',
    icon: '🎵',
    apps: [
      { id: 'vlc', name: 'VLC Media Player', wingetId: 'VideoLAN.VLC', description: 'Free, open-source multimedia player', size: 0, isInstalled: false, isSelected: false },
      { id: 'spotify', name: 'Spotify', wingetId: 'Spotify.Spotify', description: 'Music streaming service', size: 0, isInstalled: false, isSelected: false },
      { id: 'foobar2000', name: 'foobar2000', wingetId: 'foobar2000.foobar2000', description: 'Lightweight audio player', size: 0, isInstalled: false, isSelected: false },
      { id: 'mpc-hc', name: 'MPC-HC', wingetId: 'clsid2227a280-3aea-1069-a2de-08002b30309d', description: 'Media Player Classic - Home Cinema', size: 0, isInstalled: false, isSelected: false },
      { id: 'kodi', name: 'Kodi', wingetId: 'XBMCFoundation.Kodi', description: 'Media center and entertainment hub', size: 0, isInstalled: false, isSelected: false },
      { id: 'handbrake', name: 'HandBrake', wingetId: 'HandBrake.HandBrake', description: 'Video transcoder', size: 0, isInstalled: false, isSelected: false },
    ],
  },
  {
    id: 'devtools',
    name: 'Development Tools',
    description: 'Essential tools for developers',
    category: 'devtools',
    icon: '💻',
    apps: [
      { id: 'vscode', name: 'Visual Studio Code', wingetId: 'Microsoft.VisualStudioCode', description: 'Popular code editor by Microsoft', size: 0, isInstalled: false, isSelected: false },
      { id: 'git', name: 'Git', wingetId: 'Git.Git', description: 'Distributed version control system', size: 0, isInstalled: false, isSelected: false },
      { id: 'nodejs', name: 'Node.js', wingetId: 'OpenJS.NodeJS', description: 'JavaScript runtime built on Chrome V8', size: 0, isInstalled: false, isSelected: false },
      { id: 'python', name: 'Python', wingetId: 'Python.Python.3.12', description: 'Popular programming language', size: 0, isInstalled: false, isSelected: false },
      { id: 'docker', name: 'Docker Desktop', wingetId: 'Docker.DockerDesktop', description: 'Containerization platform', size: 0, isInstalled: false, isSelected: false },
      { id: 'postman', name: 'Postman', wingetId: 'Postman.Postman', description: 'API development and testing tool', size: 0, isInstalled: false, isSelected: false },
      { id: 'sublime', name: 'Sublime Text', wingetId: 'SublimeHQ.SublimeText.4', description: 'Sophisticated text editor', size: 0, isInstalled: false, isSelected: false },
      { id: 'notepadpp', name: 'Notepad++', wingetId: 'Notepad++.Notepad++', description: 'Free source code editor', size: 0, isInstalled: false, isSelected: false },
    ],
  },
  {
    id: 'utilities',
    name: 'System Utilities',
    description: 'Handy utilities for everyday tasks',
    category: 'utilities',
    icon: '🔧',
    apps: [
      { id: '7zip', name: '7-Zip', wingetId: '7zip.7zip', description: 'File archiver with high compression ratio', size: 0, isInstalled: false, isSelected: false },
      { id: 'winrar', name: 'WinRAR', wingetId: 'RARLab.WinRAR', description: 'Archive manager for Windows', size: 0, isInstalled: false, isSelected: false },
      { id: 'ccleaner', name: 'CCleaner', wingetId: 'Piriform.CCleaner', description: 'System optimization and cleaning tool', size: 0, isInstalled: false, isSelected: false },
      { id: 'recuva', name: 'Recuva', wingetId: 'Piriform.Recuva', description: 'File recovery tool', size: 0, isInstalled: false, isSelected: false },
      { id: 'everything', name: 'Everything', wingetId: 'voidtools.Everything', description: 'Fast file search utility', size: 0, isInstalled: false, isSelected: false },
      { id: 'sharex', name: 'ShareX', wingetId: 'ShareX.ShareX', description: 'Screen capture and file sharing tool', size: 0, isInstalled: false, isSelected: false },
      { id: 'obs', name: 'OBS Studio', wingetId: 'OBSProject.OBSStudio', description: 'Free, open-source streaming and recording software', size: 0, isInstalled: false, isSelected: false },
      { id: 'gimp', name: 'GIMP', wingetId: 'GIMP.GIMP', description: 'Free, open-source image editor', size: 0, isInstalled: false, isSelected: false },
    ],
  },
  {
    id: 'games',
    name: 'Gaming',
    description: 'Game launchers and gaming utilities',
    category: 'games',
    icon: '🎮',
    apps: [
      { id: 'steam', name: 'Steam', wingetId: 'Valve.Steam', description: 'Popular gaming platform', size: 0, isInstalled: false, isSelected: false },
      { id: 'epic', name: 'Epic Games Launcher', wingetId: 'EpicGames.EpicGamesLauncher', description: 'Epic Games store and launcher', size: 0, isInstalled: false, isSelected: false },
      { id: 'discord', name: 'Discord', wingetId: 'Discord.Discord', description: 'Voice, video, and text communication', size: 0, isInstalled: false, isSelected: false },
      { id: 'geforce', name: 'NVIDIA GeForce Experience', wingetId: 'Nvidia.GeForceExperience', description: 'NVIDIA driver updates and game optimization', size: 0, isInstalled: false, isSelected: false },
      { id: 'obs-gaming', name: 'OBS Studio', wingetId: 'OBSProject.OBSStudio', description: 'Game streaming and recording', size: 0, isInstalled: false, isSelected: false },
    ],
  },
];

export function getAppBundles(): AppBundle[] {
  return APP_BUNDLES;
}

// ===== P0.2: winget exit-code handling + package id validation =====

/**
 * winget package ids are dot-separated identifiers (e.g. `Google.Chrome`,
 * `7zip.7zip`, GUID-like ids such as `clsid2227a280-...`). Anything outside
 * this grammar is rejected BEFORE the id is interpolated into a PowerShell
 * script, which closes the command-injection gap.
 */
const WINGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

function invalidIdResult(action: 'install' | 'uninstall'): { success: false; message: string } {
  return { success: false, message: `Invalid package id: refusing to ${action}` };
}

/**
 * winget reports failures via exit code and stderr, NOT via exceptions, so a
 * surrounding `try/catch` can never see them. The script captures the output
 * and derives the verdict from `$LASTEXITCODE` (plus winget's "already
 * installed" case, which exits non-zero on some versions).
 */
function wingetScript(action: 'install' | 'uninstall', wingetId: string): string {
  const flags =
    action === 'install'
      ? 'install --id ' + wingetId + ' --silent --accept-package-agreements --accept-source-agreements'
      : 'uninstall --id ' + wingetId + ' --silent';
  return `
    $out = winget ${flags} 2>&1 | Out-String;
    if ($LASTEXITCODE -eq 0 -or $out -match 'already installed') {
      Write-Output 'SUCCESS'
    } else {
      Write-Output "FAILED: winget exit code $LASTEXITCODE"
      Write-Output $out
    }
  `;
}

function failureMessage(action: 'install' | 'uninstall', wingetId: string, result: { stdout: string; stderr: string }): string {
  const combined = `${result.stdout}\n${result.stderr}`;
  const marker = combined.indexOf('FAILED:');
  const detail = (marker >= 0 ? combined.slice(marker) : combined).trim();
  return `Failed to ${action} ${wingetId}${detail ? `: ${detail}` : ''}`;
}

export async function checkInstalledApps(): Promise<Map<string, boolean>> {
  const installed = new Map<string, boolean>();

  const result = await runPowerShell(`
    $apps = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue;
    $names = $apps | ForEach-Object { $_.DisplayName } | Where-Object { $_ };
    $names | ConvertTo-Json -Compress
  `);

  if (result.success && result.stdout) {
    try {
      const installedNames: string[] = JSON.parse(result.stdout);
      for (const bundle of APP_BUNDLES) {
        for (const app of bundle.apps) {
          const isInstalled = installedNames.some((name) =>
            name.toLowerCase().includes(app.name.toLowerCase())
          );
          installed.set(app.id, isInstalled);
        }
      }
    } catch { /* ignore */ }
  }

  return installed;
}

export async function installApp(wingetId: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (!WINGET_ID_PATTERN.test(wingetId)) {
    return invalidIdResult('install');
  }

  const result = await runPowerShell(wingetScript('install', wingetId));
  const success = result.success && result.stdout.includes('SUCCESS');

  return {
    success,
    message: success
      ? `Successfully installed ${wingetId}`
      : failureMessage('install', wingetId, result),
  };
}

export async function installApps(wingetIds: string[]): Promise<{
  success: boolean;
  message: string;
  installed: number;
  failed: number;
}> {
  let installed = 0;
  let failed = 0;

  for (const id of wingetIds) {
    const result = await installApp(id);
    if (result.success) installed++;
    else failed++;
  }

  return {
    success: failed === 0,
    message: `Installed ${installed} apps, ${failed} failed`,
    installed,
    failed,
  };
}

export async function uninstallApp(wingetId: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (!WINGET_ID_PATTERN.test(wingetId)) {
    return invalidIdResult('uninstall');
  }

  const result = await runPowerShell(wingetScript('uninstall', wingetId));
  const success = result.success && result.stdout.includes('SUCCESS');

  return {
    success,
    message: success
      ? `Successfully uninstalled ${wingetId}`
      : failureMessage('uninstall', wingetId, result),
  };
}
