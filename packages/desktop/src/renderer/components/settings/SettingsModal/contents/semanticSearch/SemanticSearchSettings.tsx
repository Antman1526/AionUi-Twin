/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SemanticIndexProgress } from '@/common/adapter/ipcBridge';
import type { SemanticSearchSource } from '@/common/config/storage';
import { Button, Input, Message, Progress, Radio, Select, Switch, Tag } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

type SourceKind = 'localModel' | 'provider';

/**
 * Settings panel for the local semantic index: enable switch, embedding source,
 * rebuild/cancel with live progress, workspace indexing and index stats.
 */
const SemanticSearchSettings: React.FC = () => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [progress, setProgress] = useState<SemanticIndexProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | undefined>(undefined);

  const { data: settings, mutate: mutateSettings } = useSWR('semantic-search.settings', () =>
    ipcBridge.semanticSearch.getSettings.invoke().then((res) => res.data ?? { enabled: false, source: null })
  );
  const { data: stats, mutate: mutateStats } = useSWR('semantic-search.stats', () =>
    ipcBridge.semanticSearch.getStats.invoke().then((res) => res.data ?? null)
  );
  const { data: candidates } = useSWR('semantic-search.embedding-models', () =>
    ipcBridge.semanticSearch.listEmbeddingModels.invoke().then((res) => res.data ?? [])
  );
  const { data: workspaces } = useSWR('semantic-search.workspaces', async () => {
    const page = await ipcBridge.database.getUserConversations.invoke({ limit: 10000 });
    const paths = (page?.items ?? [])
      .map((conversation) => (conversation.extra as { workspace?: string } | undefined)?.workspace)
      .filter((workspace): workspace is string => typeof workspace === 'string' && workspace.trim().length > 0);
    return [...new Set(paths)];
  });

  const sourceKind: SourceKind = settings?.source?.kind === 'provider' ? 'provider' : 'localModel';

  useEffect(() => {
    if (settings?.source?.kind === 'provider') {
      setProviderBaseUrl(settings.source.baseUrl);
      setProviderModel(settings.source.model);
    }
  }, [settings?.source]);

  useEffect(() => {
    return ipcBridge.semanticSearch.progress.on((next) => {
      setProgress(next);
      if (next.phase === 'done' || next.phase === 'error') {
        void mutateStats();
      }
    });
  }, [mutateStats]);

  const percent = useMemo(() => {
    if (!progress || progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.processed / progress.total) * 100));
  }, [progress]);

  const saveSettings = async (next: { enabled?: boolean; source?: SemanticSearchSource | null }): Promise<void> => {
    const result = await ipcBridge.semanticSearch.setSettings.invoke(next);
    if (!result.success) {
      message.error?.(result.msg || t('settings.semanticSearch.saveFailed'));
      return;
    }
    void mutateSettings();
    void mutateStats();
  };

  const handleSelectLocalModel = (modelPath: string): void => {
    void saveSettings({ source: { kind: 'localModel', modelPath } });
  };

  const handleSaveProvider = (): void => {
    const baseUrl = providerBaseUrl.trim();
    const model = providerModel.trim();
    if (!baseUrl || !model) {
      message.warning?.(t('settings.semanticSearch.providerIncomplete'));
      return;
    }
    void saveSettings({ source: { kind: 'provider', baseUrl, model } });
  };

  const handleRebuild = async (): Promise<void> => {
    setBusy(true);
    setProgress({ phase: 'conversations', processed: 0, total: 0 });
    try {
      const result = await ipcBridge.semanticSearch.rebuild.invoke();
      if (!result.success) {
        message.error?.(result.msg || t('settings.semanticSearch.indexFailed'));
        return;
      }
      message.success?.(t('settings.semanticSearch.indexDone', { count: result.data?.indexed ?? 0 }));
    } finally {
      setBusy(false);
      void mutateStats();
    }
  };

  const handleIndexWorkspace = async (): Promise<void> => {
    if (!selectedWorkspace) {
      message.warning?.(t('settings.semanticSearch.workspaceRequired'));
      return;
    }
    setBusy(true);
    setProgress({ phase: 'workspace', processed: 0, total: 0 });
    try {
      const result = await ipcBridge.semanticSearch.indexWorkspace.invoke({ workspacePath: selectedWorkspace });
      if (!result.success) {
        message.error?.(result.msg || t('settings.semanticSearch.indexFailed'));
        return;
      }
      message.success?.(t('settings.semanticSearch.indexDone', { count: result.data?.indexed ?? 0 }));
    } finally {
      setBusy(false);
      void mutateStats();
    }
  };

  const handleCancel = (): void => {
    void ipcBridge.semanticSearch.cancel.invoke();
  };

  const handleClear = async (): Promise<void> => {
    const result = await ipcBridge.semanticSearch.clear.invoke();
    if (!result.success) {
      message.error?.(result.msg || t('settings.semanticSearch.indexFailed'));
      return;
    }
    setProgress(null);
    message.success?.(t('settings.semanticSearch.cleared'));
    void mutateStats();
  };

  return (
    <div className='flex flex-col gap-12px mt-24px'>
      {messageContext}
      <div className='flex items-center justify-between gap-12px'>
        <div className='min-w-0'>
          <div className='text-15px font-600 text-t-primary'>{t('settings.semanticSearch.title')}</div>
          <div className='text-12px text-t-secondary'>{t('settings.semanticSearch.description')}</div>
        </div>
        <Switch
          checked={settings?.enabled === true}
          onChange={(checked: boolean) => void saveSettings({ enabled: checked })}
        />
      </div>

      <div className='flex flex-col gap-8px'>
        <span className='text-13px text-t-primary'>{t('settings.semanticSearch.sourceLabel')}</span>
        <Radio.Group
          type='button'
          size='small'
          value={sourceKind}
          onChange={(next: SourceKind) => {
            if (next === 'localModel') {
              void saveSettings({ source: null });
            } else {
              void saveSettings({ source: { kind: 'provider', baseUrl: providerBaseUrl, model: providerModel } });
            }
          }}
        >
          <Radio value='localModel'>{t('settings.semanticSearch.sourceLocalModel')}</Radio>
          <Radio value='provider'>{t('settings.semanticSearch.sourceProvider')}</Radio>
        </Radio.Group>

        {sourceKind === 'localModel' ? (
          <Select
            className='w-full'
            placeholder={t('settings.semanticSearch.sourcePlaceholder')}
            value={settings?.source?.kind === 'localModel' ? settings.source.modelPath : undefined}
            onChange={handleSelectLocalModel}
            notFoundContent={t('settings.semanticSearch.noEmbeddingModels')}
          >
            {(candidates ?? []).map((candidate) => (
              <Select.Option key={candidate.path} value={candidate.path}>
                {candidate.name}
              </Select.Option>
            ))}
          </Select>
        ) : (
          <div className='flex flex-col gap-6px'>
            <Input
              value={providerBaseUrl}
              placeholder={t('settings.semanticSearch.baseUrlPlaceholder')}
              onChange={setProviderBaseUrl}
            />
            <Input
              value={providerModel}
              placeholder={t('settings.semanticSearch.modelNamePlaceholder')}
              onChange={setProviderModel}
            />
            <span className='text-12px text-t-secondary'>{t('settings.semanticSearch.loopbackOnly')}</span>
            <Button size='mini' onClick={handleSaveProvider}>
              {t('settings.semanticSearch.saveProvider')}
            </Button>
          </div>
        )}
      </div>

      <div className='flex flex-col gap-8px'>
        <Select
          className='w-full'
          placeholder={t('settings.semanticSearch.workspacePlaceholder')}
          value={selectedWorkspace}
          onChange={setSelectedWorkspace}
        >
          {(workspaces ?? []).map((workspace) => (
            <Select.Option key={workspace} value={workspace}>
              {workspace}
            </Select.Option>
          ))}
        </Select>
        <div className='flex items-center gap-8px flex-wrap'>
          <Button
            size='mini'
            type='primary'
            loading={busy}
            icon={<Refresh theme='outline' size='14' />}
            onClick={() => void handleRebuild()}
          >
            {busy ? t('settings.semanticSearch.rebuilding') : t('settings.semanticSearch.rebuild')}
          </Button>
          <Button size='mini' loading={busy} onClick={() => void handleIndexWorkspace()}>
            {t('settings.semanticSearch.indexWorkspace')}
          </Button>
          <Button size='mini' disabled={!busy} onClick={handleCancel}>
            {t('settings.semanticSearch.cancel')}
          </Button>
          <Button size='mini' status='danger' onClick={() => void handleClear()}>
            {t('settings.semanticSearch.clear')}
          </Button>
        </div>
      </div>

      {progress && busy ? (
        <div className='flex flex-col gap-4px'>
          <Progress percent={percent} size='small' />
          <span className='text-12px text-t-secondary truncate'>{progress.label ?? ''}</span>
        </div>
      ) : null}

      <div className='flex items-center gap-8px flex-wrap'>
        {stats && stats.rows > 0 ? (
          <>
            <Tag size='small'>{t('settings.semanticSearch.statsRows', { count: stats.rows })}</Tag>
            <Tag size='small'>{t('settings.semanticSearch.statsConversations', { count: stats.conversations })}</Tag>
            <Tag size='small'>{t('settings.semanticSearch.statsWorkspaceRows', { count: stats.workspaceRows })}</Tag>
            {stats.model ? (
              <Tag size='small'>{t('settings.semanticSearch.statsModel', { model: stats.model })}</Tag>
            ) : null}
          </>
        ) : (
          <span className='text-12px text-t-secondary'>{t('settings.semanticSearch.statsNever')}</span>
        )}
      </div>
    </div>
  );
};

export default SemanticSearchSettings;
