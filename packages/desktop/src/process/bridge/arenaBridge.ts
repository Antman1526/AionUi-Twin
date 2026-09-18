/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import { arenaCompletionClient } from '@process/services/arena/arenaCompletionClient';
import { cancelArenaRun, runArenaMatch } from '@process/services/arena/arenaService';

const MAX_PROMPT_LENGTH = 100_000;

function assertUsablePrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Arena prompt is empty');
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error('Arena prompt is too long');
  return prompt;
}

/** Bridge for the side-by-side model arena. */
export function initArenaBridge(): void {
  ipcBridge.arena.run.provider(async ({ left, right, prompt, systemPrompt }) => {
    try {
      const safePrompt = assertUsablePrompt(prompt);
      if (!left?.use_model || !right?.use_model) throw new Error('Both arena sides need a model');

      // The run id is minted here, never taken from the caller, so a renderer
      // cannot address or cancel a run it did not start.
      const runId = uuid(36);
      void runArenaMatch({
        runId,
        left,
        right,
        prompt: safePrompt,
        ...(systemPrompt ? { systemPrompt } : {}),
        complete: arenaCompletionClient,
        emit: (event) => ipcBridge.arena.stream.emit(event),
      }).catch((error: unknown) => {
        console.error('[arena] run failed:', error);
      });

      return { success: true, data: { runId } };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.arena.cancel.provider(async ({ runId }) => {
    if (typeof runId !== 'string' || !runId) return { success: false, msg: 'Invalid run id' };
    return { success: true, data: cancelArenaRun(runId) };
  });
}
