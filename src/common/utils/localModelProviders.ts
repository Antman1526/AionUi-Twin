/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

export const LOCAL_OPENAI_COMPATIBLE_API_KEY = 'aionui-local-no-api-key';

/**
 * Local model directories commonly used on Antman's workstations.
 * AionUi connects to local model servers; these paths are retained as
 * discovery hints for launchers and future file-backed model integrations.
 */
export const DEFAULT_LOCAL_MODEL_DIRECTORIES = [
  '/Volumes/MainStore/Development/AI_Models',
  '/Users/Antman/Desktop/AI_Models',
] as const;

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
