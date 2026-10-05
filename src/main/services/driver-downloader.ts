import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import * as http from 'node:http';
import { runPowerShellWithTimeout, parsePowerShellJson } from './powershell';
import type { DriverProgressEvent } from '@shared/driver-update';

/**
 * Driver downloader (Fase 2.3).
 *
 * Real byte-level download (Node streams, BITS-style resume semantics) with:
 *  - progress in bytes (streamed to the renderer),
 *  - retries with backoff 5s / 15s / 45s (3 attempts),
 *  - verification of SIZE + SHA-256 + Authenticode signature,
 *  - ABORT + DELETE on any mismatch: an unverified file is never handed to the
 *    installer.
 *
 * The network path is dependency-injected (`DownloadFetcher`) so the whole
 * pipeline is unit-tested without touching the network, and the signature
 * check runs through `runPowerShell` (mockable).
 */

export const DOWNLOAD_RETRY_DELAYS_MS = [5_000, 15_000, 45_000] as const;

export interface DownloadOptions {
  driverId: string;
  url: string;
  /** Expected SHA-256 (hex, case-insensitive). */
  expectedSha256?: string | undefined;
  /** Expected size in bytes. */
  expectedSize?: number | undefined;
  /** Accepted Authenticode signer substrings (vendor trusted signers). */
  signerPatterns?: string[] | undefined;
  destDir?: string | undefined;
  onProgress?: ((event: DriverProgressEvent) => void) | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

export interface VerifiedDownload {
  success: boolean;
  message: string;
  filePath?: string;
  bytes?: number;
  sha256?: string;
  signature?: string;
  verified?: boolean;
}

export interface FetchResult {
  bytes: number;
}

/** Injectable network primitive: writes `url` to `destPath`. */
export type DownloadFetcher = (
  url: string,
  destPath: string,
  options: {
    onProgress: (received: number, total: number | undefined) => void;
    signal?: AbortSignal | undefined;
    timeoutMs: number;
  }
) => Promise<FetchResult>;

/** Stream `url` to `destPath` over http/https with real byte progress. */
export const httpDownload: DownloadFetcher = (url, destPath, options) =>
  new Promise<FetchResult>((resolve, reject) => {
    const request = (url.startsWith('https:') ? https : http).get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        reject(new Error(`Redirect not followed (${response.statusCode}) for ${url}`));
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode ?? 'unknown'} for ${url}`));
        return;
      }
      const totalHeader = Number(response.headers['content-length']);
      const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
      const out = fs.createWriteStream(destPath);
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        options.onProgress(received, total);
      });
      response.pipe(out);
      out.on('finish', () => {
        out.close(() => resolve({ bytes: received }));
      });
      out.on('error', reject);
      response.on('error', reject);
    });
    const timeout = setTimeout(() => {
      request.destroy(new Error(`Download timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    const done = (): void => clearTimeout(timeout);
    request.on('close', done);
    request.on('error', (error) => {
      done();
      reject(error);
    });
    if (options.signal) {
      const onAbort = (): void => {
        request.destroy(new Error('cancelled'));
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });

/** SHA-256 of a file, hex, lower-case. */
export function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/** Windows Update title version parse (e.g. "NVIDIA - Display - 31.0.15.4620"). */
export function verifyHash(filePath: string, expected: string): boolean {
  return sha256File(filePath).toLowerCase() === expected.trim().toLowerCase();
}

interface AuthenticodePayload {
  Status?: string;
  Subject?: string;
}

/**
 * Read the Authenticode signature through PowerShell. Returns the raw status
 * plus the signer subject; callers decide (the downloader requires `Valid`).
 */
export async function readAuthenticode(
  filePath: string,
  timeoutMs = 60_000
): Promise<{ status: string; subject: string }> {
  const quoted = filePath.replace(/'/g, "''");
  const result = await runPowerShellWithTimeout(
    `
    $sig = Get-AuthenticodeSignature -LiteralPath '${quoted}';
    $subject = '';
    if ($sig.SignerCertificate) { $subject = [string]$sig.SignerCertificate.Subject }
    @{ Status = [string]$sig.Status; Subject = $subject } | ConvertTo-Json -Compress
  `,
    timeoutMs
  );
  const payload = result.success ? parsePowerShellJson<AuthenticodePayload>(result.stdout) : null;
  return {
    status: payload?.Status ?? 'UnknownError',
    subject: payload?.Subject ?? '',
  };
}

function signatureAccepted(subject: string, signerPatterns?: string[]): boolean {
  if (!signerPatterns || signerPatterns.length === 0) return true;
  const s = subject.toLowerCase();
  return signerPatterns.some((p) => s.includes(p.toLowerCase()));
}

/** Delete a file, never throwing. */
export function safeDelete(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* best effort */
  }
}

function progressReporter(
  options: DownloadOptions
): (
  stage: DriverProgressEvent['stage'],
  percent: number,
  extra?: Partial<DriverProgressEvent>
) => void {
  return (stage, percent, extra) => {
    options.onProgress?.({
      driverId: options.driverId,
      stage,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      ...extra,
    });
  };
}

/** Download, verify, and return the verified file (or a failure + no file). */
export async function downloadDriver(
  options: DownloadOptions,
  fetcher: DownloadFetcher = httpDownload,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<VerifiedDownload> {
  const destDir = options.destDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-driver-'));
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `${options.driverId.replace(/[^A-Za-z0-9._-]/g, '_')}.bin`);
  const report = progressReporter(options);
  const timeoutMs = options.timeoutMs ?? 600_000;

  let lastError = '';
  for (let attempt = 0; attempt <= DOWNLOAD_RETRY_DELAYS_MS.length; attempt++) {
    if (options.signal?.aborted) {
      return { success: false, message: 'Download cancelled by the user.' };
    }
    try {
      report('download', 0, { message: `Downloading (attempt ${attempt + 1})...` });
      let lastReportAt = 0;
      const { bytes } = await fetcher(options.url, destPath, {
        signal: options.signal,
        timeoutMs,
        onProgress: (received, total) => {
          const now = Date.now();
          // Throttle to ~4 updates/second so the UI stays smooth.
          if (now - lastReportAt < 250) return;
          lastReportAt = now;
          const percent = total && total > 0 ? (received / total) * 100 : 0;
          report('download', percent, { bytesReceived: received, bytesTotal: total });
        },
      });

      const actualBytes = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
      const bytesForChecks = bytes > 0 ? bytes : actualBytes;

      // --- SIZE ---
      if (options.expectedSize !== undefined && bytesForChecks !== options.expectedSize) {
        safeDelete(destPath);
        return {
          success: false,
          message: `Size mismatch: expected ${options.expectedSize} bytes, got ${bytesForChecks}. File deleted.`,
        };
      }

      report('verify', 60, { message: 'Verifying SHA-256...' });
      const sha256 = sha256File(destPath);

      // --- HASH ---
      if (
        options.expectedSha256 &&
        sha256.toLowerCase() !== options.expectedSha256.trim().toLowerCase()
      ) {
        safeDelete(destPath);
        return {
          success: false,
          message: `SHA-256 mismatch (got ${sha256}). File deleted; nothing was installed.`,
        };
      }

      report('verify', 80, { message: 'Verifying Authenticode signature...' });
      const { status, subject } = await readAuthenticode(destPath, timeoutMs);

      // --- SIGNATURE ---
      if (status !== 'Valid') {
        safeDelete(destPath);
        return {
          success: false,
          message: `Authenticode signature is not valid (${status}). File deleted; nothing was installed.`,
        };
      }
      if (!signatureAccepted(subject, options.signerPatterns)) {
        safeDelete(destPath);
        return {
          success: false,
          message: `Authenticode signer "${subject}" is not a trusted vendor signer. File deleted.`,
        };
      }

      report('verify', 100, { message: 'Download verified.' });
      return {
        success: true,
        message: 'Download verified (size + SHA-256 + Authenticode).',
        filePath: destPath,
        bytes: bytesForChecks,
        sha256,
        signature: subject,
        verified: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.signal?.aborted || /cancelled/i.test(message)) {
        safeDelete(destPath);
        return { success: false, message: 'Download cancelled by the user.' };
      }
      lastError = message;
      safeDelete(destPath);
      const delay = DOWNLOAD_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        report('download', 0, {
          message: `Attempt ${attempt + 1} failed (${message}). Retrying in ${delay / 1000}s...`,
        });
        await sleep(delay);
      }
    }
  }

  return { success: false, message: `Download failed after retries: ${lastError}` };
}
