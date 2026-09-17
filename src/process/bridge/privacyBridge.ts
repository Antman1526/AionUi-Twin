/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 隐私设置桥接模块
 * Privacy Settings Bridge Module
 *
 * 负责持久化 Private Mode 开关，并同步内存态标志位供 Hub/WebUI 等
 * 主进程模块同步读取（避免每次都走配置存储的异步往返）。
 * Persists the Private Mode toggle and keeps the in-memory flag (read
 * synchronously by the extension Hub and the WebUI server) up to date.
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/utils/initStorage';
import { setPrivateModeEnabled } from '@process/services/privacy/privacyState';

export function initPrivacyBridge(): void {
  // Prime the in-memory flag from the persisted value at startup.
  ProcessConfig.get('privacy.privateMode')
    .then((enabled) => setPrivateModeEnabled(enabled === true))
    .catch(() => setPrivateModeEnabled(false));

  ipcBridge.privacy.getPrivateMode.provider(async () => {
    const enabled = await ProcessConfig.get('privacy.privateMode');
    return enabled === true;
  });

  ipcBridge.privacy.setPrivateMode.provider(async ({ enabled }) => {
    await ProcessConfig.set('privacy.privateMode', enabled);
    setPrivateModeEnabled(enabled);
  });
}
