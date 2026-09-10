/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { getQuickBarWindow, hideQuickBar, toggleQuickBar } from '@process/window/quickBarWindow';
import { showAndFocusMainWindow } from '@process/utils/mainWindowLifecycle';

export function initQuickBarBridge(): void {
  ipcBridge.quickBar.toggle.provider(async () => {
    toggleQuickBar();
  });

  ipcBridge.quickBar.hide.provider(async () => {
    hideQuickBar();
  });

  ipcBridge.quickBar.submitPrompt.provider(async ({ prompt, skillId }) => {
    hideQuickBar();
    const quickBarWin = getQuickBarWindow();
    const mainWindow = BrowserWindow.getAllWindows().find((win) => win !== quickBarWin);
    if (mainWindow && !mainWindow.isDestroyed()) {
      showAndFocusMainWindow(mainWindow);
    }
    return { success: true, data: true };
  });
}
