/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LocalModelRuntimeOptions } from '@/common/config/storage';
import { Button, InputNumber, Select } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const getGpuMode = (options: LocalModelRuntimeOptions): 'auto' | 'cpu' | 'custom' => {
  if (options.gpuLayers === undefined) return 'auto';
  return options.gpuLayers === 0 ? 'cpu' : 'custom';
};

const getTimeoutMode = (options: LocalModelRuntimeOptions): 'auto' | '300000' | '600000' | 'custom' => {
  if (options.readinessTimeoutMs === undefined) return 'auto';
  if (options.readinessTimeoutMs === 300_000) return '300000';
  if (options.readinessTimeoutMs === 600_000) return '600000';
  return 'custom';
};

/**
 * Per-model llama.cpp runtime overrides. "Use recommended" fills context size and
 * GPU layers from the hardware-fit estimate for this machine.
 */
const RuntimeOptionsPanel: React.FC<{
  options: LocalModelRuntimeOptions;
  recommended?: { contextSize: number; gpuLayers: number };
  onPatch: (patch: LocalModelRuntimeOptions) => void;
}> = ({ options, recommended, onPatch }) => {
  const { t } = useTranslation();
  const gpuMode = getGpuMode(options);
  const timeoutMode = getTimeoutMode(options);

  return (
    <div className='px-12px pb-10px pt-2px border-t-1px border-solid border-[var(--color-border-2)] bg-fill-1'>
      <div className='grid grid-cols-1 md:grid-cols-4 gap-10px'>
        <div>
          <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.contextSize')}</div>
          <InputNumber
            size='mini'
            min={512}
            max={262144}
            step={512}
            value={options.contextSize}
            placeholder={t('settings.localGguf.auto')}
            onChange={(value) =>
              onPatch({ contextSize: typeof value === 'number' && Number.isFinite(value) ? value : undefined })
            }
          />
        </div>
        <div>
          <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.gpuLayers')}</div>
          <div className='flex gap-6px'>
            <Select
              size='mini'
              value={gpuMode}
              className='min-w-110px'
              onChange={(value) => {
                if (value === 'auto') onPatch({ gpuLayers: undefined });
                if (value === 'cpu') onPatch({ gpuLayers: 0 });
                if (value === 'custom') onPatch({ gpuLayers: options.gpuLayers || 99 });
              }}
            >
              <Select.Option value='auto'>{t('settings.localGguf.auto')}</Select.Option>
              <Select.Option value='cpu'>{t('settings.localGguf.cpuOnly')}</Select.Option>
              <Select.Option value='custom'>{t('settings.localGguf.custom')}</Select.Option>
            </Select>
            {gpuMode === 'custom' ? (
              <InputNumber
                size='mini'
                min={0}
                max={999}
                step={1}
                value={options.gpuLayers}
                onChange={(value) =>
                  onPatch({ gpuLayers: typeof value === 'number' && Number.isFinite(value) ? value : undefined })
                }
              />
            ) : null}
          </div>
        </div>
        <div>
          <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.timeout')}</div>
          <div className='flex gap-6px'>
            <Select
              size='mini'
              value={timeoutMode}
              className='min-w-110px'
              onChange={(value) => {
                if (value === 'auto') onPatch({ readinessTimeoutMs: undefined });
                if (value === '300000') onPatch({ readinessTimeoutMs: 300_000 });
                if (value === '600000') onPatch({ readinessTimeoutMs: 600_000 });
                if (value === 'custom') onPatch({ readinessTimeoutMs: options.readinessTimeoutMs || 300_000 });
              }}
            >
              <Select.Option value='auto'>{t('settings.localGguf.auto')}</Select.Option>
              <Select.Option value='300000'>{t('settings.localGguf.timeoutFiveMinutes')}</Select.Option>
              <Select.Option value='600000'>{t('settings.localGguf.timeoutTenMinutes')}</Select.Option>
              <Select.Option value='custom'>{t('settings.localGguf.custom')}</Select.Option>
            </Select>
            {timeoutMode === 'custom' ? (
              <InputNumber
                size='mini'
                min={30}
                max={900}
                step={30}
                value={Math.round((options.readinessTimeoutMs ?? 300_000) / 1000)}
                onChange={(value) =>
                  onPatch({
                    readinessTimeoutMs:
                      typeof value === 'number' && Number.isFinite(value) ? Math.round(value) * 1000 : undefined,
                  })
                }
              />
            ) : null}
          </div>
        </div>
        <div>
          <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.reasoning')}</div>
          <Select
            size='mini'
            value={options.reasoning ?? 'auto'}
            className='w-full'
            onChange={(value) => {
              if (value === 'auto') onPatch({ reasoning: undefined });
              if (value === 'off' || value === 'on') onPatch({ reasoning: value });
            }}
          >
            <Select.Option value='auto'>{t('settings.localGguf.auto')}</Select.Option>
            <Select.Option value='off'>{t('settings.localGguf.reasoningOff')}</Select.Option>
            <Select.Option value='on'>{t('settings.localGguf.reasoningOn')}</Select.Option>
          </Select>
        </div>
        <div>
          <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.embedding')}</div>
          <Select
            size='mini'
            value={options.embedding ? 'on' : 'off'}
            className='w-full'
            onChange={(value) => onPatch({ embedding: value === 'on' ? true : undefined })}
          >
            <Select.Option value='off'>{t('settings.localGguf.embeddingOff')}</Select.Option>
            <Select.Option value='on'>{t('settings.localGguf.embeddingOn')}</Select.Option>
          </Select>
        </div>
      </div>
      <div className='flex items-center gap-8px mt-8px'>
        {recommended ? (
          <Button
            size='mini'
            onClick={() => onPatch({ contextSize: recommended.contextSize, gpuLayers: recommended.gpuLayers })}
          >
            {t('settings.localGguf.useRecommended')}
          </Button>
        ) : null}
        <span className='text-11px text-t-secondary'>{t('settings.localGguf.advancedHint')}</span>
      </div>
    </div>
  );
};

export default RuntimeOptionsPanel;
