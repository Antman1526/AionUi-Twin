/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Input, Message } from '@arco-design/web-react';
import { Copy, Pause, Play } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';
import { copyText } from '@renderer/utils/ui/clipboard';
import ArenaColumn from './ArenaColumn';
import ArenaModelSelect, { arenaModelLabel, resolveArenaModel } from './ArenaModelSelect';
import { formatComparisonMarkdown } from './formatComparison';
import { useArenaRun } from './useArenaRun';

const ArenaPage: React.FC = () => {
  const { t } = useTranslation();
  const { data: providerConfig } = useProvidersQuery();
  const providers = useMemo(
    () => (providerConfig ?? []).filter((entry) => (entry.models ?? []).length > 0),
    [providerConfig]
  );

  const [leftKey, setLeftKey] = useState<string | undefined>(undefined);
  const [rightKey, setRightKey] = useState<string | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  const arena = useArenaRun();

  const leftProvider = resolveArenaModel(providers, leftKey);
  const rightProvider = resolveArenaModel(providers, rightKey);
  const leftLabel = leftProvider ? arenaModelLabel(leftProvider) : '';
  const rightLabel = rightProvider ? arenaModelLabel(rightProvider) : '';
  const canRun = Boolean(leftProvider && rightProvider && prompt.trim()) && !arena.running;

  const handleRun = (): void => {
    if (!leftProvider || !rightProvider) return;
    void arena.run({
      left: leftProvider,
      right: rightProvider,
      prompt: prompt.trim(),
      ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
      leftLabel,
      rightLabel,
    });
  };

  const handleCopy = (): void => {
    const markdown = formatComparisonMarkdown({
      prompt: prompt.trim(),
      ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
      left: {
        label: leftLabel || t('arena.left'),
        text: arena.left.text,
        ...(arena.left.error ? { error: arena.left.error } : {}),
        ...(arena.left.stats ? { stats: arena.left.stats } : {}),
      },
      right: {
        label: rightLabel || t('arena.right'),
        text: arena.right.text,
        ...(arena.right.error ? { error: arena.right.error } : {}),
        ...(arena.right.stats ? { stats: arena.right.stats } : {}),
      },
    });
    void copyText(markdown).then(() => Message.success(t('arena.copied')));
  };

  return (
    <div className='size-full flex flex-col gap-12px p-16px overflow-auto'>
      <div>
        <h1 className='text-18px font-semibold m-0'>{t('arena.title')}</h1>
        <p className='text-12px text-t-secondary mt-4px mb-0'>{t('arena.description')}</p>
      </div>

      <div className='flex gap-12px flex-wrap'>
        <div className='flex-1 min-w-220px'>
          <ArenaModelSelect
            providers={providers}
            value={leftKey}
            placeholder={t('arena.selectLeft')}
            onChange={setLeftKey}
          />
        </div>
        <div className='flex-1 min-w-220px'>
          <ArenaModelSelect
            providers={providers}
            value={rightKey}
            placeholder={t('arena.selectRight')}
            onChange={setRightKey}
          />
        </div>
      </div>

      <Input.TextArea
        value={prompt}
        onChange={setPrompt}
        placeholder={t('arena.promptPlaceholder')}
        autoSize={{ minRows: 3, maxRows: 8 }}
      />
      <Input.TextArea
        value={systemPrompt}
        onChange={setSystemPrompt}
        placeholder={t('arena.systemPromptPlaceholder')}
        autoSize={{ minRows: 1, maxRows: 4 }}
      />

      <div className='flex items-center gap-8px'>
        <Button type='primary' icon={<Play theme='outline' size='14' />} disabled={!canRun} onClick={handleRun}>
          {t('arena.run')}
        </Button>
        <Button icon={<Pause theme='outline' size='14' />} disabled={!arena.running} onClick={arena.cancel}>
          {t('arena.cancel')}
        </Button>
        <Button
          icon={<Copy theme='outline' size='14' />}
          disabled={!arena.left.stats && !arena.right.stats}
          onClick={handleCopy}
        >
          {t('arena.copyComparison')}
        </Button>
        {arena.startError && <span className='text-12px text-danger-6'>{arena.startError}</span>}
      </div>

      <div className='flex gap-12px flex-wrap items-stretch'>
        <ArenaColumn label={leftLabel} state={arena.left} />
        <ArenaColumn label={rightLabel} state={arena.right} />
      </div>

      {arena.history.length > 0 && (
        <div className='mt-4px'>
          <div className='text-13px font-medium mb-6px'>{t('arena.history')}</div>
          <div className='flex flex-col gap-4px text-11px font-mono text-t-secondary'>
            {arena.history.map((entry) => (
              <div key={entry.runId} className='truncate'>
                {entry.prompt} — {entry.leftLabel}:{' '}
                {entry.leftStats ? `${Math.round(entry.leftStats.totalMs)} ms` : '—'} | {entry.rightLabel}:{' '}
                {entry.rightStats ? `${Math.round(entry.rightStats.totalMs)} ms` : '—'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ArenaPage;
