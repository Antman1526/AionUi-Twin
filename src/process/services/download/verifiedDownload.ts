/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';

export type DownloadProgress = {
  receivedBytes: number;
  /** Total bytes from Content-Length, or undefined when the server does not send it. */
  totalBytes?: number;
};

export type VerifiedDownloadOptions = {
  url: string;
  /** Final path of the file. The download is written to `<destPath>.part` and renamed on success. */
  destPath: string;
  /** Lower-case hex SHA-256 the finished file must match. Mismatch deletes the partial file and rejects. */
  expectedSha256: string;
  /** Optional expected size; a mismatch is treated like a hash mismatch. */
  expectedBytes?: number;
  /** Hard cap on bytes received, checked as data streams in (default 32 GiB). Guards against a
   * hostile/misbehaving server filling the disk when `expectedBytes` is not provided (or lies). */
  maxBytes?: number;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Maximum redirects to follow (Hugging Face redirects to a CDN). */
  maxRedirects?: number;
  /** Per-request timeout in milliseconds for headers to arrive. */
  timeoutMs?: number;
};

export class DownloadVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadVerificationError';
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Default cap on total bytes received for a single download (32 GiB). */
export const DEFAULT_MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024 * 1024;

/**
 * True unless a redirect would downgrade the connection from `https:` to `http:`. An http→https
 * upgrade (or same-protocol redirect) is allowed; an unparsable URL is treated as disallowed.
 */
export function isRedirectAllowed(fromUrl: string, toUrl: string): boolean {
  try {
    const fromProtocol = new URL(fromUrl).protocol;
    const toProtocol = new URL(toUrl).protocol;
    return !(fromProtocol === 'https:' && toProtocol === 'http:');
  } catch {
    return false;
  }
}

function requestStream(
  url: string,
  redirectsLeft: number,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { signal, headers: { 'User-Agent': 'AionUi' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        if (!isRedirectAllowed(url, next)) {
          reject(new Error(`Refusing to follow redirect from https to http: ${url} -> ${next}`));
          return;
        }
        requestStream(next, redirectsLeft - 1, timeoutMs, signal).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Download failed with HTTP ${status} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out waiting for ${url}`)));
    req.on('error', reject);
  });
}

/**
 * Download a file over HTTP(S) into `<destPath>.part`, hashing it as it streams, and
 * rename it to `destPath` only when the SHA-256 (and optional size) match. Any failure
 * removes the partial file so a half-written model can never be picked up by a scan.
 */
export async function downloadVerified(options: VerifiedDownloadOptions): Promise<void> {
  const { url, destPath, expectedBytes, onProgress, signal } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const expectedSha256 = options.expectedSha256.toLowerCase();
  if (!SHA256_HEX.test(expectedSha256)) {
    throw new DownloadVerificationError('expectedSha256 must be a 64-character hex string');
  }
  const partPath = `${destPath}.part`;
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  const res = await requestStream(url, options.maxRedirects ?? 5, options.timeoutMs ?? 30_000, signal);
  const headerLength = Number(res.headers['content-length']);
  const totalBytes = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : expectedBytes;

  const hash = createHash('sha256');
  let receivedBytes = 0;
  const out = createWriteStream(partPath);

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        signal?.removeEventListener('abort', abortListener);
      };
      const fail = (err: Error): void => {
        cleanup();
        res.destroy();
        out.destroy();
        reject(err);
      };
      const abortListener = (): void => fail(new Error('Download aborted'));
      res.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          fail(
            new DownloadVerificationError(
              `Download for ${path.basename(destPath)} exceeded the maximum allowed size of ${maxBytes} bytes`
            )
          );
          return;
        }
        if (expectedBytes !== undefined && receivedBytes > expectedBytes) {
          fail(
            new DownloadVerificationError(
              `Size mismatch for ${path.basename(destPath)}: expected ${expectedBytes} bytes, received ${receivedBytes}`
            )
          );
          return;
        }
        hash.update(chunk);
        onProgress?.({ receivedBytes, totalBytes });
      });
      res.on('error', fail);
      out.on('error', fail);
      // Resolve on 'close' (fd fully released), not 'finish' (data flushed but fd may still be
      // open) — the subsequent fs.rename can otherwise race the file descriptor's close on some
      // platforms.
      out.on('close', () => {
        cleanup();
        resolve();
      });
      signal?.addEventListener('abort', abortListener, { once: true });
      res.pipe(out);
    });

    const actual = hash.digest('hex');
    if (expectedBytes !== undefined && receivedBytes !== expectedBytes) {
      throw new DownloadVerificationError(
        `Size mismatch for ${path.basename(destPath)}: expected ${expectedBytes} bytes, received ${receivedBytes}`
      );
    }
    if (actual !== expectedSha256) {
      throw new DownloadVerificationError(`SHA-256 mismatch for ${path.basename(destPath)}: file rejected`);
    }
    await fs.rename(partPath, destPath);
  } catch (error) {
    await fs.rm(partPath, { force: true }).catch((): undefined => undefined);
    throw error;
  }
}

/** Compute the lower-case hex SHA-256 of a file on disk without loading it fully into memory. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}
