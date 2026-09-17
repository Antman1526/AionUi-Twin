/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Content fingerprint of an installed extension directory.
 *
 * The hub install record stores the fingerprint taken at install time; the
 * channel-plugin trust gate recomputes it before loading code into the main
 * process. Without it, trust is keyed on `manifest.name` alone and a sideloaded
 * directory can inherit a hub-installed extension's `verified` record.
 *
 * The digest covers the sorted relative path of every regular file plus the
 * SHA-256 of its bytes, so it is independent of directory traversal order and
 * sensitive to any content, rename, addition or deletion. Symlinks are recorded
 * as their link target rather than followed — replacing a file with a symlink
 * to somewhere else changes the digest.
 */

const DIGEST_ALGORITHM = 'sha256';

type DirectoryEntry = { relativePath: string; fingerprint: string };

function hashBytes(bytes: Buffer): string {
  return crypto.createHash(DIGEST_ALGORITHM).update(bytes).digest('hex');
}

function collectEntries(root: string, current: string, entries: DirectoryEntry[]): void {
  for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, dirent.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');

    if (dirent.isSymbolicLink()) {
      entries.push({ relativePath, fingerprint: `link:${hashBytes(Buffer.from(fs.readlinkSync(absolutePath)))}` });
      continue;
    }
    if (dirent.isDirectory()) {
      collectEntries(root, absolutePath, entries);
      continue;
    }
    if (!dirent.isFile()) continue;

    entries.push({ relativePath, fingerprint: `file:${hashBytes(fs.readFileSync(absolutePath))}` });
  }
}

/**
 * Compute the deterministic digest of a directory's contents.
 *
 * @param directory Absolute path of the directory to fingerprint.
 * @returns `sha256-<hex>` over the sorted `<relative path>\0<file hash>` list.
 * @throws When the directory (or a file inside it) cannot be read.
 */
export function computeDirectoryDigest(directory: string): string {
  const root = path.resolve(directory);
  const entries: DirectoryEntry[] = [];
  collectEntries(root, root, entries);
  entries.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));

  const hash = crypto.createHash(DIGEST_ALGORITHM);
  for (const entry of entries) {
    hash.update(`${entry.relativePath}\0${entry.fingerprint}\n`);
  }
  return `${DIGEST_ALGORITHM}-${hash.digest('hex')}`;
}

/**
 * {@link computeDirectoryDigest} that returns `null` instead of throwing.
 *
 * Callers on the trust path must never grant trust because a digest could not
 * be taken, so a failure has to be representable rather than fatal.
 *
 * @param directory Absolute path of the directory to fingerprint.
 */
export function tryComputeDirectoryDigest(directory: string): string | null {
  try {
    return computeDirectoryDigest(directory);
  } catch {
    return null;
  }
}
