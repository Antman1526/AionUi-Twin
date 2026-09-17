/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Typography } from '@arco-design/web-react';
import MarkdownView from '@renderer/components/Markdown';
import type { ArenaColumnState } from './useArenaRun';

type ArenaColumnProps = {
  title: string;
  /** Provider and model this column ran, empty until one is picked. */
  modelLabel: string;
  state: ArenaColumnState;
};

/** One side of the comparison: streamed markdown plus its stats footer. */
const ArenaColumn: React.FC<ArenaColumnProps> = ({ title, modelLabel, state }) => {
  const { t } = useTranslation();
  const { stats } = state;

  return (
    <div className='flex-1 min-w-0 flex flex-col gap-8px b-1px b-solid b-[var(--color-border-2)] rd-8px p-12px'>
      <div className='flex items-baseline justify-between gap-8px'>
        <Typography.Text className='text-t-primary font-medium'>{title}</Typography.Text>
        <Typography.Ellipsis className='text-t-secondary text-12px max-w-60%'>{modelLabel}</Typography.Ellipsis>
      </div>

      <div className='min-h-160px'>
        {state.status === 'error' && (
          <Typography.Text type='error'>{t('arena.error', { message: state.error ?? '' })}</Typography.Text>
        )}
        {state.status === 'cancelled' && (
          <Typography.Text className='text-t-secondary'>{t('arena.cancelled')}</Typography.Text>
        )}
        {state.text ? (
          <MarkdownView>{state.text}</MarkdownView>
        ) : (
          state.status !== 'error' &&
          state.status !== 'cancelled' && (
            <Typography.Text className='text-t-secondary'>
              {state.status === 'running' ? t('arena.running') : t('arena.empty')}
            </Typography.Text>
          )
        )}
      </div>

      {stats && (
        <div className='flex flex-wrap gap-12px text-t-secondary text-12px'>
          <span>{`${t('arena.stats.latency')}: ${String(Math.round(stats.totalMs))} ms`}</span>
          <span>{`${t('arena.stats.tokens')}: ${stats.estimated ? '≈' : ''}${String(stats.outputTokens)}`}</span>
          <span>{`${t('arena.stats.speed')}: ${stats.tokensPerSecond.toFixed(1)} tok/s`}</span>
          {stats.estimated && <span>{t('arena.stats.estimated')}</span>}
        </div>
      )}
    </div>
  );
};

export default ArenaColumn;
