/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import http from 'node:http';
import { getManagedServerStatus } from './LocalModelRuntimeService';

/**
 * Per-slot facts read from llama-server's `GET /slots`.
 *
 * Only fields documented in the llama.cpp server README are used: `n_ctx`,
 * `is_processing` and `next_token.n_decoded`. The endpoint publishes no
 * prompt-token count, so `decodedTokens` is the only token figure available.
 */
export type LlamaSlotMetrics = {
  /** Slot context window (`n_ctx`). */
  contextSize: number;
  /** Tokens decoded so far by this slot (`next_token.n_decoded`). */
  decodedTokens: number;
  /** True when the slot is mid-request (`is_processing`). */
  processing: boolean;
  /** How many slots the server reported. */
  slotCount: number;
};

/** One sample of the managed llama-server's runtime state. */
export type LocalModelRuntimeMetrics = {
  /** False when no managed server is running — every other field is then absent. */
  running: boolean;
  modelPath?: string;
  name?: string;
  pid?: number;
  contextSize?: number;
  decodedTokens?: number;
  processing?: boolean;
  /** Resident set size of the llama-server process, in bytes. */
  rssBytes?: number;
  /** When the sample was taken, ms since epoch. */
  sampledAt: number;
};

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reduce a `GET /slots` payload to the figures the HUD shows.
 *
 * Prefers the first slot reporting `is_processing`, so a busy slot is never
 * hidden behind an idle one.
 *
 * @param json Parsed `/slots` response.
 * @returns The chosen slot's metrics, or null when the payload is unusable.
 */
export function parseSlots(json: unknown): LlamaSlotMetrics | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const slots = json.filter((slot): slot is Record<string, unknown> => typeof slot === 'object' && slot !== null);
  if (slots.length === 0) return null;

  const chosen = slots.find((slot) => slot.is_processing === true) ?? slots[0];
  const contextSize = asFiniteNumber(chosen.n_ctx);
  if (contextSize === null) return null;

  const nextToken = typeof chosen.next_token === 'object' && chosen.next_token !== null ? chosen.next_token : {};
  const decodedTokens = asFiniteNumber((nextToken as Record<string, unknown>).n_decoded) ?? 0;

  return {
    contextSize,
    decodedTokens,
    processing: chosen.is_processing === true,
    slotCount: slots.length,
  };
}

/**
 * Parse `ps -o rss= -p <pid>` output (darwin/linux). `ps` reports KiB.
 *
 * @returns Resident set size in bytes, or null when no number was printed.
 */
export function parsePsRssBytes(stdout: string): number | null {
  const match = /(\d+)/.exec(stdout);
  if (!match) return null;
  return Number(match[1]) * 1024;
}

/**
 * Parse `tasklist /FI "PID eq <pid>" /FO CSV /NH` output (win32).
 *
 * The memory column is the fifth CSV field and is localized
 * (`"1,234 K"` / `"1.234 K"`), so every non-digit is stripped before parsing.
 *
 * @returns Resident set size in bytes, or null when the row is missing.
 */
export function parseTasklistRssBytes(stdout: string): number | null {
  const row = stdout.split(/\r?\n/).find((line) => line.trim().startsWith('"'));
  if (!row) return null;
  const fields = row.match(/"([^"]*)"/g);
  if (!fields || fields.length < 5) return null;
  const digits = fields[4].replace(/\D/g, '');
  if (digits.length === 0) return null;
  return Number(digits) * 1024;
}

/** The command that reports a process's resident set size on `platform`. */
export function rssCommand(platform: NodeJS.Platform, pid: number): { file: string; args: string[] } {
  if (platform === 'win32') {
    return { file: 'tasklist', args: ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'] };
  }
  return { file: 'ps', args: ['-o', 'rss=', '-p', String(pid)] };
}

/** Pick the parser matching the command {@link rssCommand} produced. */
export function parseRssBytes(platform: NodeJS.Platform, stdout: string): number | null {
  return platform === 'win32' ? parseTasklistRssBytes(stdout) : parsePsRssBytes(stdout);
}

/** Runs a command and resolves its stdout; injected so the metrics reader stays testable. */
export type CommandRunner = (file: string, args: string[]) => Promise<string>;

const runCommand: CommandRunner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

/**
 * Resident set size of a running process.
 *
 * @returns Bytes, or null when the process is gone or the tool is unavailable.
 */
export async function readProcessRssBytes(
  pid: number,
  platform: NodeJS.Platform,
  run: CommandRunner = runCommand
): Promise<number | null> {
  const { file, args } = rssCommand(platform, pid);
  try {
    return parseRssBytes(platform, await run(file, args));
  } catch {
    return null;
  }
}

/** Fetches a llama-server JSON endpoint; injected so the metrics reader stays testable. */
export type JsonFetcher = (url: string) => Promise<unknown>;

const fetchJson: JsonFetcher = (url) =>
  new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 2000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${String(response.statusCode)}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });

/**
 * `<origin>/slots` for a managed server base URL such as
 * `http://127.0.0.1:8080/v1`, whose OpenAI path must be dropped first.
 */
export function slotsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/slots`;
}

/**
 * Sample the managed llama-server: slot state from `/slots` and process memory
 * from the platform's process-listing tool.
 *
 * Never throws — an unreachable endpoint simply leaves its fields undefined, so
 * the HUD degrades to whatever it could read.
 *
 * @returns `{ running: false }` when no managed server is active.
 */
export async function collectRuntimeMetrics(
  deps: { fetchJson?: JsonFetcher; run?: CommandRunner; platform?: NodeJS.Platform } = {}
): Promise<LocalModelRuntimeMetrics> {
  const sampledAt = Date.now();
  const handle = getManagedServerStatus();
  if (!handle) return { running: false, sampledAt };

  const platform = deps.platform ?? process.platform;
  const getJson = deps.fetchJson ?? fetchJson;

  const [slots, rssBytes] = await Promise.all([
    getJson(slotsUrl(handle.baseUrl))
      .then(parseSlots)
      .catch((): null => null),
    readProcessRssBytes(handle.pid, platform, deps.run),
  ]);

  const metrics: LocalModelRuntimeMetrics = {
    running: true,
    modelPath: handle.modelPath,
    name: handle.alias,
    pid: handle.pid,
    sampledAt,
  };
  if (slots) {
    metrics.contextSize = slots.contextSize;
    metrics.decodedTokens = slots.decodedTokens;
    metrics.processing = slots.processing;
  }
  if (rssBytes !== null) metrics.rssBytes = rssBytes;
  return metrics;
}
