import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { embeddingsEndpoint, embedTexts } from '@process/services/semanticSearch/EmbeddingClient';

type CapturedRequest = { url: string; body: unknown; headers: http.IncomingHttpHeaders };

let server: http.Server;
let baseUrl = '';
let captured: CapturedRequest | null = null;
let respondWith: { status: number; payload: unknown } = { status: 200, payload: { data: [] } };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured = {
        url: req.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf-8')),
        headers: req.headers,
      };
      res.writeHead(respondWith.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(respondWith.payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('embeddingsEndpoint', () => {
  it('appends /embeddings to a versioned base URL', () => {
    expect(embeddingsEndpoint('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1/embeddings');
    expect(embeddingsEndpoint('http://127.0.0.1:8080/v1/')).toBe('http://127.0.0.1:8080/v1/embeddings');
  });

  it('inserts /v1 when the base URL has no version segment', () => {
    expect(embeddingsEndpoint('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/v1/embeddings');
  });
});

describe('embedTexts', () => {
  it('posts the OpenAI-compatible request shape documented by llama-server', async () => {
    respondWith = {
      status: 200,
      payload: {
        data: [
          { index: 0, embedding: [1, 2] },
          { index: 1, embedding: [3, 4] },
        ],
      },
    };

    const vectors = await embedTexts({ baseUrl, inputs: ['hello', 'world'], model: 'embedding' });

    expect(captured?.url).toBe('/v1/embeddings');
    expect(captured?.body).toEqual({ model: 'embedding', input: ['hello', 'world'], encoding_format: 'float' });
    expect(vectors).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('sends an Authorization header only when an api key is given', async () => {
    respondWith = { status: 200, payload: { data: [{ index: 0, embedding: [1] }] } };

    await embedTexts({ baseUrl, inputs: ['a'] });
    expect(captured?.headers.authorization).toBeUndefined();

    await embedTexts({ baseUrl, inputs: ['a'], apiKey: 'secret' });
    expect(captured?.headers.authorization).toBe('Bearer secret');
  });

  it('orders vectors by the response index, not by arrival order', async () => {
    respondWith = {
      status: 200,
      payload: {
        data: [
          { index: 1, embedding: [9] },
          { index: 0, embedding: [8] },
        ],
      },
    };

    await expect(embedTexts({ baseUrl, inputs: ['a', 'b'] })).resolves.toEqual([[8], [9]]);
  });

  it('skips the request entirely for an empty batch', async () => {
    captured = null;
    await expect(embedTexts({ baseUrl, inputs: [] })).resolves.toEqual([]);
    expect(captured).toBeNull();
  });

  it('throws on an HTTP error', async () => {
    respondWith = { status: 500, payload: { error: 'boom' } };
    await expect(embedTexts({ baseUrl, inputs: ['a'] })).rejects.toThrow(/HTTP 500/);
  });

  it('throws when the response is missing vectors', async () => {
    respondWith = { status: 200, payload: { data: [{ index: 0, embedding: [1] }] } };
    await expect(embedTexts({ baseUrl, inputs: ['a', 'b'] })).rejects.toThrow(/1 vectors for 2 inputs/);
  });
});
