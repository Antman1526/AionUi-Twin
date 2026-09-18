/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { sampleRuntimeMetrics } from '@process/services/localModels/runtimeMetrics';

/** Expose live llama-server decode metrics to the renderer HUD. */
export function initLocalModelMetricsBridge(): void {
  ipcBridge.localModel.getRuntimeMetrics.provider(async () => {
    try {
      const metrics = await sampleRuntimeMetrics();
      return { success: true, data: metrics };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
