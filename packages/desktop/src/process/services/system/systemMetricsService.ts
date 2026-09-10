/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import type { ModelFitAssessment, SystemHardwareMetrics } from '@/common/adapter/ipcBridge';
import { getManagedServerStatus } from '@process/services/localModels/LocalModelRuntimeService';

/** Estimate KV cache overhead in bytes based on context size. */
export function estimateKvCacheBytes(contextSize: number = 4096): number {
  // Baseline: ~128KB per token context window
  return Math.max(contextSize * 131_072, 268_435_456); // Min 256MB
}

/** Check if current machine is an Apple Silicon Mac. */
export function isAppleSiliconMac(): boolean {
  return process.platform === 'darwin' && (process.arch === 'arm64' || os.cpus()[0]?.model?.includes('Apple'));
}

/** Get live hardware and local model telemetry. */
export function getSystemHardwareMetrics(): SystemHardwareMetrics {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : undefined;
  const isApple = isAppleSiliconMac();

  const activeServer = getManagedServerStatus();
  let activeLlama: SystemHardwareMetrics['activeLlama'];

  if (activeServer && activeServer.pid) {
    activeLlama = {
      pid: activeServer.pid,
      alias: activeServer.alias ?? 'llama-server',
      modelPath: activeServer.modelPath ?? '',
    };
  }

  return {
    totalMemBytes: totalMem,
    freeMemBytes: freeMem,
    usedMemBytes: usedMem,
    cpuModel,
    isAppleSilicon: isApple,
    activeLlama,
  };
}

/** Evaluate how comfortably a model will run on the current system. */
export function evaluateModelHardwareFit(modelSizeBytes: number, contextSize?: number): ModelFitAssessment {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const kvOverhead = estimateKvCacheBytes(contextSize ?? 4096);
  const requiredRam = modelSizeBytes + kvOverhead;
  const ratio = requiredRam / totalMem;

  if (ratio <= 0.7) {
    return {
      level: 'optimal',
      requiredRamBytes: requiredRam,
      availableRamBytes: freeMem,
      ratio,
      description: isAppleSiliconMac()
        ? 'Optimal: Model fits 100% into Apple Silicon Unified Memory with full GPU acceleration.'
        : 'Optimal: Model fits comfortably in available system RAM.',
    };
  }

  if (ratio <= 0.92) {
    return {
      level: 'partial',
      requiredRamBytes: requiredRam,
      availableRamBytes: freeMem,
      ratio,
      description: isAppleSiliconMac()
        ? 'Tight: Fits into Unified Memory, but may require closing background applications.'
        : 'Tight: High memory pressure; model may experience occasional swap.',
    };
  }

  return {
    level: 'exceeded',
    requiredRamBytes: requiredRam,
    availableRamBytes: freeMem,
    ratio,
    description: isAppleSiliconMac()
      ? 'Exceeded: Model size exceeds safe Unified Memory limit. Running this model will cause severe swap.'
      : 'Exceeded: Model size exceeds physical system RAM.',
  };
}
