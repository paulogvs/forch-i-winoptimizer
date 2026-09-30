export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  downloadUrl: string;
  publishedAt: Date;
  size: number;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  // TODO: Fetch from GitHub releases API
  const currentVersion = '0.1.0';
  const latestVersion = '0.1.0';

  return {
    currentVersion,
    latestVersion,
    updateAvailable: false,
    releaseNotes: '',
    downloadUrl: '',
    publishedAt: new Date(),
    size: 0,
  };
}
