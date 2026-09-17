/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import { createArenaClient } from '@process/services/arena/arenaClients';
import { runArena, type ArenaRun } from '@process/services/arena/runArena';
import { ProcessConfig } from '@process/utils/initStorage';

/** Comparisons still in flight, so `arena.cancel` can reach them. */
const activeRuns = new Map<string, ArenaRun>();

async function getProviders(): Promise<IProvider[]> {
  const stored = await ProcessConfig.get('model.config');
  return Array.isArray(stored) ? stored : [];
}

/** Register every `arena.*` IPC handler. */
export function initArenaBridge(): void {
  ipcBridge.arena.run.provider(async (request) => {
    if (!request.prompt.trim()) return { success: false, msg: 'Prompt is empty' };
    try {
      const providers = await getProviders();
      const runId = randomUUID();
      const run = runArena(
        { ...request, runId },
        {
          createClient: (ref) => createArenaClient(providers, ref),
          emit: (event) => ipcBridge.arena.stream.emit(event),
        }
      );
      activeRuns.set(runId, run);
      void run.completed.finally(() => activeRuns.delete(runId));
      return { success: true, data: { runId } };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.arena.cancel.provider(async ({ runId }) => {
    const run = activeRuns.get(runId);
    if (!run) return { success: false, msg: `No comparison in progress for "${runId}"` };
    run.cancel();
    return { success: true, data: undefined };
  });
}
