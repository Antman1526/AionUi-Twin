/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import type { LocalModelRuntimeMetrics } from '@/common/adapter/ipcBridge';
import { getManagedServerStatus } from '@process/services/localModels/LocalModelRuntimeService';

const execFileAsync = promisify(execFile);

/** Decode state scraped from the running llama-server's `GET /slots` response. */
export type LlamaSlotsSnapshot = {
  /** Highest `n_ctx` reported by any slot — the server's context window. */
  contextSize?: number;
  /** Sum of `next_token.n_decoded` across slots. Monotonic within a generation, resets between them. */
  decodedTokens?: number;
  /** True when at least one slot reports `is_processing`. */
  isProcessing: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Parse the `GET /slots` payload of llama.cpp's `llama-server`.
 *
 * Only documented fields are read: `n_ctx`, `is_processing` and
 * `next_token.n_decoded`. The endpoint exposes no prompt/cache token count, so
 * used-context cannot be reported — the decoded counter is the only live
 * generation figure the server publishes without the `--metrics` flag.
 *
 * Returns `null` when the payload is not a slot array.
 */
export function parseSlots(json: unknown): LlamaSlotsSnapshot | null {
  if (!Array.isArray(json)) return null;

  let contextSize: number | undefined;
  let decodedTokens: number | undefined;
  let isProcessing = false;

  for (const slot of json) {
    if (!isRecord(slot)) continue;

    const nCtx = readFiniteNumber(slot.n_ctx);
    if (nCtx !== undefined) {
      contextSize = contextSize === undefined ? nCtx : Math.max(contextSize, nCtx);
    }

    const nextToken = isRecord(slot.next_token) ? slot.next_token : undefined;
    const nDecoded = readFiniteNumber(nextToken?.n_decoded);
    if (nDecoded !== undefined) {
      decodedTokens = (decodedTokens ?? 0) + nDecoded;
    }

    if (slot.is_processing === true) isProcessing = true;
  }

  return {
    ...(contextSize !== undefined ? { contextSize } : {}),
    ...(decodedTokens !== undefined ? { decodedTokens } : {}),
    isProcessing,
  };
}

/**
 * Parse `ps -o rss= -p <pid>` output (darwin/linux). RSS is reported in KiB.
 * Returns undefined when the process is gone (empty output).
 */
export function parsePsRss(stdout: string): number | undefined {
  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => /^\d+$/.test(entry));
  if (!line) return undefined;
  return Number(line) * 1024;
}

/**
 * Parse `tasklist /FI "PID eq <pid>" /FO CSV /NH` output (win32). The memory
 * column is the 5th CSV field, formatted like `"12,345 K"`; the thousands
 * separator is locale-dependent so every non-digit is stripped. Returns
 * undefined for the "No tasks are running…" line or an `N/A` memory column.
 */
export function parseTasklistRss(stdout: string): number | undefined {
  for (const rawLine of stdout.split('\n')) {
    const fields = rawLine.match(/"[^"]*"/g);
    if (!fields || fields.length < 5) continue;
    const digits = fields[4].replace(/\D/g, '');
    if (!digits) continue;
    return Number(digits) * 1024;
  }
  return undefined;
}

/** Fetch and JSON-parse `http://127.0.0.1:<port>/slots`. Resolves null on any failure. */
function fetchSlots(port: number, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/slots', timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as unknown);
        } catch {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

/**
 * Read the resident set size of a pid without ever building a shell string.
 * Returns undefined on unsupported platforms or when the process is gone.
 */
export async function readProcessRssBytes(pid: number): Promise<number | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      return parseTasklistRss(stdout);
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
      return parsePsRss(stdout);
    }
  } catch {
    // Process exited between the status read and the sample — no figure to report.
  }
  return undefined;
}

const SLOTS_TIMEOUT_MS = 1500;

/**
 * Sample the live decode state of the managed local model server.
 * Every field beyond `sampledAt` is optional: nothing is invented when no
 * server is running, when it was started with `--no-slots`, or when it is an
 * MLX server (which has no `/slots` endpoint).
 */
export async function sampleRuntimeMetrics(): Promise<LocalModelRuntimeMetrics> {
  const sampledAt = Date.now();
  const status = getManagedServerStatus();
  if (!status) return { sampledAt };

  const [slotsJson, rssBytes] = await Promise.all([
    fetchSlots(status.port, SLOTS_TIMEOUT_MS),
    readProcessRssBytes(status.pid),
  ]);
  const snapshot = parseSlots(slotsJson);

  return {
    sampledAt,
    port: status.port,
    pid: status.pid,
    ...(rssBytes !== undefined ? { rssBytes } : {}),
    ...(snapshot?.contextSize !== undefined ? { contextSize: snapshot.contextSize } : {}),
    ...(snapshot?.decodedTokens !== undefined ? { decodedTokens: snapshot.decodedTokens } : {}),
    ...(snapshot ? { isProcessing: snapshot.isProcessing } : {}),
  };
}
