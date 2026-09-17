import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DownloadVerificationError,
  downloadVerified,
  isRedirectAllowed,
  sha256File,
} from '@process/services/download/verifiedDownload';

const payload = Buffer.from('hello local models '.repeat(2000));
const payloadSha = createHash('sha256').update(payload).digest('hex');

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verified-download-'));
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/file' });
      res.end();
      return;
    }
    if (req.url === '/file') {
      res.writeHead(200, { 'Content-Length': String(payload.length) });
      res.end(payload);
      return;
    }
    if (req.url === '/nolength') {
      res.writeHead(200);
      res.end(payload);
      return;
    }
    if (req.url === '/bigstream') {
      // Writes an oversized first chunk, then deliberately holds the connection open so a test
      // can prove the client rejected the download early instead of waiting for the body to end.
      res.writeHead(200);
      res.write(payload);
      const timer = setTimeout(() => {
        try {
          res.end();
        } catch {
          // Response may already be destroyed by the client aborting.
        }
      }, 5000);
      req.on('close', () => clearTimeout(timer));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('downloadVerified', () => {
  it('follows redirects, reports progress, verifies the hash and renames the part file', async () => {
    const destPath = path.join(tmpDir, 'ok.gguf');
    const progress: number[] = [];
    await downloadVerified({
      url: `${baseUrl}/redirect`,
      destPath,
      expectedSha256: payloadSha.toUpperCase(),
      expectedBytes: payload.length,
      onProgress: (p) => progress.push(p.receivedBytes),
    });
    expect(await fs.readFile(destPath)).toEqual(payload);
    expect(progress.at(-1)).toBe(payload.length);
    await expect(fs.stat(`${destPath}.part`)).rejects.toThrow();
  });

  it('rejects and deletes the partial file on a hash mismatch', async () => {
    const destPath = path.join(tmpDir, 'bad.gguf');
    await expect(
      downloadVerified({ url: `${baseUrl}/file`, destPath, expectedSha256: 'a'.repeat(64) })
    ).rejects.toBeInstanceOf(DownloadVerificationError);
    await expect(fs.stat(destPath)).rejects.toThrow();
    await expect(fs.stat(`${destPath}.part`)).rejects.toThrow();
  });

  it('rejects on a size mismatch even when the hash is not checked first', async () => {
    const destPath = path.join(tmpDir, 'size.gguf');
    await expect(
      downloadVerified({ url: `${baseUrl}/nolength`, destPath, expectedSha256: payloadSha, expectedBytes: 5 })
    ).rejects.toThrow(/Size mismatch/);
    await expect(fs.stat(`${destPath}.part`)).rejects.toThrow();
  });

  it('rejects an invalid expected hash before touching the network', async () => {
    await expect(
      downloadVerified({ url: `${baseUrl}/file`, destPath: path.join(tmpDir, 'x'), expectedSha256: 'nope' })
    ).rejects.toThrow(/64-character/);
  });

  it('rejects non-2xx responses', async () => {
    await expect(
      downloadVerified({ url: `${baseUrl}/missing`, destPath: path.join(tmpDir, 'y'), expectedSha256: payloadSha })
    ).rejects.toThrow(/HTTP 404/);
  });

  it('rejects immediately once the stream exceeds expectedBytes, without waiting for the response to end, and removes the .part file', async () => {
    const destPath = path.join(tmpDir, 'toolarge.gguf');
    const start = Date.now();
    await expect(
      downloadVerified({ url: `${baseUrl}/bigstream`, destPath, expectedSha256: payloadSha, expectedBytes: 10 })
    ).rejects.toThrow(/Size mismatch/);
    // The server holds the connection open for 5s before ending on its own; rejecting well
    // under that proves the size check fires on the `data` event, not after the stream ends.
    expect(Date.now() - start).toBeLessThan(3000);
    await expect(fs.stat(`${destPath}.part`)).rejects.toThrow();
  }, 10000);

  it('rejects once received bytes exceed maxBytes even when expectedBytes is not provided', async () => {
    const destPath = path.join(tmpDir, 'maxbytes.gguf');
    await expect(
      downloadVerified({ url: `${baseUrl}/file`, destPath, expectedSha256: payloadSha, maxBytes: 10 })
    ).rejects.toThrow(/maximum allowed size/);
    await expect(fs.stat(`${destPath}.part`)).rejects.toThrow();
  });

  it('removes the abort listener after the download completes, leaving no leaked listener on the signal', async () => {
    const destPath = path.join(tmpDir, 'abort-cleanup.gguf');
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    await downloadVerified({
      url: `${baseUrl}/file`,
      destPath,
      expectedSha256: payloadSha,
      expectedBytes: payload.length,
      signal: controller.signal,
    });

    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('isRedirectAllowed', () => {
  it('allows same-protocol redirects and an http -> https upgrade', () => {
    expect(isRedirectAllowed('https://a.test/x', 'https://cdn.test/y')).toBe(true);
    expect(isRedirectAllowed('http://a.test/x', 'http://cdn.test/y')).toBe(true);
    expect(isRedirectAllowed('http://a.test/x', 'https://cdn.test/y')).toBe(true);
  });

  it('disallows an https -> http downgrade', () => {
    expect(isRedirectAllowed('https://a.test/x', 'http://cdn.test/y')).toBe(false);
  });

  it('treats an unparsable URL as disallowed', () => {
    expect(isRedirectAllowed('not a url', 'https://cdn.test/y')).toBe(false);
    expect(isRedirectAllowed('https://a.test/x', 'not a url')).toBe(false);
  });
});

describe('sha256File', () => {
  it('matches crypto for a file on disk', async () => {
    const file = path.join(tmpDir, 'hash.bin');
    await fs.writeFile(file, payload);
    expect(await sha256File(file)).toBe(payloadSha);
  });
});
