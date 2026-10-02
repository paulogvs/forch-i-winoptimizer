import { runPowerShell, parsePowerShellJson, toArray } from './powershell';

export interface InstalledApp {
  id: string;
  name: string;
  version: string;
  publisher: string;
  installDate: Date;
  size: number;
  installLocation: string;
  uninstallString: string;
  protection: 'safe' | 'caution' | 'protected';
  category: string;
}

interface RegistryApp {
  Name: string;
  DisplayVersion: string;
  Publisher: string;
  InstallDate: string;
  EstimatedSize: number;
  InstallLocation: string;
  UninstallString: string;
}

const PROTECTED_APPS = [
  'Microsoft.WindowsStore',
  'Microsoft.WindowsTerminal',
  'Microsoft.DesktopAppInstaller',
  'Microsoft.Windows.Photos',
  'Microsoft.WindowsCalculator',
  'Microsoft.WindowsNotepad',
  'Microsoft.WindowsSoundRecorder',
  'Microsoft.WindowsCamera',
  'Microsoft.WindowsAlarms',
  'Microsoft.WindowsMaps',
  'Microsoft.WindowsFeedbackHub',
  'Microsoft.WindowsCommunicationsApps',
  'Microsoft.ZuneMusic',
  'Microsoft.ZuneVideo',
  'Microsoft.BingWeather',
  'Microsoft.YourPhone',
  'MicrosoftTeams',
  'MicrosoftTeamsMeetingPlugin',
  'MicrosoftCorporationII.QuickAssist',
  'Microsoft.XboxGameOverlay',
  'Microsoft.XboxGamingOverlay',
  'Microsoft.Xbox.TCUI',
  'Microsoft.XboxSpeechToTextOverlay',
  'Microsoft.XboxIdentityProvider',
  'Microsoft.XboxApp',
  'Microsoft.GamingApp',
  'Microsoft.Windows.Ai.Copilot.Provider',
  'Microsoft.Windows.Copilot',
  'Microsoft.Windows.ShellExperienceHost',
  'Microsoft.Windows.StartMenuExperienceHost',
  'Microsoft.Windows.Search',
  'Microsoft.Windows.SecHealthUI',
  'Microsoft.Windows.SecureAssessmentBrowser',
  'Microsoft.Windows.PeopleExperienceHost',
  'Microsoft.Windows.PinningConfirmationDialog',
  'Microsoft.Windows.ParentalControls',
  'Microsoft.Windows.OOBENetworkCaptivePortal',
  'Microsoft.Windows.OOBENetworkConnectionFlow',
  'Microsoft.Windows.NarratorQuickStart',
  'Microsoft.Windows.MediaPlayer',
  'Microsoft.Windows.LockApp',
  'Microsoft.Windows.CallingShellApp',
  'Microsoft.Windows.AssignedAccessLockApp',
  'Microsoft.Windows.CapturePicker',
  'Microsoft.Windows.CloudExperienceHost',
  'Microsoft.Windows.ContentDeliveryManager',
  'Microsoft.Windows.PrintQueueActionCenter',
  'Microsoft.Windows.PrintDialog',
  'Microsoft.Windows.Photos',
  'Microsoft.Windows.CloudStore',
  'Microsoft.Windows.Cortana',
  'Microsoft.Windows.BioEnrollment',
  'Microsoft.Windows.AssignedAccessManager',
  'Microsoft.Windows.AsyncTextService',
];

export async function getInstalledApps(): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];

  try {
    // Scan HKLM (64-bit)
    const hklmResult = await runPowerShell(`
    $paths = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    );
    $apps = @();
    foreach ($path in $paths) {
      $items = Get-ItemProperty $path -ErrorAction SilentlyContinue;
      foreach ($item in $items) {
        if ($item.DisplayName -and $item.UninstallString) {
          $apps += @{
            Name = $item.DisplayName;
            DisplayVersion = $item.DisplayVersion;
            Publisher = $item.Publisher;
            InstallDate = $item.InstallDate;
            EstimatedSize = $item.EstimatedSize;
            InstallLocation = $item.InstallLocation;
            UninstallString = $item.UninstallString
          }
        }
      }
    };
    $apps | ConvertTo-Json -Compress
  `);

  if (hklmResult.success && hklmResult.stdout) {
    const parsed = parsePowerShellJson<RegistryApp[]>(hklmResult.stdout);
    if (parsed) {
      for (const app of toArray(parsed)) {
        if (!app.Name) continue;

        const isProtected = PROTECTED_APPS.some(p => app.Name.includes(p));
        const isCaution = app.Publisher?.includes('Microsoft') && !isProtected;

        apps.push({
          id: `hklm-${app.Name}`,
          name: app.Name,
          version: app.DisplayVersion ?? 'Unknown',
          publisher: app.Publisher ?? 'Unknown',
          installDate: app.InstallDate ? new Date(app.InstallDate) : new Date(),
          size: app.EstimatedSize ? app.EstimatedSize * 1024 : 0,
          installLocation: app.InstallLocation ?? '',
          uninstallString: app.UninstallString ?? '',
          protection: isProtected ? 'protected' : isCaution ? 'caution' : 'safe',
          category: 'win32',
        });
      }
    }
  }

  // Scan HKCU (user apps)
  const hkcuResult = await runPowerShell(`
    $path = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';
    $items = Get-ItemProperty $path -ErrorAction SilentlyContinue;
    $apps = @();
    foreach ($item in $items) {
      if ($item.DisplayName -and $item.UninstallString) {
        $apps += @{
          Name = $item.DisplayName;
          DisplayVersion = $item.DisplayVersion;
          Publisher = $item.Publisher;
          InstallDate = $item.InstallDate;
          EstimatedSize = $item.EstimatedSize;
          InstallLocation = $item.InstallLocation;
          UninstallString = $item.UninstallString
        }
      }
    };
    $apps | ConvertTo-Json -Compress
  `);

  if (hkcuResult.success && hkcuResult.stdout) {
    const parsed = parsePowerShellJson<RegistryApp[]>(hkcuResult.stdout);
    if (parsed) {
      for (const app of toArray(parsed)) {
        if (!app.Name) continue;

        const isProtected = PROTECTED_APPS.some(p => app.Name.includes(p));
        const isCaution = app.Publisher?.includes('Microsoft') && !isProtected;

        apps.push({
          id: `hkcu-${app.Name}`,
          name: app.Name,
          version: app.DisplayVersion ?? 'Unknown',
          publisher: app.Publisher ?? 'Unknown',
          installDate: app.InstallDate ? new Date(app.InstallDate) : new Date(),
          size: app.EstimatedSize ? app.EstimatedSize * 1024 : 0,
          installLocation: app.InstallLocation ?? '',
          uninstallString: app.UninstallString ?? '',
          protection: isProtected ? 'protected' : isCaution ? 'caution' : 'safe',
          category: 'win32',
        });
      }
    }
  }

  // Scan UWP apps
  const uwpResult = await runPowerShell(`
    $apps = Get-AppxPackage | Where-Object { $_.Name -notlike 'Microsoft.Windows*' -and $_.Name -notlike 'Microsoft.NET*' -and $_.Name -notlike 'Microsoft.VCLibs*' -and $_.Name -notlike 'Microsoft.UI*' -and $_.Name -notlike 'Microsoft.WindowsAppRuntime*' -and $_.Name -notlike 'Microsoft.DesktopAppInstaller*' -and $_.Name -notlike 'Microsoft.WindowsTerminal*' -and $_.Name -notlike 'Microsoft.WindowsStore*' -and $_.Name -notlike 'Microsoft.Windows.Photos*' -and $_.Name -notlike 'Microsoft.WindowsCalculator*' -and $_.Name -notlike 'Microsoft.WindowsNotepad*' -and $_.Name -notlike 'Microsoft.WindowsSoundRecorder*' -and $_.Name -notlike 'Microsoft.WindowsCamera*' -and $_.Name -notlike 'Microsoft.WindowsAlarms*' -and $_.Name -notlike 'Microsoft.WindowsMaps*' -and $_.Name -notlike 'Microsoft.WindowsFeedbackHub*' -and $_.Name -notlike 'Microsoft.WindowsCommunicationsApps*' -and $_.Name -notlike 'Microsoft.ZuneMusic*' -and $_.Name -notlike 'Microsoft.ZuneVideo*' -and $_.Name -notlike 'Microsoft.BingWeather*' -and $_.Name -notlike 'Microsoft.YourPhone*' -and $_.Name -notlike 'MicrosoftTeams*' -and $_.Name -notlike 'MicrosoftCorporationII.QuickAssist*' -and $_.Name -notlike 'Microsoft.XboxGameOverlay*' -and $_.Name -notlike 'Microsoft.XboxGamingOverlay*' -and $_.Name -notlike 'Microsoft.Xbox.TCUI*' -and $_.Name -notlike 'Microsoft.XboxSpeechToTextOverlay*' -and $_.Name -notlike 'Microsoft.XboxIdentityProvider*' -and $_.Name -notlike 'Microsoft.XboxApp*' -and $_.Name -notlike 'Microsoft.GamingApp*' -and $_.Name -notlike 'Microsoft.Windows.Ai.Copilot.Provider*' -and $_.Name -notlike 'Microsoft.Windows.Copilot*' -and $_.Name -notlike 'Microsoft.Windows.ShellExperienceHost*' -and $_.Name -notlike 'Microsoft.Windows.StartMenuExperienceHost*' -and $_.Name -notlike 'Microsoft.Windows.Search*' -and $_.Name -notlike 'Microsoft.Windows.SecHealthUI*' -and $_.Name -notlike 'Microsoft.Windows.SecureAssessmentBrowser*' -and $_.Name -notlike 'Microsoft.Windows.PeopleExperienceHost*' -and $_.Name -notlike 'Microsoft.Windows.PinningConfirmationDialog*' -and $_.Name -notlike 'Microsoft.Windows.ParentalControls*' -and $_.Name -notlike 'Microsoft.Windows.OOBENetworkCaptivePortal*' -and $_.Name -notlike 'Microsoft.Windows.OOBENetworkConnectionFlow*' -and $_.Name -notlike 'Microsoft.Windows.NarratorQuickStart*' -and $_.Name -notlike 'Microsoft.Windows.MediaPlayer*' -and $_.Name -notlike 'Microsoft.Windows.LockApp*' -and $_.Name -notlike 'Microsoft.Windows.CallingShellApp*' -and $_.Name -notlike 'Microsoft.Windows.AssignedAccessLockApp*' -and $_.Name -notlike 'Microsoft.Windows.CapturePicker*' -and $_.Name -notlike 'Microsoft.Windows.CloudExperienceHost*' -and $_.Name -notlike 'Microsoft.Windows.ContentDeliveryManager*' -and $_.Name -notlike 'Microsoft.Windows.PrintQueueActionCenter*' -and $_.Name -notlike 'Microsoft.Windows.PrintDialog*' -and $_.Name -notlike 'Microsoft.Windows.Photos*' -and $_.Name -notlike 'Microsoft.Windows.CloudStore*' -and $_.Name -notlike 'Microsoft.Windows.Cortana*' -and $_.Name -notlike 'Microsoft.Windows.BioEnrollment*' -and $_.Name -notlike 'Microsoft.Windows.AssignedAccessManager*' -and $_.Name -notlike 'Microsoft.Windows.AsyncTextService*' };
    $result = @();
    foreach ($app in $apps) {
      $result += @{
        Name = $app.Name;
        PackageFullName = $app.PackageFullName;
        Version = $app.Version;
        Publisher = $app.Publisher;
        InstallLocation = $app.InstallLocation;
        UninstallString = $app.PackageFullName
      }
    };
    $result | ConvertTo-Json -Compress
  `);

  if (uwpResult.success && uwpResult.stdout) {
    const parsed = parsePowerShellJson<Array<{
      Name: string;
      PackageFullName: string;
      Version: string;
      Publisher: string;
      InstallLocation: string;
      UninstallString: string;
    }>>(uwpResult.stdout);

    if (parsed) {
      for (const app of toArray(parsed)) {
        if (!app.Name) continue;

        apps.push({
          id: `uwp-${app.Name}`,
          name: app.Name,
          version: app.Version ?? 'Unknown',
          publisher: app.Publisher ?? 'Unknown',
          installDate: new Date(),
          size: 0,
          installLocation: app.InstallLocation ?? '',
          uninstallString: app.UninstallString ?? '',
          protection: 'caution',
          category: 'uwp',
        });
      }
    }
  }

  return apps;
  } catch {
    return apps;
  }
}

/**
 * Uninstall-string hardening (P1.4).
 *
 * The renderer controls `uninstallString`, so it must never reach a
 * PowerShell command line unvalidated: paths are accepted only when they are
 * absolute, end in `.exe` and contain no shell metacharacters (`" $ ` ; | &`
 * etc.); MSI strings must be exactly `MsiExec /x {GUID}`. Anything else is
 * refused without spawning PowerShell. Trailing arguments (e.g. `/S`) are
 * dropped — removal runs the validated exe with the standard silent flag.
 */
const MSI_UNINSTALL = /^MsiExec(?:\.exe)?\s*\/[xX]\s*\{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}\s*$/i;
const EXE_UNINSTALL = /^([A-Za-z]:\\[^<>|*?"`$;()&]+?\.exe)(?:\s+.*)?$/i;

/** True when the string contains C0 control characters (U+0000–U+001F). */
function hasControlChars(value: string): boolean {
  // Checked via char codes because `no-control-regex` forbids control
  // characters inside patterns; the behaviour is identical.
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

interface UninstallTarget {
  command: string;
}

/** Parse + validate an uninstall string. Returns null when it must be refused. */
export function parseUninstallString(uninstallString: string): UninstallTarget | null {
  const raw = uninstallString.trim();

  // Control characters are refused before any regex sees the string: they
  // could smuggle shell input past the pattern validators above.
  if (hasControlChars(raw)) return null;

  const msi = MSI_UNINSTALL.exec(raw);
  if (msi) {
    const guid = msi[1]!;
    return {
      command: `Start-Process -FilePath "msiexec.exe" -ArgumentList "/x {${guid}} /qn /norestart" -Wait -PassThru`,
    };
  }

  const exe = EXE_UNINSTALL.exec(raw);
  if (exe) {
    const filePath = exe[1]!;
    return {
      command: `Start-Process -FilePath "${filePath}" -ArgumentList "/S" -Wait -PassThru`,
    };
  }

  return null;
}

export async function uninstallApp(_appId: string, uninstallString: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const target = parseUninstallString(uninstallString);
    if (!target) {
      return {
        success: false,
        message: 'Unsupported uninstall string',
      };
    }

    const result = await runPowerShell(target.command);
    return {
      success: result.success,
      message: result.success ? 'App uninstalled successfully' : 'Failed to uninstall app',
    };
  } catch {
    return {
      success: false,
      message: 'Failed to uninstall app',
    };
  }
}
