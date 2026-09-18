/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type {
  HeldOutPrompt,
  SleepReviewConversation,
  SleepReviewProposal,
  SleepReviewTarget,
} from '@/common/types/sleepReview';

/** Shape every bridge provider answers with. */
type BridgeResult<T> = { success?: boolean; data?: T; msg?: string };

/** Unwrap a bridge response, turning `{ success: false }` into a thrown error. */
export function unwrap<T>(response: BridgeResult<T>): T {
  if (!response?.success) throw new Error(response?.msg || 'Request failed');
  return response.data as T;
}

export const useSleepReviewConversations = () =>
  useSWR<SleepReviewConversation[]>('sleep-review.conversations', async () =>
    unwrap(await ipcBridge.sleepReview.listConversations.invoke())
  );

export const useSleepReviewTargets = (workspace?: string) =>
  useSWR<SleepReviewTarget[]>(['sleep-review.targets', workspace ?? ''], async () =>
    unwrap(await ipcBridge.sleepReview.listTargets.invoke(workspace ? { workspace } : {}))
  );

export const useSleepReviewProposals = () =>
  useSWR<SleepReviewProposal[]>('sleep-review.proposals', async () =>
    unwrap(await ipcBridge.sleepReview.listProposals.invoke())
  );

export const useHeldOutPrompts = (workspace?: string) =>
  useSWR<HeldOutPrompt[]>(['sleep-review.held-out', workspace ?? ''], async () =>
    unwrap(await ipcBridge.sleepReview.listHeldOut.invoke(workspace ? { workspace } : {}))
  );
