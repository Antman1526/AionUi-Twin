/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Target location: tests/unit/process/services/hfHub/downloadIntegrity.test.ts

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_MODEL_BYTES,
  DownloadIntegrityError,
  createSizeGuard,
  parseExpectedSha256,
  resolveMaxBytes,
  verifyDigest,
} from '@process/services/hfHub/downloadIntegrity';

describe('resolveMaxBytes', () => {
  it('uses the override when provided, regardless of expectedBytes', () => {
    expect(resolveMaxBytes(1_000, 500)).toBe(500);
  });

  it('uses expectedBytes as an exact cap when no override is given', () => {
    expect(resolveMaxBytes(12_345)).toBe(12_345);
  });

  it('falls back to DEFAULT_MAX_MODEL_BYTES when neither is known', () => {
    expect(resolveMaxBytes(undefined, undefined)).toBe(DEFAULT_MAX_MODEL_BYTES);
  });

  it('ignores a zero or negative expectedBytes/override', () => {
    expect(resolveMaxBytes(0, -5)).toBe(DEFAULT_MAX_MODEL_BYTES);
  });
});

describe('createSizeGuard', () => {
  it('accepts chunks under the cap without throwing', () => {
    const guard = createSizeGuard(100);
    expect(() => guard.accept(40)).not.toThrow();
    expect(() => guard.accept(40)).not.toThrow();
    expect(guard.receivedBytes()).toBe(80);
  });

  it('throws a DownloadIntegrityError the instant the cumulative total exceeds the cap', () => {
    const guard = createSizeGuard(100);
    guard.accept(60);
    expect(() => guard.accept(60)).toThrow(DownloadIntegrityError);
    try {
      const guard2 = createSizeGuard(100);
      guard2.accept(60);
      guard2.accept(60);
    } catch (err) {
      expect(err).toBeInstanceOf(DownloadIntegrityError);
      expect((err as DownloadIntegrityError).code).toBe('size_exceeded');
    }
  });
});

describe('parseExpectedSha256', () => {
  it('accepts a 64-char lowercase hex lfs.oid', () => {
    const sha = 'a'.repeat(64);
    expect(parseExpectedSha256({ oid: 'deadbeef', lfs: { oid: sha, size: 123 } })).toBe(sha);
  });

  it('rejects the top-level git blob oid (sha1, 40 chars) even without an lfs field', () => {
    expect(parseExpectedSha256({ oid: '1206cf64b64392ba533af8e1e6d793ac290c8111' })).toBeUndefined();
  });

  it('rejects a malformed or non-64-char lfs.oid', () => {
    expect(parseExpectedSha256({ lfs: { oid: 'not-hex' } })).toBeUndefined();
    expect(parseExpectedSha256({ lfs: { oid: 'a'.repeat(40) } })).toBeUndefined();
  });

  it('returns undefined for non-object input', () => {
    expect(parseExpectedSha256(undefined)).toBeUndefined();
    expect(parseExpectedSha256('a'.repeat(64))).toBeUndefined();
  });
});

describe('verifyDigest', () => {
  it('is a no-op when expectedHex is undefined (unknown hash is not a failure)', () => {
    expect(() => verifyDigest('abc123', undefined)).not.toThrow();
  });

  it('passes silently on a case-insensitive match', () => {
    expect(() => verifyDigest('ABCDEF', 'abcdef')).not.toThrow();
  });

  it('throws a DownloadIntegrityError with code digest_mismatch on a mismatch', () => {
    expect(() => verifyDigest('abc123', 'def456')).toThrow(DownloadIntegrityError);
    try {
      verifyDigest('abc123', 'def456');
    } catch (err) {
      expect((err as DownloadIntegrityError).code).toBe('digest_mismatch');
    }
  });
});
