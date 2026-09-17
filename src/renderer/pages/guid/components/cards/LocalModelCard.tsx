/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import useSettingsModal from '@/renderer/components/settings/SettingsModal/useSettingsModal';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Button, Tag } from '@arco-design/web-react';
import { Computer, Link } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

/** Upstream release page, shown when llama.cpp is not installed. */
const LLAMA_CPP_RELEASES_URL = 'https://github.com/ggml-org/llama.cpp/releases';

/** Every SWR key under which a model selector caches the provider list. */
const MODEL_CONFIG_SWR_KEYS = ['model.config', 'model.config.shared', 'model.config.welcome'] as const;

/**
 * Compact local-model status on the launcher page.
 *
 * Three states: a managed model is serving, models are on disk but none loaded,
 * or `llama-server` is missing. Renders nothing when there is nothing to say.
 */
const LocalModelCard: React.FC = () => {
  const { t } = useTranslation();
  const { openSettings, settingsModal } = useSettingsModal();
  const { mutate: mutateGlobal } = useSWRConfig();
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(undefined);

  const { data: status, mutate: mutateStatus } = useSWR('guid.local-model.status', () =>
    ipcBridge.localModel.getStatus.invoke().then((res) => res.data)
  );
  const { data: scan } = useSWR('guid.local-model.list', () =>
    ipcBridge.localModel.listModels.invoke().then((res) => res.data)
  );
  const { data: executable } = useSWR('guid.local-model.executable', () =>
    ipcBridge.localModel.getExecutableStatus.invoke().then((res) => res.data)
  );

  useEffect(() => {
    void ConfigStorage.get('aionrs.defaultModel').then((value) => setSelectedProviderId(value?.id));
  }, [status?.baseUrl]);

  useEffect(() => {
    const removeListener = ipcBridge.localModel.runtimeChanged.on(() => {
      void mutateStatus();
      // A crashed server takes its provider with it: drop the cached provider lists
      // so the model selector on this page stops offering a dead loopback port.
      for (const key of MODEL_CONFIG_SWR_KEYS) void mutateGlobal(key);
    });
    return () => removeListener?.();
  }, [mutateGlobal, mutateStatus]);

  const useInChat = useCallback(async (): Promise<void> => {
    if (!status?.baseUrl || !status.name) return;
    const providers = await ipcBridge.mode.getModelConfig.invoke();
    const provider = providers.find(
      (item) => item.baseUrl === status.baseUrl && Array.isArray(item.model) && item.model.includes(status.name!)
    );
    if (!provider) return;
    await Promise.all([
      ConfigStorage.set('guid.lastSelectedAgent', 'aionrs'),
      ConfigStorage.set('aionrs.defaultModel', { id: provider.id, useModel: status.name }),
    ]);
    setSelectedProviderId(provider.id);
  }, [status]);

  const llmCount = (scan?.models ?? []).filter((model) => model.kind === 'llm').length;
  const executableMissing = executable !== undefined && !executable.found;

  let body: React.ReactNode = null;
  if (status?.running) {
    const inUse = selectedProviderId !== undefined && selectedProviderId.startsWith('local-llama-cpp-');
    body = (
      <>
        <span className='truncate text-12px'>{status.name}</span>
        {inUse ? (
          <Tag size='small' color='green'>
            {t('guid.localModels.inUse')}
          </Tag>
        ) : (
          <Button size='mini' type='primary' onClick={() => void useInChat()}>
            {t('guid.localModels.useInChat')}
          </Button>
        )}
      </>
    );
  } else if (llmCount > 0) {
    body = (
      <>
        <span className='truncate text-12px'>{t('guid.localModels.found', { count: llmCount })}</span>
        <Button size='mini' onClick={() => openSettings('model')}>
          {t('guid.localModels.load')}
        </Button>
      </>
    );
  } else if (executableMissing) {
    body = (
      <>
        <span className='truncate text-12px'>{t('guid.localModels.installTitle')}</span>
        <Button
          size='mini'
          type='text'
          icon={<Link theme='outline' size='14' />}
          onClick={() => void openExternalUrl(LLAMA_CPP_RELEASES_URL)}
        >
          {t('guid.localModels.install')}
        </Button>
      </>
    );
  }

  if (!body) return null;

  return (
    <>
      <div
        className='flex items-center gap-8px px-12px py-6px rounded-8px bg-fill-1 max-w-full'
        aria-label={t('guid.localModels.title')}
      >
        <Computer theme='outline' size='14' className='text-t-secondary shrink-0' />
        {body}
      </div>
      {settingsModal}
    </>
  );
};

export default LocalModelCard;
