/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Target location: tests/unit/process/services/hfHub/modelDownloadManager.test.ts
//
// Exercises streamFileFromHf directly against a real loopback node:http
// server (rather than mocking fetch), so the size guard and digest checks
// are verified against actual streamed bytes.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: () => ({ provider: vi.fn(), invoke: vi.fn() }),
    buildEmitter: () => ({ emit: vi.fn(), on: vi.fn() }),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    hfHub: { downloadProgress: { emit: vi.fn(), on: vi.fn() } },
    localModel: { runtimeChanged: { emit: vi.fn(), on: vi.fn() } },
  },
}));

import { streamFileFromHf } from '@process/services/hfHub/modelDownloadManager';

describe('streamFileFromHf', () => {
  let server: Server;
  let baseUrl: string;
  let responder: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {
    throw new Error('no responder configured for this test');
  };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-hf-download-'));
    server = http.createServer((req, res) => responder(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('failed to bind loopback server');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('trips the size guard mid-stream and removes the .part file when the server sends more than it declared', async () => {
    responder = (_req, res) => {
      // No content-length: a chunked response of unknown length, which is exactly
      // the case the cap exists for. (A declared content-length cannot be exceeded
      // here — Node's own server truncates writes past it.)
      res.writeHead(200);
      res.write(Buffer.alloc(10, 'a'));
      res.write(Buffer.alloc(1_000_000, 'b'));
      res.end();
    };

    const destinationPath = path.join(tmpDir, 'model.gguf');
    await expect(
      streamFileFromHf({
        modelId: 'org/model',
        fileName: 'model.gguf',
        destinationPath,
        signal: new AbortController().signal,
        onChunk: () => {},
        baseUrl,
        maxBytesOverride: 1_000,
      })
    ).rejects.toThrow(/exceeded the maximum allowed size/);

    expect(fs.existsSync(destinationPath)).toBe(false);
    expect(fs.existsSync(`${destinationPath}.part`)).toBe(false);
  });

  it('rejects and removes the partial file on a digest mismatch', async () => {
    const content = Buffer.from('hello world model weights');
    responder = (_req, res) => {
      res.writeHead(200, { 'content-length': String(content.byteLength) });
      res.end(content);
    };

    const destinationPath = path.join(tmpDir, 'model.gguf');
    await expect(
      streamFileFromHf({
        modelId: 'org/model',
        fileName: 'model.gguf',
        destinationPath,
        signal: new AbortController().signal,
        onChunk: () => {},
        baseUrl,
        expectedSha256: 'f'.repeat(64),
      })
    ).rejects.toThrow(/does not match expected/);

    expect(fs.existsSync(destinationPath)).toBe(false);
    expect(fs.existsSync(`${destinationPath}.part`)).toBe(false);
  });

  it('succeeds and reports verified: true when the digest matches', async () => {
    const content = Buffer.from('hello world model weights');
    const expectedSha256 = crypto.createHash('sha256').update(content).digest('hex');
    responder = (_req, res) => {
      res.writeHead(200, { 'content-length': String(content.byteLength) });
      res.end(content);
    };

    const destinationPath = path.join(tmpDir, 'model.gguf');
    const result = await streamFileFromHf({
      modelId: 'org/model',
      fileName: 'model.gguf',
      destinationPath,
      signal: new AbortController().signal,
      onChunk: () => {},
      baseUrl,
      expectedSha256,
    });

    expect(result).toEqual({ verified: true });
    expect(fs.readFileSync(destinationPath)).toEqual(content);
    expect(fs.existsSync(`${destinationPath}.part`)).toBe(false);
  });

  it('succeeds but reports verified: false when no expected hash is known', async () => {
    const content = Buffer.from('hello world model weights');
    responder = (_req, res) => {
      res.writeHead(200, { 'content-length': String(content.byteLength) });
      res.end(content);
    };

    const destinationPath = path.join(tmpDir, 'model.gguf');
    const result = await streamFileFromHf({
      modelId: 'org/model',
      fileName: 'model.gguf',
      destinationPath,
      signal: new AbortController().signal,
      onChunk: () => {},
      baseUrl,
    });

    expect(result).toEqual({ verified: false });
    expect(fs.readFileSync(destinationPath)).toEqual(content);
  });
});
