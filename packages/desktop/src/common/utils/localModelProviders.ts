/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

export const LOCAL_OPENAI_COMPATIBLE_API_KEY = 'aionui-local-no-api-key';

/**
 * Normalize a user-provided list of model directories: trim, drop empties, and
 * de-duplicate while preserving order. Returns an empty array for invalid input.
 */
export function normalizeModelDirectories(directories?: readonly string[]): string[] {
  if (!Array.isArray(directories)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of directories) {
    const trimmed = typeof entry === 'string' ? entry.trim() : '';
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Resolve the effective local model directories: the user's configured list when
 * it has any valid entries, otherwise the provided defaults (both normalized).
 *
 * Defaults are passed in by the caller — the process layer derives them from
 * standard, machine-agnostic locations — so this shared module stays free of
 * Node/platform APIs and hardcoded paths.
 */
export function resolveModelDirectories(configured?: readonly string[], defaults?: readonly string[]): string[] {
  const normalized = normalizeModelDirectories(configured);
  return normalized.length > 0 ? normalized : normalizeModelDirectories(defaults);
}

export function getFirstApiKey(apiKeys?: string): string {
  return (
    apiKeys
      ?.split(/[,\n]/)
      .map((key) => key.trim())
      .find((key) => key.length > 0) ?? ''
  );
}

export function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;

  try {
    const url = new URL(baseUrl);
    return LOCAL_HOSTNAMES.has(url.hostname) || LOCAL_HOSTNAMES.has(url.host);
  } catch {
    return false;
  }
}

export function supportsNoApiKeyForOpenAICompatibleProvider(baseUrl?: string): boolean {
  return isLocalBaseUrl(baseUrl);
}

export function getApiKeyForModelList(apiKeys?: string, baseUrl?: string): string {
  const firstKey = getFirstApiKey(apiKeys);
  if (firstKey) return firstKey;

  return supportsNoApiKeyForOpenAICompatibleProvider(baseUrl) ? LOCAL_OPENAI_COMPATIBLE_API_KEY : '';
}

export function getApiKeysForOpenAICompatibleClient(apiKeys?: string, baseUrl?: string): string {
  if (apiKeys?.trim()) return apiKeys;

  return supportsNoApiKeyForOpenAICompatibleProvider(baseUrl) ? LOCAL_OPENAI_COMPATIBLE_API_KEY : '';
}
