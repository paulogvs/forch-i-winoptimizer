export interface InstalledApp {
  id: string;
  name: string;
  version: string;
  publisher: string;
  installDate: Date;
  size: number;
  installLocation: string;
  uninstallString: string;
}

export function getInstalledApps(): InstalledApp[] {
  // TODO: Read from registry HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
  return [
    {
      id: '1',
      name: 'Google Chrome',
      version: '125.0.6422.142',
      publisher: 'Google LLC',
      installDate: new Date('2024-01-15'),
      size: 1024 * 1024 * 500,
      installLocation: 'C:\\Program Files\\Google\\Chrome\\Application',
      uninstallString: '"C:\\Program Files\\Google\\Chrome\\Application\\125.0.6422.142\\Installer\\setup.exe" --uninstall',
    },
    {
      id: '2',
      name: 'Visual Studio Code',
      version: '1.90.0',
      publisher: 'Microsoft Corporation',
      installDate: new Date('2024-03-20'),
      size: 1024 * 1024 * 350,
      installLocation: 'C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code',
      uninstallString: '"C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\unins000.exe"',
    },
  ];
}
