/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { LocalModelRuntimeMetrics } from '@/common/adapter/ipcBridge';
import { computeTokensPerSecond, type TokenSample } from './tokenRate';

/** Poll cadence while a reply is streaming. */
const STREAMING_POLL_MS = 2_000;
/** Poll cadence while the conversation is idle. */
const IDLE_POLL_MS = 10_000;
/** Silence after the last chunk before a reply counts as finished. */
const STREAM_IDLE_MS = 1_500;
/** Characters per token used when the server reports no counts. */
const CHARS_PER_TOKEN = 4;

/** What the HUD renders. */
export type InferenceStats = {
  /** Speed of the current or last reply, or null when not measurable yet. */
  tokensPerSecond: number | null;
  /** True when the speed came from reply length instead of the server's counter. */
  approximate: boolean;
  /** Tokens decoded by the active slot. */
  usedTokens: number | null;
  /** Slot context window (`n_ctx`). */
  contextSize: number | null;
  /** Resident memory of the llama-server process, in bytes. */
  rssBytes: number | null;
  /** True while a reply is arriving. */
  streaming: boolean;
};

const EMPTY_STATS: InferenceStats = {
  tokensPerSecond: null,
  approximate: false,
  usedTokens: null,
  contextSize: null,
  rssBytes: null,
  streaming: false,
};

/** Text carried by a `content` stream event, which may be a plain string or a rich object. */
function chunkText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && typeof (data as { content?: unknown }).content === 'string') {
    return (data as { content: string }).content;
  }
  return '';
}

/**
 * Live inference figures for the managed local model behind one conversation.
 *
 * Subscribes to the conversation response stream to know when a reply is in
 * flight, and polls `localModel.getRuntimeMetrics` every 2s while it is —
 * every 10s otherwise. Both stop when the hook unmounts or `enabled` goes false.
 *
 * Speed prefers the server's decoded-token counter and falls back to an
 * estimate from the reply's text length, flagged through `approximate`.
 *
 * @param params.conversationId Conversation whose stream to watch.
 * @param params.enabled False turns the hook into a no-op (no polling, no subscription).
 */
export function useInferenceStats(params: { conversationId?: string; enabled: boolean }): InferenceStats {
  const { conversationId, enabled } = params;
  const [streaming, setStreaming] = useState(false);
  const [metrics, setMetrics] = useState<LocalModelRuntimeMetrics | null>(null);
  const [rate, setRate] = useState<{ value: number; approximate: boolean } | null>(null);

  const realSamples = useRef<TokenSample[]>([]);
  // `computeTokensPerSecond` only ever reads the first and last entry, so an
  // ever-growing array here would mean an O(n) copy (and O(n²) over a whole
  // reply) for every streamed chunk. Two refs give the same rate for free.
  const approxFirstSample = useRef<TokenSample | null>(null);
  const approxLastSample = useRef<TokenSample | null>(null);
  const lastApproxRateAt = useRef(0);
  const replyChars = useRef(0);
  const activeMsgId = useRef<string | null>(null);

  // Watch the stream so the HUD knows when a reply starts, grows and ends.
  useEffect(() => {
    if (!enabled || !conversationId) return;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const markIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setStreaming(false), STREAM_IDLE_MS);
    };

    const unsubscribe = ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversationId) return;
      if (message.type === 'finish' || message.type === 'error') {
        if (idleTimer) clearTimeout(idleTimer);
        setStreaming(false);
        return;
      }
      if (message.type !== 'content') return;

      if (message.msg_id !== activeMsgId.current) {
        activeMsgId.current = message.msg_id;
        replyChars.current = 0;
        realSamples.current = [];
        approxFirstSample.current = null;
        approxLastSample.current = null;
        lastApproxRateAt.current = 0;
        setRate(null);
      }
      replyChars.current += chunkText(message.data).length;
      const now = Date.now();
      const sample: TokenSample = { at: now, tokens: replyChars.current / CHARS_PER_TOKEN };
      if (!approxFirstSample.current) approxFirstSample.current = sample;
      approxLastSample.current = sample;
      setStreaming(true);
      // Recomputing and re-rendering on every chunk (which can arrive many times
      // a second) buys nothing — the rate only changes meaningfully on the order
      // of the real-metrics poll cadence, so coalesce to the same rhythm.
      if (now - lastApproxRateAt.current >= STREAMING_POLL_MS) {
        lastApproxRateAt.current = now;
        setRate((current) => {
          const approximate =
            approxFirstSample.current && approxLastSample.current
              ? computeTokensPerSecond([approxFirstSample.current, approxLastSample.current])
              : null;
          // A real counter reading always wins; only fill in while it has none.
          if (current && !current.approximate) return current;
          return approximate === null ? current : { value: approximate, approximate: true };
        });
      }
      markIdle();
    });

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      unsubscribe();
    };
  }, [conversationId, enabled]);

  // Poll runtime metrics, faster while a reply is streaming.
  useEffect(() => {
    if (!enabled) {
      setMetrics(null);
      return;
    }
    let cancelled = false;

    const sample = async () => {
      const response = await ipcBridge.localModel.getRuntimeMetrics.invoke();
      if (cancelled) return;
      if (!response.success || !response.data) return;
      const data = response.data;
      setMetrics(data);
      if (data.decodedTokens === undefined) return;
      const previous = realSamples.current;
      const last = previous[previous.length - 1];
      // A counter that went backwards belongs to a new request.
      const series = last && data.decodedTokens < last.tokens ? [] : previous;
      realSamples.current = [...series, { at: data.sampledAt, tokens: data.decodedTokens }];
      const value = computeTokensPerSecond(realSamples.current);
      if (value !== null) setRate({ value, approximate: false });
    };

    void sample();
    const timer = setInterval(() => void sample(), streaming ? STREAMING_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, streaming]);

  if (!enabled) return EMPTY_STATS;
  return {
    tokensPerSecond: rate?.value ?? null,
    approximate: rate?.approximate ?? false,
    usedTokens: metrics?.decodedTokens ?? null,
    contextSize: metrics?.contextSize ?? null,
    rssBytes: metrics?.rssBytes ?? null,
    streaming,
  };
}
