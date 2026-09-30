export interface StartupApp {
  id: string;
  name: string;
  path: string;
  publisher: string;
  enabled: boolean;
  impact: 'low' | 'medium' | 'high';
  description: string;
}

export function getStartupApps(): StartupApp[] {
  // TODO: Read from registry HKCU\Software\Microsoft\Windows\CurrentVersion\Run
  // and Task Manager startup items
  return [
    {
      id: '1',
      name: 'Discord',
      path: 'C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe',
      publisher: 'Discord Inc.',
      enabled: true,
      impact: 'medium',
      description: 'Voice and text chat app',
    },
    {
      id: '2',
      name: 'Spotify',
      path: 'C:\\Users\\User\\AppData\\Roaming\\Spotify\\Spotify.exe',
      publisher: 'Spotify AB',
      enabled: true,
      impact: 'high',
      description: 'Music streaming service',
    },
    {
      id: '3',
      name: 'OneDrive',
      path: 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe',
      publisher: 'Microsoft Corporation',
      enabled: false,
      impact: 'low',
      description: 'Cloud storage sync',
    },
  ];
}
