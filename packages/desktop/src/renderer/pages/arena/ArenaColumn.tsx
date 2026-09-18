/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Spin, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@renderer/components/Markdown';
import type { ArenaSideState } from './useArenaRun';

type ArenaColumnProps = {
  label: string;
  state: ArenaSideState;
};

/** One arena answer column: markdown body plus a stats footer. */
const ArenaColumn: React.FC<ArenaColumnProps> = ({ label, state }) => {
  const { t } = useTranslation();
  const { stats } = state;

  return (
    <div className='flex-1 min-w-0 flex flex-col border-1px border-solid border-[var(--color-border-2)] rd-8px overflow-hidden'>
      <div className='flex items-center justify-between gap-8px px-12px py-8px bg-fill-1 border-b-1px border-solid border-[var(--color-border-2)]'>
        <span className='text-13px font-medium truncate'>{label || t('arena.noModelSelected')}</span>
        {state.running && <Spin size={14} />}
      </div>
      <div className='flex-1 min-h-160px overflow-auto px-12px py-10px text-14px'>
        {state.error ? (
          <Tag color='red'>{state.error === 'aborted' ? t('arena.cancelled') : state.error}</Tag>
        ) : state.text ? (
          <MarkdownView>{state.text}</MarkdownView>
        ) : (
          <span className='text-t-secondary'>{state.running ? t('arena.waiting') : t('arena.empty')}</span>
        )}
      </div>
      <div className='px-12px py-8px border-t-1px border-solid border-[var(--color-border-2)] text-11px font-mono text-t-secondary flex flex-wrap gap-x-12px gap-y-2px'>
        {stats ? (
          <>
            <span>
              {t('arena.stats.ttfb')}: {Math.round(stats.ttfbMs)} ms
            </span>
            <span>
              {t('arena.stats.total')}: {Math.round(stats.totalMs)} ms
            </span>
            <span>
              {t('arena.stats.tokens')}: {stats.estimated ? '≈' : ''}
              {stats.outputTokens}
            </span>
            <span>
              {t('arena.stats.throughput')}: {stats.estimated ? '≈' : ''}
              {stats.tokensPerSecond.toFixed(1)} {t('arena.stats.tokensPerSecondUnit')}
            </span>
            {stats.estimated && <span className='italic'>{t('arena.stats.estimatedHint')}</span>}
          </>
        ) : (
          <span>{t('arena.stats.pending')}</span>
        )}
      </div>
    </div>
  );
};

export default ArenaColumn;
