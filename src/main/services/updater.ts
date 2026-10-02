import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: Date;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

const GITHUB_REPO = 'paulogvs/forch-i-winoptimizer';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion();

  try {
    const response = await fetch(GITHUB_API_URL, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'FORCH.iA-WinOptimizer-Updater',
      },
    });

    if (!response.ok) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        releaseNotes: '',
        downloadUrl: '',
        publishedAt: new Date(),
        size: 0,
      };
    }

    const release = (await response.json()) as GitHubRelease;

    // Compare versions (remove 'v' prefix if present)
    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersionClean = currentVersion.replace(/^v/, '');

    const updateAvailable = compareVersions(latestVersion, currentVersionClean) > 0;

    // Find the best asset for Windows
    const windowsAsset =
      release.assets.find((a) => a.name.endsWith('.exe') || a.name.endsWith('.msi')) ??
      release.assets[0];

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseNotes: release.body ?? '',
      downloadUrl: windowsAsset?.browser_download_url ?? '',
      publishedAt: release.published_at ? new Date(release.published_at) : new Date(),
      size: windowsAsset?.size ?? 0,
    };
  } catch {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseNotes: '',
      downloadUrl: '',
      publishedAt: new Date(),
      size: 0,
    };
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = b.split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

export async function downloadUpdate(
  url: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to read response body');
  }

  const userDataPath = app.getPath('userData');
  const downloadPath = path.join(userDataPath, 'updates');
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true });
  }

  const fileName = url.split('/').pop() ?? 'update.exe';
  const filePath = path.join(downloadPath, fileName);

  const fileStream = fs.createWriteStream(filePath);
  let receivedLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fileStream.write(value);
      receivedLength += value.length;

      if (contentLength > 0 && onProgress) {
        onProgress(Math.round((receivedLength / contentLength) * 100));
      }
    }
  } finally {
    fileStream.end();
  }

  return filePath;
}
