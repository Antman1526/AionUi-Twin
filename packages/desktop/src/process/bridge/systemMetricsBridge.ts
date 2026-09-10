/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { evaluateModelHardwareFit, getSystemHardwareMetrics } from '@process/services/system/systemMetricsService';

export function initSystemMetricsBridge(): void {
  ipcBridge.systemMetrics.getMetrics.provider(async () => {
    try {
      const metrics = getSystemHardwareMetrics();
      return { success: true, data: metrics };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.systemMetrics.evaluateFit.provider(async ({ modelSizeBytes, contextSize }) => {
    try {
      const assessment = evaluateModelHardwareFit(modelSizeBytes, contextSize);
      return { success: true, data: assessment };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
