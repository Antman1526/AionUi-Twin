/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Layout, Message, Typography } from '@arco-design/web-react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { ArenaModelRef } from '@/common/adapter/ipcBridge';
import type { IProvider } from '@/common/config/storage';
import { copyText } from '@renderer/utils/ui/clipboard';
import ArenaColumn from './ArenaColumn';
import ArenaModelSelect, { modelRefLabel } from './ArenaModelSelect';
import { buildComparisonMarkdown } from './comparison';
import { useArenaRun } from './useArenaRun';

/** Side-by-side model comparison page (`/arena`). */
const ArenaPage: React.FC = () => {
  const { t } = useTranslation();
  const { data: providers } = useSWR<IProvider[]>('model.config', () => ipcBridge.mode.getModelConfig.invoke());
  const [left, setLeft] = useState<ArenaModelRef | null>(null);
  const [right, setRight] = useState<ArenaModelRef | null>(null);
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const run = useArenaRun();

  const enabledProviders = useMemo(
    () => (providers ?? []).filter((provider) => provider.enabled !== false && provider.model.length > 0),
    [providers]
  );

  const leftLabel = modelRefLabel(enabledProviders, left);
  const rightLabel = modelRefLabel(enabledProviders, right);
  const canCopy = Boolean(run.left.stats || run.right.stats || run.left.error || run.right.error);

  const handleRun = () => {
    if (!left || !right) {
      Message.warning(t('arena.selectModels'));
      return;
    }
    if (!prompt.trim()) {
      Message.warning(t('arena.enterPrompt'));
      return;
    }
    void run.start({
      left,
      right,
      prompt,
      ...(systemPrompt.trim() ? { systemPrompt } : {}),
    });
  };

  const handleCopy = () => {
    const markdown = buildComparisonMarkdown({
      prompt,
      ...(systemPrompt.trim() ? { systemPrompt } : {}),
      left: { label: leftLabel, text: run.left.text, stats: run.left.stats, error: run.left.error },
      right: { label: rightLabel, text: run.right.text, stats: run.right.stats, error: run.right.error },
      labels: {
        prompt: t('arena.prompt'),
        systemPrompt: t('arena.systemPrompt'),
        left: t('arena.leftModel'),
        right: t('arena.rightModel'),
        latency: t('arena.stats.latency'),
        tokens: t('arena.stats.tokens'),
        speed: t('arena.stats.speed'),
        estimated: t('arena.stats.estimated'),
      },
    });
    copyText(markdown)
      .then(() => Message.success(t('arena.copied')))
      .catch((error: unknown) => Message.error(error instanceof Error ? error.message : String(error)));
  };

  return (
    <Layout className='size-full overflow-y-auto'>
      <Layout.Content className='p-24px flex flex-col gap-16px'>
        <div className='flex flex-col gap-4px'>
          <Typography.Title heading={5} className='!m-0 text-t-primary'>
            {t('arena.title')}
          </Typography.Title>
          <Typography.Text className='text-t-secondary'>{t('arena.subtitle')}</Typography.Text>
        </div>

        <div className='flex gap-12px'>
          <ArenaModelSelect
            label={t('arena.leftModel')}
            providers={enabledProviders}
            value={left}
            disabled={run.running}
            onChange={setLeft}
          />
          <ArenaModelSelect
            label={t('arena.rightModel')}
            providers={enabledProviders}
            value={right}
            disabled={run.running}
            onChange={setRight}
          />
        </div>

        <div className='flex flex-col gap-4px'>
          <span className='text-t-secondary text-12px'>{t('arena.systemPrompt')}</span>
          <Input.TextArea
            value={systemPrompt}
            disabled={run.running}
            placeholder={t('arena.systemPromptPlaceholder')}
            autoSize={{ minRows: 1, maxRows: 4 }}
            onChange={setSystemPrompt}
          />
        </div>

        <div className='flex flex-col gap-4px'>
          <span className='text-t-secondary text-12px'>{t('arena.prompt')}</span>
          <Input.TextArea
            value={prompt}
            disabled={run.running}
            placeholder={t('arena.promptPlaceholder')}
            autoSize={{ minRows: 3, maxRows: 10 }}
            onChange={setPrompt}
          />
        </div>

        <div className='flex items-center gap-8px'>
          <Button type='primary' loading={run.running} onClick={handleRun}>
            {t('arena.run')}
          </Button>
          <Button disabled={!run.running} onClick={() => void run.cancel()}>
            {t('arena.cancel')}
          </Button>
          <Button disabled={!canCopy} onClick={handleCopy}>
            {t('arena.copyComparison')}
          </Button>
          {run.startError && (
            <Typography.Text type='error'>{t('arena.error', { message: run.startError })}</Typography.Text>
          )}
        </div>

        <div className='flex gap-12px items-stretch'>
          <ArenaColumn title={t('arena.leftModel')} modelLabel={leftLabel} state={run.left} />
          <ArenaColumn title={t('arena.rightModel')} modelLabel={rightLabel} state={run.right} />
        </div>
      </Layout.Content>
    </Layout>
  );
};

export default ArenaPage;
