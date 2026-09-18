/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for verifying the integrity of a Hugging Face model download:
 * a hard cap on bytes written (a misbehaving or hostile endpoint must never be
 * able to write an unbounded file), and sha256 digest verification against the
 * LFS content hash Hugging Face exposes for LFS-backed files.
 *
 * These helpers do no I/O themselves — `modelDownloadManager.ts` wires them
 * into the actual fetch/fs stream.
 */

/** Hard ceiling used when the server does not declare a (or a usable) content-length. */
export const DEFAULT_MAX_MODEL_BYTES = 64 * 1024 * 1024 * 1024; // 64 GiB

export type DownloadIntegrityErrorCode = 'size_exceeded' | 'digest_mismatch';

/** Thrown by {@link createSizeGuard} and {@link verifyDigest} on a failed check. */
export class DownloadIntegrityError extends Error {
  readonly code: DownloadIntegrityErrorCode;

  constructor(code: DownloadIntegrityErrorCode, message: string) {
    super(message);
    this.name = 'DownloadIntegrityError';
    this.code = code;
  }
}

/**
 * Resolve the byte cap to enforce for one download.
 *
 * A caller-provided `override` always wins. Otherwise a known `expectedBytes`
 * (from the response `content-length`) is used as the exact cap — a server
 * that keeps streaming past what it declared is misbehaving and must be cut
 * off. With neither, fall back to {@link DEFAULT_MAX_MODEL_BYTES} so a
 * response with no declared length can never write an unbounded file.
 */
export function resolveMaxBytes(expectedBytes?: number, override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override;
  if (typeof expectedBytes === 'number' && Number.isFinite(expectedBytes) && expectedBytes > 0) return expectedBytes;
  return DEFAULT_MAX_MODEL_BYTES;
}

/**
 * A running tally of streamed bytes that throws a {@link DownloadIntegrityError}
 * the instant the cumulative total exceeds `maxBytes`. Call `accept` per chunk,
 * before (or instead of) buffering it, so a hostile/broken endpoint is cut off
 * mid-stream rather than after the whole (unbounded) body has already been
 * written to disk.
 */
export function createSizeGuard(maxBytes: number): {
  accept: (chunkLength: number) => void;
  receivedBytes: () => number;
} {
  let received = 0;
  return {
    accept(chunkLength: number): void {
      received += chunkLength;
      if (received > maxBytes) {
        throw new DownloadIntegrityError(
          'size_exceeded',
          `Download exceeded the maximum allowed size of ${maxBytes} bytes`
        );
      }
    },
    receivedBytes(): number {
      return received;
    },
  };
}

type HfLfsPointer = { oid?: unknown };
type HfTreeItemLike = { oid?: unknown; lfs?: HfLfsPointer };

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Extract a verifiable sha256 content hash from a Hugging Face tree/file API
 * entry (e.g. an item from `GET /api/models/{id}/tree/main`).
 *
 * Verified against the live API (`curl -sS
 * https://huggingface.co/api/models/Qwen/Qwen3-4B-GGUF/tree/main`), each
 * entry exposes two different hashes:
 *  - `oid`: the git blob sha1 (40 hex chars) of the LFS *pointer* object, not
 *    the file content — never usable as a content hash.
 *  - `lfs.oid`: the actual sha256 of the file content (64 hex chars), present
 *    only for LFS-backed files.
 *
 * Returns undefined for anything else — small, non-LFS files have no content
 * hash exposed by this API at all, and an unknown hash is not an error, just
 * something the caller should report as unverified.
 */
export function parseExpectedSha256(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const { lfs } = input as HfTreeItemLike;
  if (!lfs || typeof lfs !== 'object') return undefined;
  const oid = (lfs as HfLfsPointer).oid;
  if (typeof oid === 'string' && SHA256_HEX_RE.test(oid)) return oid;
  return undefined;
}

/**
 * Verify a computed sha256 digest against the expected content hash.
 * A no-op when `expectedHex` is undefined — an unknown hash is not a failure,
 * it just means the caller should report `verified: false`.
 */
export function verifyDigest(actualHex: string, expectedHex?: string): void {
  if (!expectedHex) return;
  if (actualHex.toLowerCase() !== expectedHex.toLowerCase()) {
    throw new DownloadIntegrityError(
      'digest_mismatch',
      `Downloaded file digest ${actualHex} does not match expected ${expectedHex}`
    );
  }
}
