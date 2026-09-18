/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Select } from '@arco-design/web-react';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { isLocalBaseUrl } from '@/common/utils/localModelProviders';

const SEPARATOR = '::';

/** Stable option value for one provider/model pair. */
export const modelKey = (providerId: string, model: string): string => `${providerId}${SEPARATOR}${model}`;

/** Resolve an option value back to the provider it came from. */
export function resolveModel(providers: IProvider[], key: string | undefined): TProviderWithModel | undefined {
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

type ModelPickerProps = {
  providers: IProvider[];
  value?: string;
  placeholder: string;
  /** Hide every provider the process layer would refuse under "Local only". */
  localOnly: boolean;
  onChange: (key: string) => void;
};

/** Provider·model picker. Mirrors the process-side local-only gate in the UI. */
const ModelPicker: React.FC<ModelPickerProps> = ({ providers, value, placeholder, localOnly, onChange }) => {
  const options = useMemo(
    () =>
      providers
        .filter((provider) => !localOnly || isLocalBaseUrl(provider.base_url))
        .flatMap((provider) =>
          (provider.models ?? []).map((model) => ({
            value: modelKey(provider.id, model),
            label: `${provider.name} · ${model}`,
          }))
        ),
    [providers, localOnly]
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

export default ModelPicker;
