/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { requestEmbeddings } from '@process/services/semanticSearch/EmbeddingRuntime';

type CapturedRequest = { path: string; contentType: string | undefined; body: unknown };

let server: http.Server | null = null;

async function startServer(
  handler: (body: unknown) => { status: number; payload: unknown },
  captured: CapturedRequest[]
): Promise<string> {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) : undefined;
      captured.push({ path: req.url ?? '', contentType: req.headers['content-type'], body });
      const { status, payload } = handler(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('requestEmbeddings', () => {
  it('posts the OpenAI-compatible body llama-server documents and reads back the vectors', async () => {
    const captured: CapturedRequest[] = [];
    const baseUrl = await startServer(
      () => ({
        status: 200,
        payload: {
          object: 'list',
          model: 'bge-small',
          data: [
            { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
            { object: 'embedding', index: 1, embedding: [0.3, 0.4] },
          ],
        },
      }),
      captured
    );

    const vectors = await requestEmbeddings({ baseUrl, model: 'bge-small', inputs: ['alpha', 'beta'] });

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0].path).toBe('/v1/embeddings');
    expect(captured[0].contentType).toBe('application/json');
    expect(captured[0].body).toEqual({
      model: 'bge-small',
      input: ['alpha', 'beta'],
      encoding_format: 'float',
    });
  });

  it('reorders the response by the returned index', async () => {
    const captured: CapturedRequest[] = [];
    const baseUrl = await startServer(
      () => ({
        status: 200,
        payload: {
          data: [
            { index: 1, embedding: [9] },
            { index: 0, embedding: [1] },
          ],
        },
      }),
      captured
    );

    await expect(requestEmbeddings({ baseUrl, model: 'm', inputs: ['a', 'b'] })).resolves.toEqual([[1], [9]]);
  });

  it('surfaces a non-2xx response as an error', async () => {
    const captured: CapturedRequest[] = [];
    const baseUrl = await startServer(() => ({ status: 500, payload: { error: 'pooling type none' } }), captured);

    await expect(requestEmbeddings({ baseUrl, model: 'm', inputs: ['a'] })).rejects.toThrow(
      /Embedding request failed \(500\)/
    );
  });

  it('rejects a response whose vector count does not match the inputs', async () => {
    const captured: CapturedRequest[] = [];
    const baseUrl = await startServer(
      () => ({ status: 200, payload: { data: [{ index: 0, embedding: [1] }] } }),
      captured
    );

    await expect(requestEmbeddings({ baseUrl, model: 'm', inputs: ['a', 'b'] })).rejects.toThrow(
      /returned 1 vectors for 2 inputs/
    );
  });

  it('skips the round trip entirely for an empty batch', async () => {
    const captured: CapturedRequest[] = [];
    const baseUrl = await startServer(() => ({ status: 200, payload: { data: [] } }), captured);

    await expect(requestEmbeddings({ baseUrl, model: 'm', inputs: [] })).resolves.toEqual([]);
    expect(captured).toHaveLength(0);
  });
});
