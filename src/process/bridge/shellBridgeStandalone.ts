/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell Bridge - Standalone (no-Electron) Mode
 *
 * Implements shell operations using Node.js child_process instead of Electron
 * shell APIs. Works for both local standalone and headless server deployments.
 */

import { ipcBridge } from '@/common';
import { execFile } from 'node:child_process';
import path from 'node:path';

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function parseSafeExternalUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function runOpen(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...rest] =
      process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', ...args]
        : process.platform === 'darwin'
          ? ['open', ...args]
          : ['xdg-open', ...args];
    execFile(cmd, rest, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function initShellBridgeStandalone(): void {
  ipcBridge.shell.openFile.provider((filePath) => runOpen([filePath]));

  ipcBridge.shell.showItemInFolder.provider((filePath) => runOpen([path.dirname(filePath)]));

  ipcBridge.shell.openExternal.provider((url) => {
    const parsed = parseSafeExternalUrl(url);
    if (!parsed) {
      console.warn(`[shellBridge] Invalid URL passed to openExternal: ${url}`);
      return Promise.resolve();
    }
    return runOpen([parsed.toString()]);
  });
}
