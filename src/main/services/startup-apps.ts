import { runPowerShell, parsePowerShellJson } from './powershell';

export interface StartupApp {
  id: string;
  name: string;
  path: string;
  publisher: string;
  enabled: boolean;
  impact: 'low' | 'medium' | 'high';
  description: string;
}

interface RegistryStartupItem {
  Name: string;
  Command: string;
  Location: string;
}

export async function getStartupApps(): Promise<StartupApp[]> {
  const apps: StartupApp[] = [];

  // Get startup items from registry
  const result = await runPowerShell(`
    $items = @();
    
    # HKLM Run
    $hklmRun = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue;
    if ($hklmRun) {
      $hklmRun.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
        $items += @{
          Name = $_.Name;
          Command = $_.Value;
          Location = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
        }
      }
    }
    
    # HKCU Run
    $hkcuRun = Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue;
    if ($hkcuRun) {
      $hkcuRun.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
        $items += @{
          Name = $_.Name;
          Command = $_.Value;
          Location = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
        }
      }
    }
    
    # Startup folder
    $startupFolder = [Environment]::GetFolderPath('Startup');
    if (Test-Path $startupFolder) {
      $folderItems = Get-ChildItem -Path $startupFolder -Filter '*.lnk' -ErrorAction SilentlyContinue;
      foreach ($item in $folderItems) {
        $items += @{
          Name = $item.BaseName;
          Command = $item.FullName;
          Location = $startupFolder
        }
      }
    }
    
    $items | ConvertTo-Json -Compress
  `);

  if (result.success && result.stdout) {
    const parsed = parsePowerShellJson<RegistryStartupItem[]>(result.stdout);
    if (parsed) {
      for (const item of parsed) {
        if (!item.Name) continue;

        // Determine impact based on known high-impact apps
        const highImpactApps = ['Teams', 'OneDrive', 'Spotify', 'Discord', 'Steam', 'EpicGamesLauncher', 'Adobe', 'GoogleDrive', 'Dropbox', 'Skype', 'Zoom', 'Slack', 'Telegram', 'WhatsApp', 'iTunesHelper', 'JavaUpdateScheduler', 'AdobeReaderUpdate', 'CCXProcess', 'CreativeCloud', 'Spotify', 'Discord', 'Steam', 'EpicGamesLauncher', 'Battle.net', 'Origin', 'Uplay', 'GOG', 'NVIDIA', 'GeForceExperience', 'Razer', 'Corsair', 'Logitech', 'SteelSeries', 'MSIAfterburner', 'EVGA', 'ASUS', 'Gigabyte', 'Aorus', 'ArmouryCrate', 'iCUE', 'GHub', 'Synapse', 'Ngenuity', 'Omen', 'Alienware', 'CommandCenter', 'DragonCenter', 'Aura', 'Polychrome', 'RGBFusion', 'MysticLight', 'Chrome', 'Firefox', 'Edge', 'Brave', 'Opera', 'Vivaldi', 'Safari', 'Tor', 'CCleaner', 'Malwarebytes', 'Avast', 'AVG', 'Norton', 'McAfee', 'Kaspersky', 'Bitdefender', 'ESET', 'Sophos', 'TrendMicro', 'Webroot', 'Panda', 'F-Secure', 'GData', 'Avira', 'BullGuard', 'CheckPoint', 'Comodo', 'DrWeb', 'Ikarus', 'QuickHeal', 'TotalAV', 'Vipre', 'Webroot', 'WindowsDefender', 'SecurityHealth', 'Sense', 'WinDefend', 'WdNisSvc', 'WdNisDrv', 'WdFilter', 'WdDrv', 'WdBoot', 'WdFilter', 'WdDrv', 'WdBoot'];
        const mediumImpactApps = ['OneDrive', 'GoogleDrive', 'Dropbox', 'Teams', 'Slack', 'Zoom', 'Skype', 'Telegram', 'WhatsApp', 'Discord', 'Spotify', 'Steam', 'EpicGamesLauncher', 'Adobe', 'CreativeCloud', 'CCXProcess', 'iTunesHelper', 'JavaUpdateScheduler', 'AdobeReaderUpdate', 'NVIDIA', 'GeForceExperience', 'Razer', 'Corsair', 'Logitech', 'SteelSeries', 'MSIAfterburner', 'EVGA', 'ASUS', 'Gigabyte', 'Aorus', 'ArmouryCrate', 'iCUE', 'GHub', 'Synapse', 'Ngenuity', 'Omen', 'Alienware', 'CommandCenter', 'DragonCenter', 'Aura', 'Polychrome', 'RGBFusion', 'MysticLight', 'Chrome', 'Firefox', 'Edge', 'Brave', 'Opera', 'Vivaldi', 'Safari', 'Tor', 'CCleaner', 'Malwarebytes', 'Avast', 'AVG', 'Norton', 'McAfee', 'Kaspersky', 'Bitdefender', 'ESET', 'Sophos', 'TrendMicro', 'Webroot', 'Panda', 'F-Secure', 'GData', 'Avira', 'BullGuard', 'CheckPoint', 'Comodo', 'DrWeb', 'Ikarus', 'QuickHeal', 'TotalAV', 'Vipre', 'Webroot', 'WindowsDefender', 'SecurityHealth', 'Sense', 'WinDefend', 'WdNisSvc', 'WdNisDrv', 'WdFilter', 'WdDrv', 'WdBoot', 'WdFilter', 'WdDrv', 'WdBoot'];
        
        const isHighImpact = highImpactApps.some(app => item.Name.includes(app));
        const isMediumImpact = mediumImpactApps.some(app => item.Name.includes(app));
        
        apps.push({
          id: `startup-${item.Name}`,
          name: item.Name,
          path: item.Command,
          publisher: 'Unknown',
          enabled: true,
          impact: isHighImpact ? 'high' : isMediumImpact ? 'medium' : 'low',
          description: `Startup item from ${item.Location}`,
        });
      }
    }
  }

  // Also get startup impact from Task Manager
  const impactResult = await runPowerShell(`
    $startupApps = Get-CimInstance -ClassName Win32_StartupCommand -ErrorAction SilentlyContinue;
    $result = @();
    foreach ($app in $startupApps) {
      $result += @{
        Name = $app.Name;
        Command = $app.Command;
        Location = $app.Location;
        User = $app.User
      }
    };
    $result | ConvertTo-Json -Compress
  `);

  if (impactResult.success && impactResult.stdout) {
    const parsed = parsePowerShellJson<Array<{
      Name: string;
      Command: string;
      Location: string;
      User: string;
    }>>(impactResult.stdout);

    if (parsed) {
      for (const app of parsed) {
        if (!app.Name) continue;

        const existingApp = apps.find(a => a.name === app.Name);
        if (existingApp) {
          existingApp.path = app.Command || existingApp.path;
        } else {
          apps.push({
            id: `startup-${app.Name}`,
            name: app.Name,
            path: app.Command ?? '',
            publisher: 'Unknown',
            enabled: true,
            impact: 'low',
            description: `Startup item from ${app.Location}`,
          });
        }
      }
    }
  }

  return apps;
}

export async function toggleStartupApp(appId: string, enabled: boolean): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // Get the app details first
    const apps = await getStartupApps();
    const app = apps.find(a => a.id === appId);
    
    if (!app) {
      return { success: false, message: 'Startup app not found' };
    }

    if (enabled) {
      // Re-enable by adding back to registry
      const result = await runPowerShell(`
        $regPath = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
        Set-ItemProperty -Path $regPath -Name "${app.name}" -Value "${app.path.replace(/"/g, '\\"')}" -ErrorAction Stop;
        Write-Output "OK"
      `);
      return {
        success: result.success,
        message: result.success ? `Startup app ${app.name} enabled` : 'Failed to enable startup app',
      };
    } else {
      // Disable by removing from registry
      const result = await runPowerShell(`
        $regPath = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
        Remove-ItemProperty -Path $regPath -Name "${app.name}" -ErrorAction Stop;
        Write-Output "OK"
      `);
      return {
        success: result.success,
        message: result.success ? `Startup app ${app.name} disabled` : 'Failed to disable startup app',
      };
    }
  } catch {
    return {
      success: false,
      message: 'Failed to toggle startup app',
    };
  }
}
