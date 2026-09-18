/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry consent.
 *
 * Crash reporting is opt-in: absent configuration means off. Ghost Mode (the
 * air-gapped network killswitch) always wins over an explicit opt-in, so a user
 * who has isolated the app cannot still be emitting Sentry traffic.
 */

export type TelemetryConsentInput = {
  /** `telemetry.enabled` from config. Undefined (never set) means "not consented". */
  telemetryEnabled?: boolean;
  /** Whether Ghost Mode is currently active. */
  ghostMode?: boolean;
};

/** True only when the user explicitly opted in and Ghost Mode is not isolating the app. */
export function isTelemetryAllowed(input: TelemetryConsentInput): boolean {
  if (input.ghostMode === true) return false;
  return input.telemetryEnabled === true;
}

/** The integration that starts a Sentry release-health session in the main process. */
export const MAIN_PROCESS_SESSION_INTEGRATION = 'MainProcessSession';

export type SentryIntegrationLike = { name?: string };

/**
 * Remove the release-health session integration from a default integration list.
 *
 * Generic so it satisfies the SDK's own `integrations` callback signature
 * without this module depending on Sentry's types.
 */
export function filterSessionIntegrations<T extends SentryIntegrationLike>(defaults: T[]): T[] {
  return (Array.isArray(defaults) ? defaults : []).filter(
    (integration) => integration?.name !== MAIN_PROCESS_SESSION_INTEGRATION
  );
}

export type SentryInitOptions = {
  dsn?: string;
  /**
   * Always false at init. `@sentry/electron` v7 (core v10) skips integration
   * setup entirely while `enabled === false`, so nothing — including release-health
   * sessions — is sent before consent is known. Consent flips this on the live
   * client afterwards.
   */
  enabled: false;
  /** Drops the session integration as belt-and-braces alongside `enabled: false`. */
  integrations: <T extends SentryIntegrationLike>(defaults: T[]) => T[];
};

/**
 * Sentry options that start fully inert.
 *
 * Note: this SDK version has no `autoSessionTracking` option — session lifecycle
 * is owned by the `MainProcessSession` integration, so that is what gets filtered.
 */
export function resolveSentryInitOptions(input: { dsn?: string }): SentryInitOptions {
  return {
    dsn: input.dsn,
    enabled: false,
    integrations: filterSessionIntegrations,
  };
}
