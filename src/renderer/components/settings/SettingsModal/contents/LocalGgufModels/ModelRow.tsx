/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalModelInfo } from '@/common/adapter/ipcBridge';
import type { LocalModelRuntimeOptions } from '@/common/config/storage';
import { Button, Tag, Tooltip } from '@arco-design/web-react';
import { Play, Power, SettingTwo } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import RuntimeOptionsPanel from './RuntimeOptionsPanel';
import { formatBytes, formatContext } from './formatBytes';

/** Arco tag colour per fit verdict. */
const FIT_COLORS = { fits: 'green', tight: 'orange', wontFit: 'red' } as const;
const FIT_LABELS = {
  fits: 'settings.localGguf.fitFits',
  tight: 'settings.localGguf.fitTight',
  wontFit: 'settings.localGguf.fitWontFit',
} as const;

export type ModelRowProps = {
  model: { path: string; name: string; sizeBytes: number };
  isRunning: boolean;
  isBusy: boolean;
  loadDisabled: boolean;
  optionsExpanded: boolean;
  options: LocalModelRuntimeOptions;
  onToggleOptions: () => void;
  onPatchOptions: (patch: LocalModelRuntimeOptions) => void;
  onLoad: () => void;
  onUnload: () => void;
  onUseInChat: () => void;
};

/**
 * One discovered GGUF model: name, size, GGUF facts (quantisation, parameter
 * label, trained context), a memory-fit badge and the load/unload controls.
 *
 * Header parsing happens lazily through `localModel.getModelInfo` so the
 * directory scan itself stays fast.
 */
const ModelRow: React.FC<ModelRowProps> = ({
  model,
  isRunning,
  isBusy,
  loadDisabled,
  optionsExpanded,
  options,
  onToggleOptions,
  onPatchOptions,
  onLoad,
  onUnload,
  onUseInChat,
}) => {
  const { t } = useTranslation();
  const { data: info } = useSWR<LocalModelInfo | null>(['local-model.info', model.path], async () => {
    const res = await ipcBridge.localModel.getModelInfo.invoke({ modelPath: model.path });
    return res.success ? (res.data ?? null) : null;
  });

  const metadata = info?.metadata;
  const fit = info?.fit;

  return (
    <div className='rounded-6px border-1px border-solid border-[var(--color-border-2)] overflow-hidden'>
      <div className='flex items-center justify-between gap-8px px-12px py-8px'>
        <div className='flex items-center gap-6px min-w-0 flex-wrap'>
          <span className='truncate text-13px'>{model.name}</span>
          <Tag size='small' color='gray'>
            {formatBytes(model.sizeBytes)}
          </Tag>
          {metadata?.quantization ? (
            <Tooltip content={t('settings.localGguf.quantization')}>
              <Tag size='small' color='arcoblue'>
                {metadata.quantization}
              </Tag>
            </Tooltip>
          ) : null}
          {metadata?.sizeLabel ? (
            <Tooltip content={t('settings.localGguf.parameters')}>
              <Tag size='small' color='gray'>
                {metadata.sizeLabel}
              </Tag>
            </Tooltip>
          ) : null}
          {metadata?.contextLength ? (
            <Tooltip content={t('settings.localGguf.trainedContext')}>
              <Tag size='small' color='gray'>
                {formatContext(metadata.contextLength)}
              </Tag>
            </Tooltip>
          ) : null}
          {fit ? (
            <Tooltip content={t('settings.localGguf.fitEstimate', { size: formatBytes(fit.requiredBytes) })}>
              <Tag size='small' color={FIT_COLORS[fit.verdict]}>
                {t(FIT_LABELS[fit.verdict])}
              </Tag>
            </Tooltip>
          ) : null}
          {isRunning ? (
            <Tag size='small' color='green'>
              {t('settings.localGguf.running')}
            </Tag>
          ) : null}
        </div>
        <div className='flex items-center gap-6px shrink-0'>
          <Tooltip content={t('settings.localGguf.advancedOptions')}>
            <Button size='mini' type='text' icon={<SettingTwo theme='outline' size='14' />} onClick={onToggleOptions} />
          </Tooltip>
          {isRunning ? (
            <>
              <Button size='mini' type='primary' onClick={onUseInChat}>
                {t('settings.localGguf.useInChat')}
              </Button>
              <Button
                size='mini'
                status='danger'
                icon={<Power theme='outline' size='14' />}
                loading={isBusy}
                onClick={onUnload}
              >
                {t('settings.localGguf.unload')}
              </Button>
            </>
          ) : (
            <Button
              size='mini'
              type='primary'
              icon={<Play theme='outline' size='14' />}
              loading={isBusy}
              disabled={loadDisabled}
              onClick={onLoad}
            >
              {isBusy ? t('settings.localGguf.loadingState') : t('settings.localGguf.load')}
            </Button>
          )}
        </div>
      </div>
      {optionsExpanded ? (
        <RuntimeOptionsPanel options={options} recommended={fit?.recommended} onPatch={onPatchOptions} />
      ) : null}
    </div>
  );
};

export default ModelRow;
