/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import type { SemanticIndexProgress } from '@process/services/semanticSearch/types';
import { Alert, Button, Progress, Select, Switch } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

const MODEL_VALUE_PREFIX = 'model:';
const PROVIDER_VALUE_PREFIX = 'provider:';

/** Providers served from this machine are the only ones offered for embeddings. */
const isLoopbackBaseUrl = (baseUrl?: string): boolean =>
  typeof baseUrl === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(baseUrl);

/** Local GGUF files usable as embedding models, recognised by their file name. */
const isEmbeddingModelName = (name: string): boolean => name.toLowerCase().includes('embed');

const formatTimestamp = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);

/**
 * Settings section for local semantic search: enable switch, embedding source,
 * index actions with progress, and index statistics.
 */
const SemanticSearchPanel: React.FC = () => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<SemanticIndexProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: settings, mutate: mutateSettings } = useSWR('semantic-search.settings', () =>
    ipcBridge.semanticSearch.getSettings.invoke().then((res) => res.data)
  );
  const { data: stats, mutate: mutateStats } = useSWR('semantic-search.stats', () =>
    ipcBridge.semanticSearch.getStats.invoke().then((res) => res.data)
  );
  const { data: scan } = useSWR('local-model.list', () =>
    ipcBridge.localModel.listModels.invoke().then((res) => res.data ?? { roots: [], models: [] })
  );
  const { data: providers } = useSWR('model.config', () => ConfigStorage.get('model.config'));

  useEffect(() => {
    const removeListener = ipcBridge.semanticSearch.indexProgress.on((event) => {
      setProgress(event.state === 'running' ? event : null);
      if (event.state === 'error') setError(event.message ?? t('settings.semanticSearch.failed'));
    });
    return () => removeListener?.();
  }, [t]);

  const embeddingModels = (scan?.models ?? []).filter(
    (model) => model.format === 'gguf' && isEmbeddingModelName(model.name)
  );
  const loopbackProviders = (providers ?? []).filter((provider) => isLoopbackBaseUrl(provider.baseUrl));

  const sourceValue = settings?.providerId
    ? `${PROVIDER_VALUE_PREFIX}${settings.providerId}`
    : settings?.embeddingModelPath
      ? `${MODEL_VALUE_PREFIX}${settings.embeddingModelPath}`
      : undefined;

  const patchSettings = useCallback(
    async (patch: Parameters<typeof ipcBridge.semanticSearch.setSettings.invoke>[0]) => {
      const res = await ipcBridge.semanticSearch.setSettings.invoke(patch);
      if (!res.success) {
        setError(res.msg ?? t('settings.semanticSearch.failed'));
        return;
      }
      setError(null);
      await mutateSettings();
    },
    [mutateSettings, t]
  );

  const handleSourceChange = useCallback(
    (value: string) => {
      const isProvider = value.startsWith(PROVIDER_VALUE_PREFIX);
      void patchSettings({
        providerId: isProvider ? value.slice(PROVIDER_VALUE_PREFIX.length) : '',
        embeddingModelPath: isProvider ? '' : value.slice(MODEL_VALUE_PREFIX.length),
      });
    },
    [patchSettings]
  );

  const runJob = useCallback(
    async (job: () => Promise<{ success: boolean; msg?: string }>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await job();
        if (!res.success) setError(res.msg ?? t('settings.semanticSearch.failed'));
      } finally {
        setBusy(false);
        setProgress(null);
        await mutateStats();
      }
    },
    [mutateStats, t]
  );

  const handleIndexWorkspace = useCallback(async () => {
    const picked = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
    const workspacePath = picked?.[0];
    if (!workspacePath) return;
    await runJob(() => ipcBridge.semanticSearch.indexWorkspace.invoke({ workspacePath }));
  }, [runJob]);

  return (
    <div className='mt-16px pt-12px border-t border-solid border-transparent border-t-[color:var(--color-border-2)]'>
      <div className='flex items-center justify-between gap-8px mb-4px'>
        <span className='text-14px font-600 text-t-primary'>{t('settings.semanticSearch.title')}</span>
        <Switch
          size='small'
          checked={settings?.enabled ?? false}
          onChange={(checked) => void patchSettings({ enabled: checked })}
        />
      </div>
      <div className='text-12px text-t-secondary mb-10px'>{t('settings.semanticSearch.description')}</div>

      {error ? <Alert type='error' className='mb-8px' content={error} /> : null}

      <div className='text-12px text-t-secondary mb-4px'>{t('settings.semanticSearch.embeddingSource')}</div>
      <Select
        size='small'
        className='w-full mb-10px'
        value={sourceValue}
        placeholder={t('settings.semanticSearch.selectSource')}
        onChange={handleSourceChange}
      >
        <Select.OptGroup label={t('settings.semanticSearch.groupModels')}>
          {embeddingModels.map((model) => (
            <Select.Option key={model.path} value={`${MODEL_VALUE_PREFIX}${model.path}`}>
              {model.name}
            </Select.Option>
          ))}
        </Select.OptGroup>
        <Select.OptGroup label={t('settings.semanticSearch.groupProviders')}>
          {loopbackProviders.map((provider) => (
            <Select.Option key={provider.id} value={`${PROVIDER_VALUE_PREFIX}${provider.id}`}>
              {provider.name}
            </Select.Option>
          ))}
        </Select.OptGroup>
      </Select>

      {embeddingModels.length === 0 && loopbackProviders.length === 0 ? (
        <div className='text-12px text-t-secondary mb-10px'>{t('settings.semanticSearch.noSources')}</div>
      ) : null}

      <div className='flex items-center gap-8px flex-wrap mb-8px'>
        <Button
          size='mini'
          icon={<Refresh theme='outline' size='14' />}
          loading={busy}
          disabled={!settings?.hasEmbeddingSource}
          onClick={() => void runJob(() => ipcBridge.semanticSearch.rebuildIndex.invoke())}
        >
          {t('settings.semanticSearch.rebuildIndex')}
        </Button>
        <Button
          size='mini'
          loading={busy}
          disabled={!settings?.hasEmbeddingSource}
          onClick={() => void handleIndexWorkspace()}
        >
          {t('settings.semanticSearch.indexWorkspace')}
        </Button>
        <Button size='mini' disabled={!busy} onClick={() => void ipcBridge.semanticSearch.cancelIndex.invoke()}>
          {t('settings.semanticSearch.cancel')}
        </Button>
        <Button size='mini' onClick={() => void runJob(() => ipcBridge.semanticSearch.clearIndex.invoke())}>
          {t('settings.semanticSearch.clearIndex')}
        </Button>
      </div>

      {progress ? (
        <div className='mb-8px'>
          <Progress
            size='small'
            percent={progress.total > 0 ? Math.round((progress.indexed / progress.total) * 100) : 0}
          />
          <div className='text-12px text-t-secondary'>
            {t('settings.semanticSearch.progress', { indexed: progress.indexed, total: progress.total })}
          </div>
        </div>
      ) : null}

      <div className='text-12px text-t-secondary'>
        {t('settings.semanticSearch.stats', { rows: stats?.rows ?? 0, conversations: stats?.conversations ?? 0 })}
        {' · '}
        {stats?.lastIndexedAt
          ? t('settings.semanticSearch.lastIndexed', { time: formatTimestamp(stats.lastIndexedAt) })
          : t('settings.semanticSearch.never')}
      </div>
    </div>
  );
};

export default SemanticSearchPanel;
