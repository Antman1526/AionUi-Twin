/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import { isLocalBaseUrl } from './localModelProviders';

/**
 * Prefix used for the app-managed local llama.cpp providers created for
 * on-device models (see MANAGED_LOCAL_PROVIDER_PREFIX in
 * src/renderer/pages/guid/hooks/useGuidModelSelection.ts).
 */
const MANAGED_LOCAL_PROVIDER_PREFIX = 'local-llama-cpp-';

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d|0)';
const IPV4_REGEX = new RegExp(`^${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}$`);

/**
 * True for a dotted-quad IPv4 address in one of the private/LAN ranges:
 * 10.0.0.0/8, 172.16.0.0/12, or 192.168.0.0/16.
 */
function isPrivateLanIPv4(host: string): boolean {
  if (!IPV4_REGEX.test(host)) return false;
  const octets = host.split('.').map(Number);
  const a = octets[0];
  const b = octets[1];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * True when `baseUrl` points at a loopback address (localhost, 127.0.0.0/8,
 * ::1, 0.0.0.0), a private LAN range (10/8, 172.16/12, 192.168/16), or an
 * mDNS `*.local` host. Reuses the loopback check already used for local
 * OpenAI-compatible providers and extends it with LAN ranges.
 */
export function isLoopbackOrLanHost(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  if (isLocalBaseUrl(baseUrl)) return true;
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    if (host.toLowerCase().endsWith('.local')) return true;
    return isPrivateLanIPv4(host);
  } catch {
    return false;
  }
}

/**
 * True when `provider` runs locally: the app-managed local llama.cpp
 * provider, a provider explicitly identified as Ollama/LM Studio, or a
 * provider whose base URL resolves to a loopback/LAN host. Used to restrict
 * model selectors to local-only providers in Private Mode.
 */
export function isLocalProvider(provider: Pick<IProvider, 'id' | 'platform' | 'baseUrl'> | undefined | null): boolean {
  if (!provider) return false;
  if (provider.id?.startsWith(MANAGED_LOCAL_PROVIDER_PREFIX)) return true;
  if (provider.platform === 'ollama' || provider.platform === 'lmstudio') return true;
  return isLoopbackOrLanHost(provider.baseUrl);
}

/** Minimal config shape read by isTelemetryAllowed — matches the persisted storage keys. */
export type TelemetryPrivacyConfig = {
  'telemetry.enabled'?: boolean;
  'privacy.privateMode'?: boolean;
};

/**
 * Telemetry requires explicit opt-in (`telemetry.enabled === true`) and is
 * always disabled while Private Mode is on, regardless of the opt-in value.
 */
export function isTelemetryAllowed(config: TelemetryPrivacyConfig): boolean {
  return config['telemetry.enabled'] === true && config['privacy.privateMode'] !== true;
}

/**
 * Builds a Sentry `beforeSend`/`beforeSendTransaction` hook that drops every
 * event unless telemetry is currently allowed. `getTelemetryEnabled` is read
 * lazily (rather than captured once) so the gate reflects config loaded after
 * `Sentry.init()` runs at import time.
 */
export function createTelemetryGate(getTelemetryEnabled: () => boolean) {
  return function telemetryGate<T>(event: T): T | null {
    return getTelemetryEnabled() ? event : null;
  };
}

/**
 * Whether the WebUI server should attempt a public-IP lookup: never while
 * Private Mode is on (no network egress), and only when remote access is
 * actually enabled (no point exposing a public IP nobody can reach).
 */
export function shouldLookupPublicIp(params: { privateMode?: boolean; remoteAccessEnabled?: boolean }): boolean {
  if (params.privateMode) return false;
  return params.remoteAccessEnabled === true;
}

/** Minimal shape of a `@sentry/core` integration — only the field this module reads. */
export interface SentryIntegrationLike {
  name: string;
}

/** Options this module hands to `Sentry.init()`. Kept minimal and structurally typed so callers
 * don't need to import `@sentry/electron` types into this shared, dependency-light module. */
export interface SentryInitOptions {
  dsn?: string;
  enabled: boolean;
  integrations: (defaults: SentryIntegrationLike[]) => SentryIntegrationLike[];
}

/**
 * Builds the options passed to `Sentry.init()` so no session or event envelope can leave the
 * machine before the telemetry gate (see `isTelemetryAllowed`) resolves to `true` after config
 * loads.
 *
 * `enabled: false` disables the client entirely at init time (belt-and-braces alongside the
 * `beforeSend`/`beforeSendTransaction` gate, which only filters events — it does not stop a
 * session envelope). The installed `@sentry/electron` (checked in `node_modules/@sentry/electron`,
 * currently 7.10.x) has no `autoSessionTracking` option — it was removed in v6.0.0 in favor of
 * filtering out the `MainProcessSession` integration, which otherwise calls
 * `sessions.startSession()` synchronously during `Sentry.init()`, before the telemetry gate is
 * known. `integrations` here drops that integration so no session is started at import time;
 * callers re-enable the client (and start a session manually) once telemetry is confirmed allowed.
 */
export function resolveSentryInitOptions({ dsn }: { dsn?: string }): SentryInitOptions {
  return {
    dsn,
    enabled: false,
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'MainProcessSession'),
  };
}
