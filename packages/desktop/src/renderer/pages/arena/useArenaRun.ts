/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { ArenaSide, ArenaSideStats } from '@/common/adapter/ipcBridge';
import type { TProviderWithModel } from '@/common/config/storage';

export type ArenaSideState = {
  text: string;
  error?: string;
  stats?: ArenaSideStats;
  running: boolean;
};

export type ArenaHistoryEntry = {
  runId: string;
  prompt: string;
  leftLabel: string;
  rightLabel: string;
  leftStats?: ArenaSideStats;
  rightStats?: ArenaSideStats;
};

const idleSide = (): ArenaSideState => ({ text: '', running: false });

export type ArenaRunController = {
  left: ArenaSideState;
  right: ArenaSideState;
  running: boolean;
  startError?: string;
  history: ArenaHistoryEntry[];
  run: (params: {
    left: TProviderWithModel;
    right: TProviderWithModel;
    prompt: string;
    systemPrompt?: string;
    leftLabel: string;
    rightLabel: string;
  }) => Promise<void>;
  cancel: () => void;
};

/**
 * Drives one arena run. All state (including run history) lives here in the
 * renderer — nothing about an arena run is persisted.
 */
export const useArenaRun = (): ArenaRunController => {
  const [left, setLeft] = useState<ArenaSideState>(idleSide);
  const [right, setRight] = useState<ArenaSideState>(idleSide);
  const [startError, setStartError] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<ArenaHistoryEntry[]>([]);
  const runIdRef = useRef<string | null>(null);
  const labelsRef = useRef<{ left: string; right: string; prompt: string }>({ left: '', right: '', prompt: '' });

  const pendingStatsRef = useRef<{ left?: ArenaSideStats; right?: ArenaSideStats; done: Set<ArenaSide> }>({
    done: new Set(),
  });

  const recordIfComplete = useCallback((side: ArenaSide, stats?: ArenaSideStats): void => {
    const pending = pendingStatsRef.current;
    pending.done.add(side);
    if (stats) pending[side] = stats;
    if (pending.done.size < 2) return;

    const runId = runIdRef.current;
    if (!runId) return;
    const labels = labelsRef.current;
    const entry: ArenaHistoryEntry = {
      runId,
      prompt: labels.prompt,
      leftLabel: labels.left,
      rightLabel: labels.right,
      ...(pending.left ? { leftStats: pending.left } : {}),
      ...(pending.right ? { rightStats: pending.right } : {}),
    };
    setHistory((current) => [entry, ...current].slice(0, 20));
    runIdRef.current = null;
    pendingStatsRef.current = { done: new Set() };
  }, []);

  useEffect(() => {
    return ipcBridge.arena.stream.on((event) => {
      if (!runIdRef.current || event.runId !== runIdRef.current) return;
      const setSide = event.side === 'left' ? setLeft : setRight;
      setSide((current) => ({
        text: event.delta ? current.text + event.delta : current.text,
        running: event.done !== true,
        ...(event.error ? { error: event.error } : current.error ? { error: current.error } : {}),
        ...(event.stats ? { stats: event.stats } : current.stats ? { stats: current.stats } : {}),
      }));
      if (event.done) recordIfComplete(event.side, event.stats);
    });
  }, [recordIfComplete]);

  const run = useCallback<ArenaRunController['run']>(async (params) => {
    setStartError(undefined);
    setLeft({ text: '', running: true });
    setRight({ text: '', running: true });
    pendingStatsRef.current = { done: new Set() };
    labelsRef.current = { left: params.leftLabel, right: params.rightLabel, prompt: params.prompt };

    const res = await ipcBridge.arena.run.invoke({
      left: params.left,
      right: params.right,
      prompt: params.prompt,
      ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
    });

    if (!res.success || !res.data) {
      runIdRef.current = null;
      setLeft(idleSide());
      setRight(idleSide());
      setStartError(res.msg || 'Failed to start run');
      return;
    }
    runIdRef.current = res.data.runId;
  }, []);

  const cancel = useCallback(() => {
    const runId = runIdRef.current;
    if (!runId) return;
    void ipcBridge.arena.cancel.invoke({ runId });
  }, []);

  return {
    left,
    right,
    running: left.running || right.running,
    ...(startError ? { startError } : {}),
    history,
    run,
    cancel,
  };
};
