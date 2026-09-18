/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { computeTokensPerSecond, type DecodeSample } from './tokensPerSecond';

/** Poll cadence while a reply is streaming. */
const STREAMING_POLL_MS = 2000;
/** Poll cadence when nothing is streaming. */
const IDLE_POLL_MS = 10_000;
/** A stream with no frame for this long is treated as finished. */
const STREAM_QUIET_MS = 2000;
/** Characters per token used only for the labelled estimate fallback. */
const CHARS_PER_TOKEN = 4;

export type InferenceMetricsState = {
  /** Tokens per second, or null while it is not yet derivable. */
  tokensPerSecond: number | null;
  /** True when `tokensPerSecond` came from reply length rather than the engine's counter. */
  estimated: boolean;
  /** Engine context window (`n_ctx`). */
  contextSize?: number;
  /** Tokens decoded in the current generation. */
  decodedTokens?: number;
  /** Resident set size of the engine process, in bytes. */
  rssBytes?: number;
  /** True while a reply is streaming into the app. */
  streaming: boolean;
};

const EMPTY_STATE: InferenceMetricsState = { tokensPerSecond: null, estimated: false, streaming: false };

/** Pull the plain text out of a response-stream frame (string or `{ content }`). */
function extractFrameText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && typeof (data as { content?: unknown }).content === 'string') {
    return (data as { content: string }).content;
  }
  return '';
}

type StreamTracker = {
  msgId?: string;
  chars: number;
  startedAt: number;
  lastFrameAt: number;
  finished: boolean;
};

/**
 * Live decode metrics for the titlebar HUD.
 *
 * Polls the managed local model server at {@link STREAMING_POLL_MS} while a
 * reply is streaming and {@link IDLE_POLL_MS} otherwise, holds only the first
 * and last decode sample, and publishes React state once per poll so stream
 * chunks never trigger a re-render. Does nothing at all while `enabled` is
 * false (no local engine running).
 */
export function useInferenceMetrics(enabled: boolean): InferenceMetricsState {
  const [state, setState] = useState<InferenceMetricsState>(EMPTY_STATE);
  const streamRef = useRef<StreamTracker>({ chars: 0, startedAt: 0, lastFrameAt: 0, finished: true });
  const firstSampleRef = useRef<DecodeSample | null>(null);
  const lastSampleRef = useRef<DecodeSample | null>(null);

  // Stream detection: mutate a ref only, never state — a chunk must not render.
  useEffect(() => {
    if (!enabled) return;
    return ipcBridge.conversation.responseStream.on((message: IResponseMessage) => {
      if (message.type !== 'text' && message.type !== 'content') return;
      if (message.position === 'right') return;

      const tracker = streamRef.current;
      const now = Date.now();
      if (tracker.msgId !== message.msg_id) {
        tracker.msgId = message.msg_id;
        tracker.chars = 0;
        tracker.startedAt = now;
      }
      const text = extractFrameText(message.data);
      tracker.chars = message.replace === true ? text.length : tracker.chars + text.length;
      tracker.lastFrameAt = now;
      tracker.finished = message.status === 'finish';
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      firstSampleRef.current = null;
      lastSampleRef.current = null;
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async (): Promise<void> => {
      const tracker = streamRef.current;
      const now = Date.now();
      const streaming = !tracker.finished && now - tracker.lastFrameAt < STREAM_QUIET_MS;

      const res = await ipcBridge.localModel.getRuntimeMetrics.invoke();
      if (cancelled) return;
      const metrics = res.success ? res.data : undefined;

      const decodedTokens = metrics?.decodedTokens;
      if (decodedTokens === undefined) {
        firstSampleRef.current = null;
        lastSampleRef.current = null;
      } else {
        const sample: DecodeSample = { sampledAt: metrics?.sampledAt ?? now, decodedTokens };
        const previous = lastSampleRef.current;
        if (!firstSampleRef.current || (previous && decodedTokens < previous.decodedTokens)) {
          // First reading, or the engine started a new generation and reset its
          // counter — start a fresh window rather than reporting a negative rate.
          firstSampleRef.current = sample;
        }
        lastSampleRef.current = sample;
      }

      const measured =
        firstSampleRef.current && lastSampleRef.current
          ? computeTokensPerSecond([firstSampleRef.current, lastSampleRef.current])
          : null;

      let tokensPerSecond = measured;
      let estimated = false;
      if (tokensPerSecond === null && streaming && tracker.chars > 0 && tracker.startedAt > 0) {
        const elapsedMs = now - tracker.startedAt;
        if (elapsedMs > 0) {
          tokensPerSecond = (tracker.chars / CHARS_PER_TOKEN / elapsedMs) * 1000;
          estimated = true;
        }
      }

      setState({
        tokensPerSecond,
        estimated,
        streaming,
        ...(metrics?.contextSize !== undefined ? { contextSize: metrics.contextSize } : {}),
        ...(decodedTokens !== undefined ? { decodedTokens } : {}),
        ...(metrics?.rssBytes !== undefined ? { rssBytes: metrics.rssBytes } : {}),
      });

      if (cancelled) return;
      timer = setTimeout(() => void tick(), streaming ? STREAMING_POLL_MS : IDLE_POLL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return state;
}
