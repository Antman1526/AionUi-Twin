/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getHfModelDetails, searchHfModels } from '@process/services/hfHub/hfModelHubService';
import {
  cancelModelDownload,
  getActiveDownloads,
  startModelDownload,
} from '@process/services/hfHub/modelDownloadManager';

export function initHfHubBridge(): void {
  ipcBridge.hfHub.searchModels.provider(async ({ query, type, limit }) => {
    try {
      const results = await searchHfModels({ query, type, limit });
      return { success: true, data: results };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.hfHub.getModelDetails.provider(async ({ modelId }) => {
    try {
      const details = await getHfModelDetails(modelId);
      return { success: true, data: details };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.hfHub.startDownload.provider(async ({ modelId, fileName, isMlx }) => {
    try {
      const result = await startModelDownload({ modelId, fileName, isMlx });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.hfHub.cancelDownload.provider(async ({ downloadId }) => {
    try {
      const cancelled = cancelModelDownload(downloadId);
      return { success: true, data: cancelled };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.hfHub.getDownloads.provider(async () => {
    try {
      return { success: true, data: getActiveDownloads() };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
