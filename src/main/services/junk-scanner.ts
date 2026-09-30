import * as path from 'path';
import { runPowerShell, parsePowerShellJson } from './powershell';

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
  | 'temp'
  | 'cache'
  | 'logs'
  | 'thumbnails'
  | 'recycle-bin'
  | 'browser-cache'
  | 'windows-update';

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

function expandEnvironmentVariables(pathStr: string): string {
  return pathStr
    .replace(/%TEMP%/gi, process.env.TEMP ?? 'C:\\Windows\\Temp')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local')
    .replace(/%USERNAME%/gi, process.env.USERNAME ?? 'Default');
}

function generateId(filePath: string, index: number): string {
  return `junk-${index}-${path.basename(filePath)}`;
}

export async function scanForJunkFiles(): Promise<JunkScanResult> {
  const files: JunkFile[] = [];
  const categories: Record<JunkCategory, { count: number; size: number }> = {
    temp: { count: 0, size: 0 },
    cache: { count: 0, size: 0 },
    logs: { count: 0, size: 0 },
    thumbnails: { count: 0, size: 0 },
    'recycle-bin': { count: 0, size: 0 },
    'browser-cache': { count: 0, size: 0 },
    'windows-update': { count: 0, size: 0 },
  };

  for (const rule of DEFAULT_RULES) {
    for (const rulePath of rule.paths) {
      const expandedPath = expandEnvironmentVariables(rulePath);

      for (const pattern of rule.patterns) {
        try {
          const psCommand = `
            $files = Get-ChildItem -Path "${expandedPath}" -Filter "${pattern}" -Recurse -ErrorAction SilentlyContinue -Force;
            $result = @();
            foreach ($file in $files) {
              $result += @{
                FullName = $file.FullName;
                Name = $file.Name;
                Length = $file.Length;
                LastWriteTime = $file.LastWriteTime.ToString("o")
              }
            };
            $result | ConvertTo-Json -Compress
          `;

          const result = await runPowerShell(psCommand);
          if (result.success && result.stdout) {
            const parsed = parsePowerShellJson<Array<{
              FullName: string;
              Name: string;
              Length: number;
              LastWriteTime: string;
            }>>(result.stdout);

            if (parsed) {
              for (let i = 0; i < parsed.length; i++) {
                const file = parsed[i];
                if (!file) continue;

                const junkFile: JunkFile = {
                  id: generateId(file.FullName, files.length),
                  path: file.FullName,
                  name: file.Name,
                  size: file.Length,
                  category: rule.category,
                  lastModified: new Date(file.LastWriteTime),
                  safeToDelete: rule.protection === 'safe',
                };

                files.push(junkFile);
                categories[rule.category].count++;
                categories[rule.category].size += file.Length;
              }
            }
          }
        } catch {
          // Continue with next path
        }
      }
    }
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

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
        $path = "${filePath.replace(/"/g, '\\"')}";
        if (Test-Path $path) {
          Remove-Item -Path $path -Recurse -Force -ErrorAction Stop;
          Write-Output "DELETED"
        } else {
          Write-Output "NOT_FOUND"
        }
      `;

      const result = await runPowerShell(psCommand);
      if (result.success && result.stdout === 'DELETED') {
        deleted++;
      } else if (result.stdout === 'NOT_FOUND') {
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
