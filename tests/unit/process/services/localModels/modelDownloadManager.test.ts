import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createModelDownloadManager,
  type CatalogDownloadProgress,
} from '@process/services/localModels/modelDownloadManager';

const payload = Buffer.from('gguf-bytes-'.repeat(5000));
const payloadSha = createHash('sha256').update(payload).digest('hex');

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-download-'));
  server = http.createServer((req, res) => {
    if (req.url === '/model.gguf') {
      res.writeHead(200, { 'Content-Length': String(payload.length) });
      res.end(payload);
      return;
    }
    if (req.url === '/slow.gguf') {
      res.writeHead(200, { 'Content-Length': String(payload.length * 2) });
      res.write(payload);
      // Never finishes, so the test can cancel mid-flight.
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

describe('createModelDownloadManager', () => {
  it('downloads, verifies the hash, reports progress and finishes with done', async () => {
    const events: CatalogDownloadProgress[] = [];
    const manager = createModelDownloadManager({ onProgress: (progress) => events.push(progress) });
    const destPath = path.join(tmpDir, 'ok.gguf');

    await manager.start({
      id: 'qwen3-4b-q4km',
      url: `${baseUrl}/model.gguf`,
      destPath,
      expectedSha256: payloadSha,
      expectedBytes: payload.length,
    });

    expect(await fs.readFile(destPath)).toEqual(payload);
    expect(events[0]).toMatchObject({ id: 'qwen3-4b-q4km', state: 'downloading', receivedBytes: 0 });
    expect(events.at(-1)).toMatchObject({ state: 'done', receivedBytes: payload.length });
    expect(events.some((event) => event.state === 'downloading' && event.receivedBytes > 0)).toBe(true);
    expect(manager.activeId()).toBeNull();
  });

  it('rejects and reports an error when the SHA-256 does not match, leaving no file behind', async () => {
    const events: CatalogDownloadProgress[] = [];
    const manager = createModelDownloadManager({ onProgress: (progress) => events.push(progress) });
    const destPath = path.join(tmpDir, 'bad.gguf');

    await expect(
      manager.start({
        id: 'phi4-mini-q4km',
        url: `${baseUrl}/model.gguf`,
        destPath,
        expectedSha256: 'f'.repeat(64),
        expectedBytes: payload.length,
      })
    ).rejects.toThrow('SHA-256 mismatch');

    expect(events.at(-1)).toMatchObject({ id: 'phi4-mini-q4km', state: 'error' });
    await expect(fs.stat(destPath)).rejects.toThrow();
    await expect(fs.stat(`${destPath}.part`)).rejects.toThrow();
  });

  it('cancels an in-flight download and reports the cancelled state', async () => {
    const events: CatalogDownloadProgress[] = [];
    const manager = createModelDownloadManager({ onProgress: (progress) => events.push(progress) });
    const destPath = path.join(tmpDir, 'cancelled.gguf');

    const pending = manager.start({
      id: 'llama32-3b-q4km',
      url: `${baseUrl}/slow.gguf`,
      destPath,
      expectedSha256: payloadSha,
      expectedBytes: payload.length * 2,
    });

    await vi.waitFor(() => expect(events.some((event) => event.receivedBytes > 0)).toBe(true));
    expect(manager.cancel('llama32-3b-q4km')).toBe(true);

    await expect(pending).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ id: 'llama32-3b-q4km', state: 'cancelled' });
    expect(manager.activeId()).toBeNull();
  });

  it('reports false when cancelling an id that is not downloading', () => {
    const manager = createModelDownloadManager({ onProgress: () => undefined });
    expect(manager.cancel('qwen3-8b-q4km')).toBe(false);
  });
});
