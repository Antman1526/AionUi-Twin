/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { ArenaRunRequest, ArenaSide, ArenaSideStats, ArenaStreamEvent } from '@/common/adapter/ipcBridge';

/** Live state of one comparison column. */
export type ArenaColumnState = {
  text: string;
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  stats?: ArenaSideStats;
  error?: string;
};

const IDLE_COLUMN: ArenaColumnState = { text: '', status: 'idle' };

export type ArenaRunState = {
  left: ArenaColumnState;
  right: ArenaColumnState;
  /** True until both columns have finished. */
  running: boolean;
  /** Bridge-level failure that stopped the run from starting. */
  startError: string | null;
  start: (request: ArenaRunRequest) => Promise<void>;
  cancel: () => Promise<void>;
};

function nextColumn(column: ArenaColumnState, event: ArenaStreamEvent): ArenaColumnState {
  if (!event.done) return { ...column, text: column.text + (event.delta ?? ''), status: 'running' };
  const status = event.error ? (event.error === 'cancelled' ? 'cancelled' : 'error') : 'done';
  return { text: column.text, status, stats: event.stats, error: event.error };
}

/**
 * Drive one arena comparison: start it, collect both streams and expose the
 * per-column result. History is not persisted — it lives only in this state.
 *
 * Events that arrive before `arena.run` has returned its id are buffered and
 * replayed, so a fast first answer is never lost to the IPC round trip.
 */
export function useArenaRun(): ArenaRunState {
  const [columns, setColumns] = useState<Record<ArenaSide, ArenaColumnState>>({
    left: IDLE_COLUMN,
    right: IDLE_COLUMN,
  });
  const [running, setRunning] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const runId = useRef<string | null>(null);
  const pending = useRef<ArenaStreamEvent[]>([]);

  const apply = useCallback((event: ArenaStreamEvent) => {
    setColumns((current) => {
      const merged = { ...current, [event.side]: nextColumn(current[event.side], event) };
      if (merged.left.status !== 'running' && merged.right.status !== 'running') setRunning(false);
      return merged;
    });
  }, []);

  useEffect(() => {
    return ipcBridge.arena.stream.on((event) => {
      if (runId.current === null) {
        pending.current.push(event);
        return;
      }
      if (event.runId === runId.current) apply(event);
    });
  }, [apply]);

  const start = useCallback(
    async (request: ArenaRunRequest) => {
      setStartError(null);
      setColumns({ left: { text: '', status: 'running' }, right: { text: '', status: 'running' } });
      setRunning(true);
      runId.current = null;
      pending.current = [];
      const response = await ipcBridge.arena.run.invoke(request);
      if (!response.success || !response.data) {
        pending.current = [];
        setRunning(false);
        setColumns({ left: IDLE_COLUMN, right: IDLE_COLUMN });
        setStartError(response.msg ?? 'Failed to start');
        return;
      }
      runId.current = response.data.runId;
      const buffered = pending.current.filter((event) => event.runId === runId.current);
      pending.current = [];
      for (const event of buffered) apply(event);
    },
    [apply]
  );

  const cancel = useCallback(async () => {
    if (!runId.current) return;
    await ipcBridge.arena.cancel.invoke({ runId: runId.current });
  }, []);

  return { left: columns.left, right: columns.right, running, startError, start, cancel };
}
