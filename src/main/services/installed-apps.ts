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

interface UwpApp {
  Name: string;
  PackageFullName: string;
  Version: string;
  Publisher: string;
  InstallLocation: string;
  UninstallString: string;
}

/** Combined payload of the single enumeration spawn (Fase 1.3). */
interface InstalledAppsPayload {
  Hklm?: RegistryApp[];
  Hkcu?: RegistryApp[];
  Uwp?: UwpApp[];
}

/** Shared registry-row mapping (HKLM and HKCU differ only in id prefix). */
function pushRegistryApp(apps: InstalledApp[], app: RegistryApp, prefix: 'hklm' | 'hkcu'): void {
  if (!app.Name) return;

  const isProtected = PROTECTED_APPS.some((p) => app.Name.includes(p));
  const isCaution = app.Publisher?.includes('Microsoft') && !isProtected;

  apps.push({
    id: `${prefix}-${app.Name}`,
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
    // Fase 1.3: HKLM + HKCU + UWP in ONE PowerShell process (was 3 serial
    // spawns — pattern borrowed from `startup-apps.ts`). The three sections
    // run the exact same queries as before; only the transport changed, so
    // parsing below is unchanged in behaviour.
    const result = await runPowerShell(`
    $hklmPaths = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    );
    $hklm = @();
    foreach ($path in $hklmPaths) {
      $items = Get-ItemProperty $path -ErrorAction SilentlyContinue;
      foreach ($item in $items) {
        if ($item.DisplayName -and $item.UninstallString) {
          $hklm += @{
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
    $hkcuPath = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';
    $hkcuItems = Get-ItemProperty $hkcuPath -ErrorAction SilentlyContinue;
    $hkcu = @();
    foreach ($item in $hkcuItems) {
      if ($item.DisplayName -and $item.UninstallString) {
        $hkcu += @{
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
    $uwpBlock = @(
      'Microsoft.Windows*', 'Microsoft.NET*', 'Microsoft.VCLibs*', 'Microsoft.UI*', 'Microsoft.WindowsAppRuntime*', 'Microsoft.DesktopAppInstaller*',
      'Microsoft.WindowsTerminal*', 'Microsoft.WindowsStore*', 'Microsoft.Windows.Photos*', 'Microsoft.WindowsCalculator*', 'Microsoft.WindowsNotepad*', 'Microsoft.WindowsSoundRecorder*',
      'Microsoft.WindowsCamera*', 'Microsoft.WindowsAlarms*', 'Microsoft.WindowsMaps*', 'Microsoft.WindowsFeedbackHub*', 'Microsoft.WindowsCommunicationsApps*', 'Microsoft.ZuneMusic*',
      'Microsoft.ZuneVideo*', 'Microsoft.BingWeather*', 'Microsoft.YourPhone*', 'MicrosoftTeams*', 'MicrosoftCorporationII.QuickAssist*', 'Microsoft.XboxGameOverlay*',
      'Microsoft.XboxGamingOverlay*', 'Microsoft.Xbox.TCUI*', 'Microsoft.XboxSpeechToTextOverlay*', 'Microsoft.XboxIdentityProvider*', 'Microsoft.XboxApp*', 'Microsoft.GamingApp*',
      'Microsoft.Windows.Ai.Copilot.Provider*', 'Microsoft.Windows.Copilot*', 'Microsoft.Windows.ShellExperienceHost*', 'Microsoft.Windows.StartMenuExperienceHost*', 'Microsoft.Windows.Search*', 'Microsoft.Windows.SecHealthUI*',
      'Microsoft.Windows.SecureAssessmentBrowser*', 'Microsoft.Windows.PeopleExperienceHost*', 'Microsoft.Windows.PinningConfirmationDialog*', 'Microsoft.Windows.ParentalControls*', 'Microsoft.Windows.OOBENetworkCaptivePortal*', 'Microsoft.Windows.OOBENetworkConnectionFlow*',
      'Microsoft.Windows.NarratorQuickStart*', 'Microsoft.Windows.MediaPlayer*', 'Microsoft.Windows.LockApp*', 'Microsoft.Windows.CallingShellApp*', 'Microsoft.Windows.AssignedAccessLockApp*', 'Microsoft.Windows.CapturePicker*',
      'Microsoft.Windows.CloudExperienceHost*', 'Microsoft.Windows.ContentDeliveryManager*', 'Microsoft.Windows.PrintQueueActionCenter*', 'Microsoft.Windows.PrintDialog*', 'Microsoft.Windows.Photos*', 'Microsoft.Windows.CloudStore*',
      'Microsoft.Windows.Cortana*', 'Microsoft.Windows.BioEnrollment*', 'Microsoft.Windows.AssignedAccessManager*', 'Microsoft.Windows.AsyncTextService*'
    );
    $uwpPkgs = Get-AppxPackage | Where-Object { $pkgName = $_.Name; $blocked = $false; foreach ($b in $uwpBlock) { if ($pkgName -like $b) { $blocked = $true; break } }; -not $blocked };
    $uwp = @();
    foreach ($app in $uwpPkgs) {
      $uwp += @{
        Name = $app.Name;
        PackageFullName = $app.PackageFullName;
        Version = $app.Version;
        Publisher = $app.Publisher;
        InstallLocation = $app.InstallLocation;
        UninstallString = $app.PackageFullName
      }
    };
    @{ Hklm = @($hklm); Hkcu = @($hkcu); Uwp = @($uwp) } | ConvertTo-Json -Depth 4 -Compress
  `);

    if (!result.success || !result.stdout) return apps;
    const parsed = parsePowerShellJson<InstalledAppsPayload>(result.stdout);
    if (!parsed) return apps;

    for (const app of toArray(parsed.Hklm)) pushRegistryApp(apps, app, 'hklm');
    for (const app of toArray(parsed.Hkcu)) pushRegistryApp(apps, app, 'hkcu');

    for (const app of toArray(parsed.Uwp)) {
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

    return apps;
  } catch {
    return apps;
  }
}

/**
 * Uninstall-string hardening (P1.4, extended in v0.10.1).
 *
 * The renderer controls `uninstallString`, so it must never reach a
 * PowerShell command line unvalidated. Two accepted shapes:
 *
 *   - MSI: `MsiExec.exe /x {GUID}` (optionally `/X{GUID}`).
 *   - EXE: an absolute `X:\...\name.exe` path, optionally double-quoted and
 *     optionally followed by arguments, e.g.
 *     `"C:\Program Files (x86)\App\Uninstall.exe" /currentuser /D="C:\Data"`.
 *
 * Windows registers roughly one in five UninstallStrings in the quoted form,
 * so the previous "must start with `X:\`" pattern rejected ~20% of real
 * apps with "Unsupported uninstall string". Quotes are now accepted, but only
 * the executable path is extracted and validated; trailing arguments are
 * parsed off and discarded — removal always runs the exe with the standard
 * silent flag. The path is interpolated into a double-quoted PowerShell
 * argument, so it must contain no `"`, backtick, `$` (PowerShell string
 * escapes) nor shell separators (`; | & > < * ?`). Parentheses are allowed:
 * they are literal inside a quoted string and ubiquitous in
 * `Program Files (x86)`.
 */
const MSI_UNINSTALL =
  /^MsiExec(?:\.exe)?\s*\/[xX]\s*\{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}\s*$/i;

/** An absolute, quote-free `.exe` path with no forbidden shell characters. */
const EXE_PATH = /^[A-Za-z]:\\[^"`$;|&<>*?]+?\.exe$/i;

/** An unquoted `.exe` path optionally followed by (discarded) arguments. */
const EXE_UNINSTALL = /^([A-Za-z]:\\[^"`$;|&<>*?]+?\.exe)(?:\s+[\s\S]*)?$/i;

/**
 * Extract the validated executable path from an uninstall string, or `null`
 * when it cannot be trusted. Accepts both the quoted and unquoted forms and
 * separates the path from its arguments.
 */
function extractExePath(raw: string): string | null {
  if (raw.startsWith('"')) {
    const end = raw.indexOf('"', 1);
    if (end < 0) return null; // unclosed quote
    const candidate = raw.slice(1, end);
    const rest = raw.slice(end + 1);
    // Anything after the closing quote must be whitespace-separated arguments.
    if (rest !== '' && !/^\s/.test(rest)) return null;
    return EXE_PATH.test(candidate) ? candidate : null;
  }
  const match = EXE_UNINSTALL.exec(raw);
  return match ? match[1]! : null;
}

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

  const filePath = extractExePath(raw);
  if (filePath) {
    return {
      command: `Start-Process -FilePath "${filePath}" -ArgumentList "/S" -Wait -PassThru`,
    };
  }

  return null;
}

export async function uninstallApp(
  _appId: string,
  uninstallString: string
): Promise<{
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

    // Start-Process -PassThru returns the process; its exit code is the real
    // verdict. 3010 is MSI's "success, reboot required".
    const result = await runPowerShell(`
      $ErrorActionPreference = 'Stop';
      try {
        $p = ${target.command};
        $p.WaitForExit();
        $code = $p.ExitCode;
        if ($code -eq 0 -or $code -eq 3010) { Write-Output "UNINSTALL_OK:$code" }
        else { Write-Output "UNINSTALL_FAILED:$code" }
      } catch {
        Write-Output ("FAILED: " + $_.Exception.Message)
      }
    `);

    const output = result.stdout.trim();
    const success = result.success && output.startsWith('UNINSTALL_OK');
    return {
      success,
      message: success
        ? 'App uninstalled successfully'
        : `Failed to uninstall app: ${output || result.stderr || 'unknown error'}`,
    };
  } catch {
    return {
      success: false,
      message: 'Failed to uninstall app',
    };
  }
}
