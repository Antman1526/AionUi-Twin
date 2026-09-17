/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OfficeCli installer.
 *
 * Asks the user for consent before any network access, downloads a pinned,
 * hash-verified install script from GitHub (an immutable commit ref, never
 * a mutable branch), and executes it directly via `execFile` (no shell
 * string interpolation). The script itself stages, signs, and renames the
 * `officecli` binary atomically, so no `xattr`/`codesign` post-processing
 * is needed or performed here.
 *
 * Dialog text is translated via the main-process i18n stack (the same
 * `common.json` the renderer and tray menu use) with a hardcoded English
 * fallback — see {@link translate}.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MessageBoxOptions } from 'electron';
import { downloadVerified } from '@process/services/download/verifiedDownload';
import { safeExecFile } from '@process/utils/safeExec';

/** Pinned POSIX (macOS/Linux) install script — immutable commit ref + verified SHA-256. */
export const POSIX_INSTALL_URL =
  'https://raw.githubusercontent.com/iOfficeAI/OfficeCli/95664ad0a1f853e8b9a73538e65bfda6df8166cf/install.sh';
export const POSIX_INSTALL_SHA256 = '2a0fdae06f4a018ea8d8516c69bfa5eeeb53406aacb5fa16fd07a9e572991bb6';

/** Pinned Windows install script — immutable commit ref + verified SHA-256. */
export const WINDOWS_INSTALL_URL =
  'https://raw.githubusercontent.com/iOfficeAI/OfficeCli/95664ad0a1f853e8b9a73538e65bfda6df8166cf/install.ps1';
export const WINDOWS_INSTALL_SHA256 = '5ee025bf9b89116b800d7b451e5667ecd0b5bb151e2c0cd74d7ba4e14f845009';

export type InstallOfficeCliResult = { installed: true } | { installed: false; reason: 'declined' };

/** Matches the subset of `Electron.Dialog.showMessageBox` this module needs, so tests can stub it without mocking electron. */
export type ConsentDialog = (options: MessageBoxOptions) => Promise<{ response: number }>;

/** Matches the subset of `safeExecFile` this module needs, so tests can stub it without spawning a real process. */
export type InstallExecFile = (file: string, args: string[]) => Promise<unknown>;

export interface InstallOfficeCliOptions {
  /** Injectable for tests; defaults to Electron's `dialog.showMessageBox`. */
  showConsentDialog?: ConsentDialog;
  /** Injectable for tests; defaults to `safeExecFile`. */
  execFile?: InstallExecFile;
  /** Injectable for tests; defaults to the pinned URL for the current platform. */
  scriptUrl?: string;
  /** Injectable for tests; defaults to the pinned SHA-256 for the current platform. */
  expectedSha256?: string;
  /** Injectable for tests; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Called once the user has consented, right before the download starts. */
  onInstalling?: () => void;
}

/** Electron is imported lazily so this module (and the bridges that import it) can load in standalone/WebUI and node tests. */
async function defaultShowConsentDialog(options: MessageBoxOptions): Promise<{ response: number }> {
  const { dialog } = await import('electron');
  return dialog.showMessageBox(options);
}

function defaultExecFile(file: string, args: string[]): Promise<unknown> {
  return safeExecFile(file, args);
}

/**
 * Best-effort translation for this dialog's strings, falling back to the given
 * English text. The main-process i18n stack pulls in app storage/config, which
 * this module deliberately does not depend on at import time so it keeps
 * loading in standalone/WebUI/test contexts — so a lookup failure (not yet
 * initialized, or no such context at all) silently falls back rather than
 * breaking the install flow.
 */
async function translate(key: string, fallback: string, options?: Record<string, unknown>): Promise<string> {
  try {
    const { default: i18n } = await import('@process/services/i18n');
    const value = i18n.t(key, options);
    return typeof value === 'string' && value.length > 0 && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Ask the user for consent, then download (hash-verified) and run the pinned
 * OfficeCli install script.
 *
 * - If the user declines, resolves with `{ installed: false, reason: 'declined' }`
 *   without making any network request.
 * - If the download's SHA-256 does not match the pinned value, or the script
 *   fails to execute, the returned promise rejects.
 * - The temporary script file is always removed once execution finishes
 *   (or fails).
 */
export async function installOfficeCli(options: InstallOfficeCliOptions = {}): Promise<InstallOfficeCliResult> {
  const platform = options.platform ?? process.platform;
  const isWindows = platform === 'win32';
  const scriptUrl = options.scriptUrl ?? (isWindows ? WINDOWS_INSTALL_URL : POSIX_INSTALL_URL);
  const expectedSha256 = options.expectedSha256 ?? (isWindows ? WINDOWS_INSTALL_SHA256 : POSIX_INSTALL_SHA256);
  const showConsentDialog = options.showConsentDialog ?? defaultShowConsentDialog;
  const execFile = options.execFile ?? defaultExecFile;

  const installDir = isWindows ? '%USERPROFILE%\\.local\\bin' : '~/.local/bin';
  const [installLabel, cancelLabel, title, message, detail] = await Promise.all([
    translate('common.officeCliInstall.install', 'Install'),
    translate('common.officeCliInstall.cancel', 'Cancel'),
    translate('common.officeCliInstall.title', 'Install OfficeCli'),
    translate('common.officeCliInstall.message', 'Install OfficeCli to preview this document?'),
    translate(
      'common.officeCliInstall.detail',
      `AionUi uses OfficeCli, an office document helper, to render live previews of Word, Excel, and PowerPoint files. ` +
        `It will be downloaded from GitHub (iOfficeAI/OfficeCli) and installed into ${installDir}.`,
      { installDir }
    ),
  ]);
  const { response } = await showConsentDialog({
    type: 'question',
    buttons: [installLabel, cancelLabel],
    defaultId: 1,
    cancelId: 1,
    title,
    message,
    detail,
  });

  if (response !== 0) {
    return { installed: false, reason: 'declined' };
  }

  options.onInstalling?.();

  const tmpFile = path.join(os.tmpdir(), `officecli-install-${randomUUID()}${isWindows ? '.ps1' : '.sh'}`);
  try {
    await downloadVerified({ url: scriptUrl, destPath: tmpFile, expectedSha256 });
    if (isWindows) {
      await execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile]);
    } else {
      await execFile('bash', [tmpFile]);
    }
    return { installed: true };
  } finally {
    await fs.rm(tmpFile, { force: true }).catch((): undefined => undefined);
  }
}
