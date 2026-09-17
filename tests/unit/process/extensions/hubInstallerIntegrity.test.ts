/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubInstallerImpl } from '../../../../src/process/extensions/hub/HubInstaller';
import type { IHubExtension } from '../../../../src/common/types/hub';

type InstallerInternals = {
  verifyIntegrity: (filePath: string, expectedSri: string) => Promise<void>;
  enforceIntegrity: (
    name: string,
    zipPath: string,
    extInfo: Pick<IHubExtension, 'dist' | 'bundled'>
  ) => Promise<'integrity' | 'bundled'>;
  getCacheDir: () => string;
  getTempDir: () => string;
};

let tmpRoot: string;
let cacheDir: string;
let resourcesDir: string;
let installer: HubInstallerImpl;
let internals: InstallerInternals;

const ARCHIVE_BYTES = Buffer.from('fake extension archive bytes');

function sri(algorithm: 'sha256' | 'sha512', bytes: Buffer): string {
  return `${algorithm}-${crypto.createHash(algorithm).update(bytes).digest('base64')}`;
}

function dist(integrity: string): IHubExtension['dist'] {
  return { tarball: 'extensions/fake.zip', integrity, unpackedSize: ARCHIVE_BYTES.length };
}

function writeArchive(dir: string, name: string, bytes: Buffer = ARCHIVE_BYTES): string {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

describe('extensions/hub HubInstaller — integrity verification', () => {
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-hub-integrity-'));
    cacheDir = path.join(tmpRoot, 'cache');
    resourcesDir = path.join(tmpRoot, 'resources');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    installer = new HubInstallerImpl();
    internals = installer as unknown as InstallerInternals;
    internals.getCacheDir = () => cacheDir;
    internals.getTempDir = () => path.join(tmpRoot, 'tmp');
    vi.restoreAllMocks();
  });

  describe('verifyIntegrity', () => {
    it('accepts a matching sha512 SRI', async () => {
      const file = writeArchive(cacheDir, 'ok-512.zip');
      await expect(internals.verifyIntegrity(file, sri('sha512', ARCHIVE_BYTES))).resolves.toBeUndefined();
    });

    it('accepts a matching sha256 SRI', async () => {
      const file = writeArchive(cacheDir, 'ok-256.zip');
      await expect(internals.verifyIntegrity(file, sri('sha256', ARCHIVE_BYTES))).resolves.toBeUndefined();
    });

    it('tolerates surrounding whitespace in the SRI value', async () => {
      const file = writeArchive(cacheDir, 'ws.zip');
      await expect(internals.verifyIntegrity(file, `  ${sri('sha512', ARCHIVE_BYTES)}  `)).resolves.toBeUndefined();
    });

    it('rejects when the file bytes differ', async () => {
      const file = writeArchive(cacheDir, 'tampered.zip', Buffer.from('tampered archive'));
      await expect(internals.verifyIntegrity(file, sri('sha512', ARCHIVE_BYTES))).rejects.toThrow(
        /Integrity verification failed/
      );
    });

    it('rejects a sha256 SRI whose digest belongs to different bytes', async () => {
      const file = writeArchive(cacheDir, 'tampered-256.zip', Buffer.from('tampered archive'));
      await expect(internals.verifyIntegrity(file, sri('sha256', ARCHIVE_BYTES))).rejects.toThrow(
        /Integrity verification failed/
      );
    });

    it('rejects an unsupported algorithm instead of silently skipping', async () => {
      const file = writeArchive(cacheDir, 'md5.zip');
      await expect(internals.verifyIntegrity(file, 'md5-abcdef==')).rejects.toThrow(/unsupported or malformed/i);
    });

    it('rejects a malformed SRI value', async () => {
      const file = writeArchive(cacheDir, 'malformed.zip');
      await expect(internals.verifyIntegrity(file, 'sha512:not-base64!!')).rejects.toThrow(/unsupported or malformed/i);
    });

    it('rejects a sha512 SRI carrying a truncated digest', async () => {
      const file = writeArchive(cacheDir, 'short.zip');
      await expect(internals.verifyIntegrity(file, 'sha512-YWJj')).rejects.toThrow(/Integrity verification failed/);
    });
  });

  describe('enforceIntegrity policy', () => {
    it('returns "integrity" and keeps the archive when the hash matches', async () => {
      const file = writeArchive(cacheDir, 'policy-ok.zip');
      await expect(
        internals.enforceIntegrity('fake-ext', file, { dist: dist(sri('sha512', ARCHIVE_BYTES)) })
      ).resolves.toBe('integrity');
      expect(fs.existsSync(file)).toBe(true);
    });

    it('fails the install and deletes the cached archive on mismatch', async () => {
      const file = writeArchive(cacheDir, 'policy-bad.zip', Buffer.from('evil'));
      await expect(
        internals.enforceIntegrity('fake-ext', file, { dist: dist(sri('sha512', ARCHIVE_BYTES)) })
      ).rejects.toThrow(/Integrity verification failed/);
      expect(fs.existsSync(file)).toBe(false);
    });

    it('deletes a temp-dir archive on mismatch too', async () => {
      const tempDir = internals.getTempDir();
      const file = writeArchive(tempDir, 'policy-bad-tmp.zip', Buffer.from('evil'));
      await expect(
        internals.enforceIntegrity('fake-ext', file, { dist: dist(sri('sha512', ARCHIVE_BYTES)) })
      ).rejects.toThrow(/Integrity verification failed/);
      expect(fs.existsSync(file)).toBe(false);
    });

    it('leaves a bundled Resources archive on disk even when it fails verification', async () => {
      const file = writeArchive(resourcesDir, 'bundled-bad.zip', Buffer.from('evil'));
      await expect(
        internals.enforceIntegrity('fake-ext', file, { dist: dist(sri('sha512', ARCHIVE_BYTES)), bundled: true })
      ).rejects.toThrow(/Integrity verification failed/);
      expect(fs.existsSync(file)).toBe(true);
    });

    it('refuses a non-bundled extension whose index entry has no integrity value', async () => {
      const file = writeArchive(cacheDir, 'no-integrity.zip');
      await expect(internals.enforceIntegrity('fake-ext', file, { dist: dist(''), bundled: false })).rejects.toThrow(
        /no dist.integrity value/
      );
    });

    it('refuses a non-bundled extension whose integrity value is whitespace only', async () => {
      const file = writeArchive(cacheDir, 'blank-integrity.zip');
      await expect(internals.enforceIntegrity('fake-ext', file, { dist: dist('   ') })).rejects.toThrow(
        /no dist.integrity value/
      );
    });

    it('allows a bundled extension with no integrity value', async () => {
      const file = writeArchive(resourcesDir, 'bundled-ok.zip');
      await expect(internals.enforceIntegrity('fake-ext', file, { dist: dist(''), bundled: true })).resolves.toBe(
        'bundled'
      );
    });
  });
});
