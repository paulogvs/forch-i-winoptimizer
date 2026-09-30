export interface SystemService {
  id: string;
  name: string;
  displayName: string;
  description: string;
  status: 'running' | 'stopped' | 'paused';
  startType: 'automatic' | 'manual' | 'disabled';
  canOptimize: boolean;
  recommendedAction: 'keep' | 'disable' | 'manual';
}

export function getSystemServices(): SystemService[] {
  // TODO: Use PowerShell Get-Service to get real services
  return [
    {
      id: '1',
      name: 'WSearch',
      displayName: 'Windows Search',
      description: 'Provides content indexing and search functionality',
      status: 'running',
      startType: 'automatic',
      canOptimize: true,
      recommendedAction: 'manual',
    },
    {
      id: '2',
      name: 'SysMain',
      displayName: 'SysMain',
      description: 'Maintains and improves system performance over time',
      status: 'running',
      startType: 'automatic',
      canOptimize: true,
      recommendedAction: 'disable',
    },
    {
      id: '3',
      name: 'DiagTrack',
      displayName: 'Connected User Experiences and Telemetry',
      description: 'Collects and sends telemetry data to Microsoft',
      status: 'running',
      startType: 'automatic',
      canOptimize: true,
      recommendedAction: 'disable',
    },
  ];
}
