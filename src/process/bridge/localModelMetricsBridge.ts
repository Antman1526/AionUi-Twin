/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { collectRuntimeMetrics } from '@process/services/localModels/runtimeMetrics';

/**
 * Register the read-only `localModel.getRuntimeMetrics` handler used by the
 * chat inference HUD. Kept apart from `localModelBridge` because it only reads.
 */
export function initLocalModelMetricsBridge(): void {
  ipcBridge.localModel.getRuntimeMetrics.provider(async () => {
    try {
      return { success: true, data: await collectRuntimeMetrics() };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
