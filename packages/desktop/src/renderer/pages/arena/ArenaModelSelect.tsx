/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Select } from '@arco-design/web-react';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';

const SEPARATOR = '::';

/** Stable option value for a provider/model pair. */
export const arenaModelKey = (providerId: string, model: string): string => `${providerId}${SEPARATOR}${model}`;

/** Human label used in the selector, the stats footer and the copied comparison. */
export const arenaModelLabel = (provider: TProviderWithModel): string => `${provider.name} · ${provider.use_model}`;

/** Resolve an option value back to the provider it came from. */
export function resolveArenaModel(providers: IProvider[], key: string | undefined): TProviderWithModel | undefined {
  if (!key) return undefined;
  const separatorIndex = key.indexOf(SEPARATOR);
  if (separatorIndex < 0) return undefined;
  const providerId = key.slice(0, separatorIndex);
  const model = key.slice(separatorIndex + SEPARATOR.length);
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider || !provider.models?.includes(model)) return undefined;
  const { models: _models, ...rest } = provider;
  return { ...rest, use_model: model };
}

type ArenaModelSelectProps = {
  providers: IProvider[];
  value?: string;
  placeholder: string;
  onChange: (key: string) => void;
};

/** Flat provider·model picker shared by both arena columns. */
const ArenaModelSelect: React.FC<ArenaModelSelectProps> = ({ providers, value, placeholder, onChange }) => {
  const options = useMemo(
    () =>
      providers.flatMap((provider) =>
        (provider.models ?? []).map((model) => ({
          value: arenaModelKey(provider.id, model),
          label: `${provider.name} · ${model}`,
        }))
      ),
    [providers]
  );

  return (
    <Select
      showSearch
      allowClear={false}
      placeholder={placeholder}
      value={value}
      options={options}
      onChange={onChange}
    />
  );
};

export default ArenaModelSelect;
