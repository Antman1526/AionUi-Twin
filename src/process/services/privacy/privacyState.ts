/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * In-memory mirror of the persisted `privacy.privateMode` config value.
 *
 * Reading the persisted value is async (goes through the config storage
 * round trip), but call sites like the extension Hub and the WebUI server
 * need a synchronous, dependency-light check. `privacyBridge` keeps this
 * flag in sync with the persisted config at startup and on every toggle.
 */
let privateModeEnabled = false;

/** Current Private Mode state (defaults to false until privacyBridge initializes it). */
export const getPrivateModeEnabled = (): boolean => privateModeEnabled;

/** Update the in-memory Private Mode flag. Does not persist — callers handle that separately. */
export const setPrivateModeEnabled = (enabled: boolean): void => {
  privateModeEnabled = enabled;
};
