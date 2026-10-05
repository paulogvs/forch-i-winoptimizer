import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { downloadDriver, sha256File, verifyHash, type DownloadFetcher } from './driver-downloader';

vi.mock('./powershell', () => ({
  runPowerShellWithTimeout: vi.fn(),
  parsePowerShellJson: vi.fn((data: string) => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

import { runPowerShellWithTimeout } from './powershell';

const CONTENT = Buffer.from('driver-binary-content');
const CONTENT_SHA = sha256FileFromBuffer(CONTENT);

function sha256FileFromBuffer(buffer: Buffer): string {
  // Local helper: write to a temp file and reuse the module's own hash.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-sha-'));
  const file = path.join(dir, 'b.bin');
  fs.writeFileSync(file, buffer);
  const hash = sha256File(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return hash;
}

let destDir: string;

function signature(status: string, subject = 'CN=NVIDIA Corporation'): void {
  vi.mocked(runPowerShellWithTimeout).mockResolvedValue({
    success: true,
    stdout: JSON.stringify({ Status: status, Subject: subject }),
    stderr: '',
    exitCode: 0,
  });
}

/** Fetcher that writes fixed content to the destination. */
const goodFetcher: DownloadFetcher = async (_url, destPath, options) => {
  fs.writeFileSync(destPath, CONTENT);
  options.onProgress(CONTENT.length, CONTENT.length);
  return { bytes: CONTENT.length };
};

describe('driver-downloader (Fase 2.3)', () => {
  beforeEach(() => {
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-dl-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  it('downloads and verifies size + SHA-256 + Authenticode', async () => {
    signature('Valid');
    const result = await downloadDriver(
      {
        driverId: 'gpu-1',
        url: 'https://example.test/driver.exe',
        expectedSha256: CONTENT_SHA,
        expectedSize: CONTENT.length,
        signerPatterns: ['NVIDIA'],
        destDir,
      },
      goodFetcher
    );
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.sha256).toBe(CONTENT_SHA);
    expect(fs.existsSync(result.filePath!)).toBe(true);
  });

  it('aborts and DELETES the file when the hash does not match', async () => {
    const result = await downloadDriver(
      {
        driverId: 'gpu-2',
        url: 'https://example.test/driver.exe',
        expectedSha256: 'deadbeef',
        destDir,
      },
      goodFetcher
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/SHA-256 mismatch/i);
    expect(runPowerShellWithTimeout).not.toHaveBeenCalled();
    // No file may be left behind for a later installer to pick up.
    expect(fs.readdirSync(destDir)).toEqual([]);
  });

  it('aborts and DELETES the file when the size does not match', async () => {
    const result = await downloadDriver(
      { driverId: 'gpu-3', url: 'https://example.test/driver.exe', expectedSize: 1, destDir },
      goodFetcher
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Size mismatch/i);
    expect(fs.readdirSync(destDir)).toEqual([]);
  });

  it('aborts and DELETES the file when the signature is invalid', async () => {
    signature('NotSigned');
    const result = await downloadDriver(
      {
        driverId: 'gpu-4',
        url: 'https://example.test/driver.exe',
        expectedSha256: CONTENT_SHA,
        destDir,
      },
      goodFetcher
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/signature is not valid/i);
    expect(fs.readdirSync(destDir)).toEqual([]);
  });

  it('aborts and DELETES the file when the signer is not a trusted vendor', async () => {
    signature('Valid', 'CN=Evil Corp');
    const result = await downloadDriver(
      {
        driverId: 'gpu-5',
        url: 'https://example.test/driver.exe',
        expectedSha256: CONTENT_SHA,
        signerPatterns: ['NVIDIA'],
        destDir,
      },
      goodFetcher
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not a trusted vendor signer/i);
    expect(fs.readdirSync(destDir)).toEqual([]);
  });

  it('retries with backoff on a transient network error, then succeeds', async () => {
    signature('Valid');
    let attempts = 0;
    const flaky: DownloadFetcher = async (url, destPath, options) => {
      attempts++;
      if (attempts < 3) throw new Error('ECONNRESET');
      return goodFetcher(url, destPath, options);
    };
    const sleeps: number[] = [];
    const result = await downloadDriver(
      {
        driverId: 'gpu-6',
        url: 'https://example.test/driver.exe',
        expectedSha256: CONTENT_SHA,
        destDir,
      },
      flaky,
      async (ms) => {
        sleeps.push(ms);
      }
    );
    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([5_000, 15_000]);
  });

  it('stops immediately when the operation is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await downloadDriver(
      {
        driverId: 'gpu-7',
        url: 'https://example.test/driver.exe',
        destDir,
        signal: controller.signal,
      },
      goodFetcher
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/cancelled/i);
  });

  it('verifyHash compares case-insensitively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forchi-vh-'));
    const file = path.join(dir, 'x.bin');
    fs.writeFileSync(file, CONTENT);
    expect(verifyHash(file, CONTENT_SHA.toUpperCase())).toBe(true);
    expect(verifyHash(file, 'nope')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
