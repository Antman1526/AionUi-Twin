/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemHardwareMetrics } from '@/common/adapter/ipcBridge';

const metricsState = vi.hoisted(() => ({ current: null as SystemHardwareMetrics | null }));
const inferenceState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  enabledCalls: [] as boolean[],
}));

// The metrics hook is mocked so the test can drive "cloud-only / idle" versus
// "a local model server is running" without touching IPC or timers.
vi.mock('@renderer/components/layout/Titlebar/inferenceMetrics/useInferenceMetrics', () => ({
  useInferenceMetrics: (enabled: boolean) => {
    inferenceState.enabledCalls.push(enabled);
    return inferenceState.current;
  },
}));

// SWR dedupes across tests in one file, so the hardware sample is fed directly.
vi.mock('swr', () => ({
  default: () => ({ data: metricsState.current }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    systemMetrics: { getMetrics: { invoke: async () => ({ success: true, data: metricsState.current }) } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import HardwareHUD from '@renderer/components/layout/Titlebar/HardwareHUD';

const BASE_METRICS: SystemHardwareMetrics = {
  totalMemBytes: 64 * 1024 ** 3,
  freeMemBytes: 32 * 1024 ** 3,
  usedMemBytes: 32 * 1024 ** 3,
  cpuModel: 'Apple M3 Max',
  isAppleSilicon: true,
};

const UNIT = 'conversation.hud.tokensPerSecondUnit';

describe('HardwareHUD inference metrics', () => {
  beforeEach(() => {
    inferenceState.enabledCalls = [];
    inferenceState.current = { tokensPerSecond: null, estimated: false, streaming: false };
    metricsState.current = null;
  });

  it('shows no inference figures for a cloud-only / idle machine', () => {
    metricsState.current = BASE_METRICS;
    render(<HardwareHUD />);

    expect(screen.getByText('32.0/64.0 GB')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(UNIT))).toBeNull();
    // The polling hook is told to stay idle while no local engine is running.
    expect(inferenceState.enabledCalls.every((enabled) => enabled === false)).toBe(true);
  });

  it('keeps the figures hidden while a local server runs but no rate is derivable yet', () => {
    metricsState.current = {
      ...BASE_METRICS,
      activeLlama: { pid: 4242, alias: 'llama-3', modelPath: '/models/llama-3.gguf' },
    };
    render(<HardwareHUD />);

    expect(screen.queryByText(new RegExp(UNIT))).toBeNull();
    expect(inferenceState.enabledCalls).toContain(true);
  });

  it('shows a measured tokens/sec figure once a local model server is running', () => {
    metricsState.current = {
      ...BASE_METRICS,
      activeLlama: { pid: 4242, alias: 'llama-3', modelPath: '/models/llama-3.gguf' },
    };
    inferenceState.current = {
      tokensPerSecond: 42.5,
      estimated: false,
      streaming: true,
      contextSize: 8192,
      decodedTokens: 512,
    };

    render(<HardwareHUD />);

    expect(screen.getByText(`42.5 ${UNIT}`)).toBeInTheDocument();
    expect(screen.queryByText(`≈42.5 ${UNIT}`)).toBeNull();
  });

  it('prefixes an estimated rate with ≈ so it never reads as measured', () => {
    metricsState.current = {
      ...BASE_METRICS,
      activeLlama: { pid: 7, alias: 'mlx', modelPath: '/models/mlx' },
    };
    inferenceState.current = { tokensPerSecond: 12.34, estimated: true, streaming: true };

    render(<HardwareHUD />);

    expect(screen.getByText(`≈12.3 ${UNIT}`)).toBeInTheDocument();
  });
});
