import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PowerShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runPowerShell(command: string): Promise<PowerShellResult> {
  try {
    const { stdout, stderr } = await execAsync(`powershell.exe -NoProfile -Command "${command.replace(/"/g, '\\"')}"`, {
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 10,
    });
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      success: false,
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? '').trim(),
      exitCode: err.code ?? 1,
    };
  }
}

export async function runPowerShellScript(script: string): Promise<PowerShellResult> {
  try {
    const { stdout, stderr } = await execAsync(`powershell.exe -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10,
    });
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      success: false,
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? '').trim(),
      exitCode: err.code ?? 1,
    };
  }
}

export function parsePowerShellJson<T>(output: string): T | null {
  try {
    return JSON.parse(output) as T;
  } catch {
    return null;
  }
}
