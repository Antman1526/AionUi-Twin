/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getGhostModeStatus, setGhostMode } from '@process/services/security/ghostModeService';

export function initGhostModeBridge(): void {
  ipcBridge.ghostMode.getStatus.provider(async () => {
    try {
      return { success: true, data: getGhostModeStatus() };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.ghostMode.toggle.provider(async ({ enabled }) => {
    try {
      const status = setGhostMode(enabled);
      return { success: true, data: status };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
