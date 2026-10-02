import * as path from 'path';
import { runPowerShell, parsePowerShellJson } from './powershell';
import { createNoopReporter, type ScanProgressReporter } from './scan-progress';

export interface JunkFile {
  id: string;
  path: string;
  name: string;
  size: number;
  category: JunkCategory;
  lastModified: Date;
  safeToDelete: boolean;
}

export type JunkCategory =
  'temp' | 'cache' | 'logs' | 'thumbnails' | 'recycle-bin' | 'browser-cache' | 'windows-update';

export interface JunkScanResult {
  files: JunkFile[];
  totalSize: number;
  totalCount: number;
  categories: Record<JunkCategory, { count: number; size: number }>;
}

interface CleanerRule {
  id: string;
  name: string;
  category: JunkCategory;
  protection: 'safe' | 'caution';
  paths: string[];
  patterns: string[];
  description: string;
}

interface ScannedFile {
  Category: JunkCategory;
  FullName: string;
  Name: string;
  Length: number;
  LastWriteTime: string;
}

interface JunkTarget {
  category: JunkCategory;
  path: string;
  pattern: string;
}

const MAX_FILES_PER_TARGET = 5000;

/** Caller-controlled scan scope, derived from the user's settings. */
export interface JunkScanOptions {
  /** Only these categories are scanned. `undefined` scans every category. */
  categories?: readonly JunkCategory[];
  /** Case-insensitive path prefixes to skip. */
  excludePaths?: readonly string[];
}

/** True when `filePath` sits under one of the excluded prefixes. */
export function isExcludedPath(filePath: string, excludePaths: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return excludePaths.some((raw) => {
    const prefix = raw
      .trim()
      .toLowerCase()
      .replace(/[\\/]+$/, '');
    if (prefix.length === 0) return false;
    return lower === prefix || lower.startsWith(`${prefix}\\`) || lower.startsWith(`${prefix}/`);
  });
}

const DEFAULT_RULES: CleanerRule[] = [
  {
    id: 'temp-files',
    name: 'Archivos Temporales',
    category: 'temp',
    protection: 'safe',
    paths: ['%TEMP%', 'C:\\Windows\\Temp'],
    patterns: ['*.tmp', '*.temp', '*.bak'],
    description: 'Archivos temporales del sistema y usuario.',
  },
  {
    id: 'browser-cache',
    name: 'Caché de Navegadores',
    category: 'browser-cache',
    protection: 'safe',
    paths: [
      '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache',
      '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Cache',
    ],
    patterns: ['*'],
    description: 'Caché de Chrome y Edge.',
  },
  {
    id: 'windows-update-cache',
    name: 'Caché de Windows Update',
    category: 'windows-update',
    protection: 'caution',
    paths: ['C:\\Windows\\SoftwareDistribution\\Download'],
    patterns: ['*'],
    description: 'Descargas de actualizaciones de Windows.',
  },
  {
    id: 'recycle-bin',
    name: 'Papelera de Reciclaje',
    category: 'recycle-bin',
    protection: 'safe',
    paths: ['C:\\$Recycle.Bin'],
    patterns: ['*'],
    description: 'Contenido de la papelera de reciclaje.',
  },
  {
    id: 'thumbnails',
    name: 'Caché de Miniaturas',
    category: 'thumbnails',
    protection: 'safe',
    paths: ['%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer'],
    patterns: ['thumbcache_*.db', 'iconcache_*.db'],
    description: 'Caché de miniaturas del Explorador.',
  },
  {
    id: 'logs',
    name: 'Archivos de Log',
    category: 'logs',
    protection: 'safe',
    paths: ['C:\\Windows\\Logs', 'C:\\Windows\\Panther'],
    patterns: ['*.log', '*.etl'],
    description: 'Archivos de registro del sistema.',
  },
  {
    id: 'crash-dumps',
    name: 'Volcados de Memoria',
    category: 'logs',
    protection: 'safe',
    paths: ['%LOCALAPPDATA%\\CrashDumps', 'C:\\Windows\\Minidump'],
    patterns: ['*.dmp'],
    description: 'Archivos de volcado de memoria tras crashes.',
  },
  {
    id: 'prefetch',
    name: 'Prefetch Data',
    category: 'cache',
    protection: 'safe',
    paths: ['C:\\Windows\\Prefetch'],
    patterns: ['*.pf'],
    description: 'Datos de prefetch de Windows.',
  },
];

function emptyCategories(): Record<JunkCategory, { count: number; size: number }> {
  return {
    temp: { count: 0, size: 0 },
    cache: { count: 0, size: 0 },
    logs: { count: 0, size: 0 },
    thumbnails: { count: 0, size: 0 },
    'recycle-bin': { count: 0, size: 0 },
    'browser-cache': { count: 0, size: 0 },
    'windows-update': { count: 0, size: 0 },
  };
}

function generateId(filePath: string, index: number): string {
  return `junk-${index}-${path.basename(filePath)}`;
}

/** Escape a value for a PowerShell single-quoted string literal. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildTargets(categories?: readonly JunkCategory[]): JunkTarget[] {
  const targets: JunkTarget[] = [];
  for (const rule of DEFAULT_RULES) {
    if (categories && !categories.includes(rule.category)) continue;
    for (const rulePath of rule.paths) {
      for (const pattern of rule.patterns) {
        targets.push({ category: rule.category, path: rulePath, pattern });
      }
    }
  }
  return targets;
}

/**
 * Scan for junk files in a SINGLE PowerShell invocation.
 *
 * Using one process (instead of ~20 sequential spawns) is dramatically faster.
 * Paths/patterns are emitted as single-quoted PowerShell literals so that
 * `$Recycle.Bin` is not treated as a variable.
 */
export async function scanForJunkFiles(
  reporter?: ScanProgressReporter,
  options: JunkScanOptions = {}
): Promise<JunkScanResult> {
  const progress = reporter ?? createNoopReporter('junk');
  const categories = emptyCategories();
  const files: JunkFile[] = [];
  const excludePaths = options.excludePaths ?? [];

  progress.report('discover', 8, 'Preparing junk scan targets...');

  const targetLiterals = buildTargets(options.categories)
    .map(
      (t) =>
        `[pscustomobject]@{ Category=${psQuote(t.category)}; Path=${psQuote(t.path)}; Filter=${psQuote(t.pattern)} }`
    )
    .join(', ');

  const script = `
    $targets = @(${targetLiterals});
    $out = foreach ($t in $targets) {
      $p = [Environment]::ExpandEnvironmentVariables($t.Path);
      if (-not (Test-Path -LiteralPath $p)) { continue }
      Get-ChildItem -LiteralPath $p -Filter $t.Filter -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { -not $_.PSIsContainer } |
        Select-Object -First ${MAX_FILES_PER_TARGET} |
        ForEach-Object {
          [pscustomobject]@{
            Category = $t.Category;
            FullName = $_.FullName;
            Name = $_.Name;
            Length = $_.Length;
            LastWriteTime = $_.LastWriteTime.ToString('o')
          }
        }
    };
    @($out) | ConvertTo-Json -Depth 3 -Compress
  `;

  try {
    progress.report('query', 35, 'Scanning temporary files and caches...');
    const result = await runPowerShell(script);
    if (!result.success || !result.stdout) {
      progress.fail('Junk scan failed');
      return { files, totalSize: 0, totalCount: 0, categories };
    }

    progress.report('parse', 80, 'Parsing scan results...');
    const parsed = parsePowerShellJson<ScannedFile[] | ScannedFile>(result.stdout);
    const list: ScannedFile[] = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

    progress.report('normalize', 90, 'Aggregating sizes...');

    for (const file of list) {
      if (!file || !file.FullName) continue;
      if (isExcludedPath(file.FullName, excludePaths)) continue;

      const category: JunkCategory = file.Category ?? 'temp';
      const size = Number(file.Length) || 0;

      files.push({
        id: generateId(file.FullName, files.length),
        path: file.FullName,
        name: file.Name,
        size,
        category,
        lastModified: new Date(file.LastWriteTime),
        safeToDelete: category !== 'windows-update' && category !== 'recycle-bin',
      });

      if (categories[category]) {
        categories[category].count++;
        categories[category].size += size;
      }
    }
  } catch {
    // Return whatever was collected so far.
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  progress.done('Junk scan complete');

  return {
    files,
    totalSize,
    totalCount: files.length,
    categories,
  };
}

export async function deleteJunkFiles(files: string[]): Promise<{
  success: boolean;
  deleted: number;
  failed: number;
  errors: string[];
}> {
  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const filePath of files) {
    try {
      const psCommand = `
        $path = ${psQuote(filePath)};
        if (Test-Path -LiteralPath $path) {
          Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop;
          Write-Output "DELETED"
        } else {
          Write-Output "NOT_FOUND"
        }
      `;

      const result = await runPowerShell(psCommand);
      if (result.success && (result.stdout === 'DELETED' || result.stdout === 'NOT_FOUND')) {
        deleted++;
      } else {
        failed++;
        errors.push(`Failed to delete: ${filePath}`);
      }
    } catch {
      failed++;
      errors.push(`Error: ${filePath}`);
    }
  }

  return {
    success: failed === 0,
    deleted,
    failed,
    errors,
  };
}
