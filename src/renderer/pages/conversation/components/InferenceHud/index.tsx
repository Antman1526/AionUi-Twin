/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Progress, Tooltip } from '@arco-design/web-react';
import { formatBytes } from './tokenRate';
import { useInferenceStats } from './useInferenceStats';

/** Provider ids the managed llama.cpp runtime registers itself under. */
const LOCAL_PROVIDER_PREFIX = 'local-llama-cpp-';

type InferenceHudProps = {
  /** Provider id of the conversation's model. */
  providerId?: string;
  /** Conversation whose reply stream the HUD measures. */
  conversationId?: string;
};

const PILL_CLASS = 'flex items-center gap-4px px-8px h-24px rd-12px bg-2 text-t-secondary text-12px leading-none';

/**
 * Compact live-inference readout for the chat header.
 *
 * Renders nothing unless the conversation runs on the managed local
 * llama.cpp provider, and nothing again while no figure could be read.
 */
const InferenceHud: React.FC<InferenceHudProps> = ({ providerId, conversationId }) => {
  const { t } = useTranslation();
  const isLocal = providerId?.startsWith(LOCAL_PROVIDER_PREFIX) === true;
  const stats = useInferenceStats({ conversationId, enabled: isLocal });

  if (!isLocal) return null;

  const showSpeed = stats.tokensPerSecond !== null;
  const showContext = stats.contextSize !== null && stats.contextSize > 0;
  const showMemory = stats.rssBytes !== null;
  if (!showSpeed && !showContext && !showMemory) return null;

  const usedTokens = stats.usedTokens ?? 0;
  const contextSize = stats.contextSize ?? 0;
  const contextPercent = showContext ? Math.min(100, Math.round((usedTokens / contextSize) * 100)) : 0;

  return (
    <div className='flex items-center gap-6px shrink-0'>
      {showSpeed && (
        <Tooltip
          content={
            stats.approximate
              ? t('conversation.hud.tokensPerSecondApproxTooltip')
              : t('conversation.hud.tokensPerSecondTooltip')
          }
        >
          <span className={PILL_CLASS}>
            {stats.approximate
              ? t('conversation.hud.tokensPerSecondApprox', { value: (stats.tokensPerSecond ?? 0).toFixed(1) })
              : t('conversation.hud.tokensPerSecond', { value: (stats.tokensPerSecond ?? 0).toFixed(1) })}
          </span>
        </Tooltip>
      )}
      {showContext && (
        <Tooltip content={t('conversation.hud.contextTooltip', { used: usedTokens, total: contextSize })}>
          <span className={PILL_CLASS}>
            <span>{t('conversation.hud.context')}</span>
            <Progress
              type='line'
              size='small'
              showText={false}
              percent={contextPercent}
              className='w-48px'
              aria-label={t('conversation.hud.context')}
            />
          </span>
        </Tooltip>
      )}
      {showMemory && (
        <Tooltip content={t('conversation.hud.memoryTooltip')}>
          <span className={PILL_CLASS}>
            <span>{t('conversation.hud.memory')}</span>
            <span>{formatBytes(stats.rssBytes ?? 0)}</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
};

export default InferenceHud;
