/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { GhostModeStatus } from '@/common/adapter/ipcBridge';

let isGhostModeEnabled = false;
let blockedRequestsCount = 0;
let isFilterInstalled = false;

export function isAllowedLocalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();

    // Allow internal protocols
    if (protocol === 'file:' || protocol === 'data:' || protocol === 'devtools:' || protocol === 'we:') {
      return true;
    }

    // Allow localhost / 127.0.0.1 loopback
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return true;
    }

    return false;
  } catch {
    // If URL cannot be parsed and starts with file: or data:
    return urlString.startsWith('file:') || urlString.startsWith('data:');
  }
}

export function resetGhostModeState(): void {
  isGhostModeEnabled = false;
  blockedRequestsCount = 0;
}

function ensureNetworkInterceptor(): void {
  if (isFilterInstalled) return;
  isFilterInstalled = true;

  if (!process.versions.electron) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    const defaultSession = electron?.session?.defaultSession;
    if (!defaultSession?.webRequest) return;

    defaultSession.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details: { url: string }, callback: (res: { cancel: boolean }) => void) => {
        if (!isGhostModeEnabled) {
          callback({ cancel: false });
          return;
        }

        if (isAllowedLocalUrl(details.url)) {
          callback({ cancel: false });
          return;
        }

        // Blocked external request
        blockedRequestsCount++;
        console.warn(`[GhostMode] Blocked external request to: ${details.url}`);
        ipcBridge.ghostMode.statusChanged.emit({
          enabled: isGhostModeEnabled,
          blockedRequestsCount,
        });

        callback({ cancel: true });
      }
    );
  } catch (error) {
    console.warn('[GhostMode] Failed to attach webRequest listener:', error);
  }
}

export function getGhostModeStatus(): GhostModeStatus {
  return {
    enabled: isGhostModeEnabled,
    blockedRequestsCount,
  };
}

export function setGhostMode(enabled: boolean): GhostModeStatus {
  ensureNetworkInterceptor();
  isGhostModeEnabled = enabled;

  const status: GhostModeStatus = {
    enabled: isGhostModeEnabled,
    blockedRequestsCount,
  };

  ipcBridge.ghostMode.statusChanged.emit(status);
  return status;
}
