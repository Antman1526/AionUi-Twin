/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import { isLocalBaseUrl } from '@/common/utils/localModelProviders';

/** Id prefix of the app-managed llama.cpp provider. */
const MANAGED_LOCAL_PROVIDER_PREFIX = 'local-llama-cpp-';

/** Platforms that only ever serve models from the user's own machine. */
const LOCAL_PLATFORMS = new Set(['ollama', 'lmstudio', 'lm-studio', 'lm_studio']);

/**
 * Whether a provider may be used while Sleep Review runs in local-only mode.
 *
 * Local means one of: the app-managed llama.cpp provider, a known local runtime
 * platform (Ollama / LM Studio), or a loopback base URL.
 *
 * @param provider Provider entry from `model.config`.
 */
export function isLocalProviderForReview(provider: Pick<IProvider, 'id' | 'platform' | 'baseUrl'>): boolean {
  if (typeof provider.id === 'string' && provider.id.startsWith(MANAGED_LOCAL_PROVIDER_PREFIX)) return true;
  const platform = typeof provider.platform === 'string' ? provider.platform.toLowerCase() : '';
  if (LOCAL_PLATFORMS.has(platform)) return true;
  return isLocalBaseUrl(provider.baseUrl);
}
