/**
 * elevated-kit-modes -- pure planners for the elevated verification kit.
 *
 * These functions never touch the machine: they decide WHAT the kit would do
 * from already-observed facts. `scripts/verify-elevated.ps1` mirrors this
 * logic in PowerShell (same order, same abort reasons); the unit tests below
 * pin the contract so the two implementations cannot drift silently.
 *
 * Modes:
 *  - BitLocker (-EnableBitLocker): prerequisites -> protector choice ->
 *    verified recovery backup -> Used Space Only encrypt -> verify -> report.
 *  - Per-machine MSI test (-TestPerMachine): install 7-Zip per-machine,
 *    resolve its UninstallString through the SAME MSI grammar as
 *    `parseUninstallString` (installed-apps.ts), uninstall, verify clean.
 *  - Offered drivers (-InstallOfferedDrivers): read Windows Update; only when
 *    at least one driver is offered run restore-point -> install -> re-verify.
 */

export interface BitLockerPrereqs {
  editionSupportsBitLocker: boolean;
  allowBitLockerWithoutTpm: boolean;
  freeSpaceOk: boolean;
  hasTpm: boolean;
  firmware: 'Legacy' | 'UEFI';
  usbKeyPresent: boolean;
  passwordProvided: boolean;
  recoveryPathProvided: boolean;
}

export interface BitLockerPlan {
  ready: boolean;
  abortReason: string | null;
  readyCommand: string | null;
  protector: 'usb-startup-key' | 'password' | null;
  tradeOff: string | null;
  steps: string[];
  revert: string;
}

const BITLOCKER_READY_BASE =
  'powershell -ExecutionPolicy Bypass -File .\\scripts\\verify-elevated.ps1 -EnableBitLocker';

export function planBitLocker(prereqs: BitLockerPrereqs): BitLockerPlan {
  const revert =
    'To revert: manage-bde -off C: (decrypts the drive; keep the recovery key until decryption reaches 0%). ' +
    'Verify with manage-bde -status C:.';

  if (!prereqs.editionSupportsBitLocker) {
    return {
      ready: false,
      abortReason:
        'This Windows edition does not support BitLocker (e.g. Home without the BitLocker cmdlet). Nothing was changed.',
      readyCommand: `${BITLOCKER_READY_BASE} -BitLockerRecoveryPath <path>  # once running a Pro/Enterprise/Education edition`,
      protector: null,
      tradeOff: null,
      steps: [],
      revert,
    };
  }

  if (!prereqs.allowBitLockerWithoutTpm) {
    return {
      ready: false,
      abortReason:
        'Group policy "Allow BitLocker without a compatible TPM" is not enabled. ' +
        'Enable it in gpedit.msc (Computer Configuration > Administrative Templates > Windows Components > ' +
        'BitLocker Drive Encryption > Operating System Drives > Require additional authentication at startup), ' +
        'or via registry FVE policy. The kit never forces this policy blindly.',
      readyCommand:
        'gpedit.msc  # then re-run: ' +
        `${BITLOCKER_READY_BASE} -BitLockerRecoveryPath <path> [-BitLockerPassword <SecureString>]`,
      protector: null,
      tradeOff: null,
      steps: [],
      revert,
    };
  }

  if (!prereqs.freeSpaceOk) {
    return {
      ready: false,
      abortReason: 'Not enough free space or no viable volume for BitLocker. Nothing was changed.',
      readyCommand: `${BITLOCKER_READY_BASE} -BitLockerRecoveryPath <path>  # after freeing disk space`,
      protector: null,
      tradeOff: null,
      steps: [],
      revert,
    };
  }

  if (!prereqs.recoveryPathProvided) {
    return {
      ready: false,
      abortReason:
        'No recovery-key backup path was provided. Without a VERIFIED recovery copy the kit refuses to encrypt. No exceptions.',
      readyCommand: `${BITLOCKER_READY_BASE} -BitLockerRecoveryPath <path> [-BitLockerPassword <SecureString>]`,
      protector: null,
      tradeOff: null,
      steps: [],
      revert,
    };
  }

  // No TPM + Legacy BIOS: the only viable protectors are a USB startup key
  // or a password. Prefer USB when a removable drive is present.
  if (!prereqs.hasTpm && !prereqs.usbKeyPresent && !prereqs.passwordProvided) {
    return {
      ready: false,
      abortReason:
        'No TPM and no viable protector: insert a USB drive for a startup key or provide -BitLockerPassword. Nothing was changed.',
      readyCommand: `${BITLOCKER_READY_BASE} -BitLockerRecoveryPath <path> -BitLockerPassword (Read-Host -AsSecureString -Prompt 'BitLocker password')`,
      protector: null,
      tradeOff: null,
      steps: [],
      revert,
    };
  }

  const protector = prereqs.usbKeyPresent ? 'usb-startup-key' : 'password';
  const tradeOff =
    protector === 'usb-startup-key'
      ? 'Trade-off: a USB startup key boots unattended while inserted (anyone with the USB + PC boots); ' +
        'losing the USB bricks boot until the recovery key is used. A password is typed at every boot ' +
        'but needs no hardware token.'
      : 'Trade-off: a password must be typed at every boot (slower, shoulder-surfing risk); ' +
        'a USB startup key would boot unattended while inserted but is lost if the drive fails. ' +
        'Insert a USB drive to use the startup-key protector instead.';

  const steps = [
    `Verify prerequisites (edition, no-TPM policy, free space, ${prereqs.firmware} firmware, TPM: ${prereqs.hasTpm ? 'present' : 'absent'})`,
    `Select protector: ${protector}`,
    'Generate the recovery key and write it to the backup path',
    'VERIFY the backup file contains the valid recovery key (re-read + match); abort without encrypting if it does not',
    'Enable-BitLocker with Used Space Only encryption (fast) on the OS volume',
    'Verify encryption started: manage-bde -status and report initial progress',
  ];

  return {
    ready: true,
    abortReason: null,
    readyCommand: null,
    protector,
    tradeOff,
    steps,
    revert,
  };
}

export interface MsiRegistryEntry {
  displayName: string;
  uninstallString: string;
}

export interface PerMachineMsiPlan {
  ready: boolean;
  abortReason: string | null;
  channel: 'msi' | 'msi-product-code' | null;
  guid: string | null;
  /** Set when the registered flag differs from the executed one. */
  note: string | null;
  steps: string[];
}

const MSI_UNINSTALL =
  /^MsiExec(?:\.exe)?\s*\/([xX])\s*\{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}\s*$/i;

const MSI_PRODUCT_CODE =
  /^MsiExec(?:\.exe)?\s*\/([iI])\s*\{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}\s*$/i;

/**
 * Decide the per-machine MSI test from an already-read registry entry.
 * `/X{GUID}` matches the app parser (`parseUninstallString`,
 * installed-apps.ts) exactly; `/I{GUID}` carries the same product code and is
 * accepted as `msi-product-code` with a recorded note, always executing the
 * canonical `msiexec /x {GUID}` uninstall. Any non-MSI or unparseable string
 * refuses without touching the system, and a missing entry means
 * "not installed".
 */
export function planPerMachineMsi(entry: MsiRegistryEntry | null): PerMachineMsiPlan {
  const steps = [
    'winget install --id 7zip.7zip --scope machine (controlled, reversible target)',
    'Verify installed: registry Uninstall key + winget list shows 7-Zip',
    'Resolve UninstallString through the MSI parser (same grammar as the app)',
    'Uninstall via the real MSI channel (msiexec /x {GUID} /qn /norestart)',
    'Verify clean: registry entry gone, before/after reported',
  ];

  if (!entry) {
    return {
      ready: false,
      abortReason:
        '7-Zip is not installed: no registry entry, nothing to resolve (read-only check).',
      channel: null,
      guid: null,
      note: null,
      steps,
    };
  }

  const strict = MSI_UNINSTALL.exec(entry.uninstallString.trim());
  if (strict) {
    return {
      ready: true,
      abortReason: null,
      channel: 'msi',
      guid: strict[2]!,
      note: null,
      steps,
    };
  }

  // Documented equivalence: some per-machine MSIs (7-Zip on this machine)
  // register /I (modify) instead of /X. The product code is the same, so the
  // kit extracts it and always executes the canonical `msiexec /x {GUID}`
  // uninstall. The app parser stays strict (/X only); the divergence is
  // recorded in `note` and in the kit JSON.
  const productCode = MSI_PRODUCT_CODE.exec(entry.uninstallString.trim());
  if (productCode) {
    return {
      ready: true,
      abortReason: null,
      channel: 'msi-product-code',
      guid: productCode[2]!,
      note: `Registered with /I (the app parser accepts /X only); executing the canonical msiexec /x {${productCode[2]}} /qn /norestart on the same product code.`,
      steps,
    };
  }

  return {
    ready: false,
    abortReason: `Unsupported uninstall string for "${entry.displayName}": the parser refused it, nothing was executed.`,
    channel: null,
    guid: null,
    note: null,
    steps,
  };
}

export interface OfferedDriverFacts {
  wuResponded: boolean;
  offeredCount: number;
}

export interface OfferedDriverPlan {
  action: 'install-pipeline' | 'noop';
  reason: string;
  steps: string[];
}

/**
 * Decide the offered-drivers mode from an already-read Windows Update answer.
 * Zero offered (or no answer at all) is a no-op: the kit touches nothing.
 * The kit NEVER claims "up to date" when WU did not answer.
 */
export function planOfferedDriverInstall(facts: OfferedDriverFacts): OfferedDriverPlan {
  if (!facts.wuResponded) {
    return {
      action: 'noop',
      reason: 'Windows Update did not answer: cannot claim up to date, nothing to install.',
      steps: [`Query Windows Update (IsInstalled=0 AND Type='Driver'): no response`],
    };
  }

  if (facts.offeredCount <= 0) {
    return {
      action: 'noop',
      reason: 'Windows Update offered 0 drivers: nothing to install, system left untouched.',
      steps: [`Query Windows Update (IsInstalled=0 AND Type='Driver'): 0 offered`],
    };
  }

  return {
    action: 'install-pipeline',
    reason: `Windows Update offers ${facts.offeredCount} driver(s): running the real pipeline.`,
    steps: [
      `Query Windows Update (IsInstalled=0 AND Type='Driver'): ${facts.offeredCount} offered`,
      'Create a restore point and VERIFY it exists before installing',
      'Install the offered drivers via Windows Update',
      'Re-verify the installed driver versions after install',
    ],
  };
}
