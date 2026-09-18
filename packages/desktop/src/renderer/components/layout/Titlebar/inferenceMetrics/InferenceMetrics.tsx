/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Progress, Tooltip } from '@arco-design/web-react';
import { Lightning } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { InferenceMetricsState } from './useInferenceMetrics';

const formatRate = (value: number): string => (value >= 100 ? value.toFixed(0) : value.toFixed(1));

const formatBytes = (bytes: number): string => {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
};

const contextPercent = (state: InferenceMetricsState): number | null => {
  if (!state.contextSize || state.decodedTokens === undefined) return null;
  return Math.min(100, Math.round((state.decodedTokens / state.contextSize) * 100));
};

/** Compact tokens/sec chip shown next to the memory figure in the titlebar. */
export const InferenceBadge: React.FC<{ state: InferenceMetricsState }> = ({ state }) => {
  const { t } = useTranslation();
  if (state.tokensPerSecond === null) return null;

  const label = `${state.estimated ? '≈' : ''}${formatRate(state.tokensPerSecond)} ${t('conversation.hud.tokensPerSecondUnit')}`;

  return (
    <Tooltip content={state.estimated ? t('conversation.hud.estimatedHint') : t('conversation.hud.measuredHint')}>
      <span className='flex items-center gap-3px text-11px font-mono text-t-secondary'>
        <Lightning theme='outline' size='11' fill='currentColor' />
        {label}
      </span>
    </Tooltip>
  );
};

/** Detail rows appended to the hardware popover while a local engine is running. */
export const InferenceDetails: React.FC<{ state: InferenceMetricsState }> = ({ state }) => {
  const { t } = useTranslation();
  const percent = contextPercent(state);

  return (
    <div className='mt-6px pt-6px border-t-1px border-solid border-[var(--color-border-2)] flex flex-col gap-4px'>
      <div className='flex justify-between'>
        <span>{t('conversation.hud.tokensPerSecond')}:</span>
        <span className='font-mono font-medium text-t-primary'>
          {state.tokensPerSecond === null
            ? t('conversation.hud.awaitingSample')
            : `${state.estimated ? '≈' : ''}${formatRate(state.tokensPerSecond)} ${t('conversation.hud.tokensPerSecondUnit')}`}
        </span>
      </div>
      {state.estimated && (
        <div className='text-10px text-t-secondary italic'>{t('conversation.hud.estimatedHint')}</div>
      )}
      {percent !== null && (
        <div className='flex flex-col gap-2px'>
          <div className='flex justify-between'>
            <span>{t('conversation.hud.contextFill')}:</span>
            <span className='font-mono font-medium text-t-primary'>
              {state.decodedTokens} / {state.contextSize}
            </span>
          </div>
          <Progress percent={percent} size='mini' showText={false} status={percent > 85 ? 'warning' : 'normal'} />
        </div>
      )}
      {state.rssBytes !== undefined && (
        <div className='flex justify-between'>
          <span>{t('conversation.hud.engineMemory')}:</span>
          <span className='font-mono font-medium text-t-primary'>{formatBytes(state.rssBytes)}</span>
        </div>
      )}
    </div>
  );
};
