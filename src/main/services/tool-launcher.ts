import { shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { runPowerShell } from './powershell';
import { getWindowsTool, type WindowsTool } from '@shared/windows-tools';

/** Absolute path to the tool inside `%SystemRoot%\System32`. */
export function resolveToolPath(
  tool: WindowsTool,
  systemRoot: string = process.env['SystemRoot'] ?? 'C:\\Windows'
): string {
  return path.join(systemRoot, 'System32', tool.file);
}

export interface ToolLaunchResult {
  success: boolean;
  message: string;
}

/**
 * Validate that the Windows binary exists, then open it with the OS default
 * handler. Never launches an arbitrary caller-supplied path: `id` must match
 * the curated catalog in `@shared/windows-tools`.
 */
export async function launchWindowsTool(id: string): Promise<ToolLaunchResult> {
  const tool = getWindowsTool(id);
  if (!tool) return { success: false, message: `Unknown utility: ${id}` };
  if (process.platform !== 'win32') {
    return { success: false, message: 'Windows utilities are only available on Windows.' };
  }

  const exePath = resolveToolPath(tool);
  if (!fs.existsSync(exePath)) {
    return { success: false, message: `Utility not found on this system: ${tool.file}` };
  }

  try {
    const error = await shell.openPath(exePath);
    if (error) return { success: false, message: error };

    // openPath resolves with '' even when the request was only queued. Confirm a
    // process for the tool is actually running before claiming success.
    const processName = path.basename(exePath, '.exe');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const probe = await runPowerShell(
        `if (Get-Process -Name '${processName}' -ErrorAction SilentlyContinue) { Write-Output 'RUNNING' } else { Write-Output 'NO' }`
      );
      if (probe.success && probe.stdout.includes('RUNNING')) {
        return { success: true, message: `Opened ${tool.name}.` };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      success: false,
      message: `The OS did not report an error, but ${tool.name} did not appear to start.`,
    };
  } catch (error) {
    return { success: false, message: `Failed to open ${tool.name}: ${String(error)}` };
  }
}
