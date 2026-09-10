/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { app, BrowserWindow, globalShortcut, screen } from 'electron';

let quickBarWin: BrowserWindow | null = null;

export function getQuickBarWindow(): BrowserWindow | null {
  return quickBarWin;
}

export function createQuickBarWindow(): BrowserWindow {
  if (quickBarWin && !quickBarWin.isDestroyed()) {
    return quickBarWin;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const width = 640;
  const height = 400;
  const x = Math.round((screenWidth - width) / 2);
  const y = Math.round(screenHeight * 0.18);

  quickBarWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'under-window',
          visualEffectState: 'active',
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const fallbackFile = path.join(__dirname, '../renderer/index.html');

  if (!app.isPackaged && rendererUrl) {
    void quickBarWin.loadURL(`${rendererUrl}#/quickbar`);
  } else {
    void quickBarWin.loadFile(fallbackFile, { hash: '/quickbar' });
  }

  quickBarWin.on('blur', () => {
    if (quickBarWin && !quickBarWin.isDestroyed() && quickBarWin.isVisible()) {
      quickBarWin.hide();
    }
  });

  return quickBarWin;
}

export function toggleQuickBar(): void {
  if (!quickBarWin || quickBarWin.isDestroyed()) {
    createQuickBarWindow();
  }

  if (quickBarWin) {
    if (quickBarWin.isVisible()) {
      quickBarWin.hide();
    } else {
      quickBarWin.show();
      quickBarWin.focus();
    }
  }
}

export function hideQuickBar(): void {
  if (quickBarWin && !quickBarWin.isDestroyed() && quickBarWin.isVisible()) {
    quickBarWin.hide();
  }
}

export function registerQuickBarShortcut(): void {
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      toggleQuickBar();
    });
  } catch (err) {
    console.warn('[QuickBar] Failed to register global shortcut:', err);
  }
}
