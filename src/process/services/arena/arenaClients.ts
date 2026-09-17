/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientFactory } from '@/common/api/ClientFactory';
import type { ArenaModelRef } from '@/common/adapter/ipcBridge';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { ArenaChatClient } from './runArena';

/**
 * Bind a configured provider to the model one arena side should use.
 *
 * @throws When no provider carries `ref.providerId`.
 */
export function resolveArenaProvider(providers: IProvider[], ref: ArenaModelRef): TProviderWithModel {
  const provider = providers.find((item) => item.id === ref.providerId);
  if (!provider) throw new Error(`Provider not found: ${ref.providerId}`);
  const { model: _model, ...rest } = provider;
  return { ...rest, useModel: ref.model };
}

/**
 * Build a chat client for one arena side through the app's rotating client stack.
 *
 * @returns A client narrowed to the OpenAI-shaped call every implementation accepts.
 */
export async function createArenaClient(providers: IProvider[], ref: ArenaModelRef): Promise<ArenaChatClient> {
  const provider = resolveArenaProvider(providers, ref);
  return (await ClientFactory.createRotatingClient(provider)) as unknown as ArenaChatClient;
}
