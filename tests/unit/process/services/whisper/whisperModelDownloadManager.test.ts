import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWhisperModelDownloadManager } from '@process/services/whisper/whisperModelDownloadManager';
import type { WhisperDownloadProgress } from '@/common/types/speech';

const payload = Buffer.from('ggml-bytes-'.repeat(5000));
const payloadSha = createHash('sha256').update(payload).digest('hex');

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-model-download-'));
  server = http.createServer((req, res) => {
    if (req.url === '/model.bin') {
      res.writeHead(200, { 'Content-Length': String(payload.length) });
      res.end(payload);
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

describe('createWhisperModelDownloadManager', () => {
  it('downloads, verifies the hash, reports progress and finishes with done', async () => {
    const events: WhisperDownloadProgress[] = [];
    const manager = createWhisperModelDownloadManager({ onProgress: (progress) => events.push(progress) });
    const destPath = path.join(tmpDir, 'ok.bin');

    await manager.start({
      id: 'base-q5_1',
      url: `${baseUrl}/model.bin`,
      destPath,
      expectedSha256: payloadSha,
      expectedBytes: payload.length,
    });

    expect(await fs.readFile(destPath)).toEqual(payload);
    expect(events[0]).toMatchObject({ id: 'base-q5_1', state: 'downloading', receivedBytes: 0 });
    expect(events.at(-1)).toMatchObject({ state: 'done', receivedBytes: payload.length });
    expect(manager.activeId()).toBeNull();
  });

  it('rejects and reports an error when the SHA-256 does not match, leaving no file behind', async () => {
    const events: WhisperDownloadProgress[] = [];
    const manager = createWhisperModelDownloadManager({ onProgress: (progress) => events.push(progress) });
    const destPath = path.join(tmpDir, 'bad.bin');

    await expect(
      manager.start({
        id: 'small-q5_1',
        url: `${baseUrl}/model.bin`,
        destPath,
        expectedSha256: 'f'.repeat(64),
        expectedBytes: payload.length,
      })
    ).rejects.toThrow('SHA-256 mismatch');

    expect(events.at(-1)).toMatchObject({ id: 'small-q5_1', state: 'error' });
    await expect(fs.stat(destPath)).rejects.toThrow();
    expect(manager.activeId()).toBeNull();
  });

  it('refuses a second concurrent download', async () => {
    const manager = createWhisperModelDownloadManager({ onProgress: () => undefined });
    const first = manager.start({
      id: 'base-q5_1',
      url: `${baseUrl}/model.bin`,
      destPath: path.join(tmpDir, 'first.bin'),
      expectedSha256: payloadSha,
      expectedBytes: payload.length,
    });

    await expect(
      manager.start({
        id: 'small-q5_1',
        url: `${baseUrl}/model.bin`,
        destPath: path.join(tmpDir, 'second.bin'),
        expectedSha256: payloadSha,
        expectedBytes: payload.length,
      })
    ).rejects.toThrow('Another whisper model download is already in progress');

    await first;
  });
});
