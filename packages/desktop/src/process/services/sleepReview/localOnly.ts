/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isLocalBaseUrl } from '@/common/utils/localModelProviders';

/** The provider fields the local-only gate looks at. */
export type LocalOnlyCandidate = {
  name?: string;
  base_url?: string;
};

/**
 * True when `hostname` names this machine: a loopback address, `localhost`, or
 * a `*.localhost` alias. Anything else — including a LAN address — is remote
 * for the purposes of the local-only switch.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * True when a review may be sent to this provider with "Local only" on.
 *
 * Accepts the app-managed local runtimes (llama.cpp, Ollama, LM Studio — all of
 * which the app registers on a loopback port) and rejects every hosted API.
 */
export function isLocalOnlyProvider(provider: LocalOnlyCandidate): boolean {
  const baseUrl = provider?.base_url;
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return false;
  try {
    if (isLoopbackHost(new URL(baseUrl).hostname)) return true;
  } catch {
    return false;
  }
  // `isLocalBaseUrl` additionally treats the all-interfaces bind (`0.0.0.0`) as
  // local, which is how a user-started local server is sometimes configured.
  return isLocalBaseUrl(baseUrl);
}

/** Keep only the providers a local-only review is allowed to use. */
export function filterLocalOnlyProviders<T extends LocalOnlyCandidate>(providers: readonly T[]): T[] {
  return providers.filter((provider) => isLocalOnlyProvider(provider));
}

/** Throw unless `provider` is local. Called before any request leaves the app. */
export function assertLocalOnlyProvider(provider: LocalOnlyCandidate): void {
  if (!isLocalOnlyProvider(provider)) {
    throw new Error(`"Local only" is on: refusing to send transcripts to ${provider?.name || 'a remote provider'}`);
  }
}
