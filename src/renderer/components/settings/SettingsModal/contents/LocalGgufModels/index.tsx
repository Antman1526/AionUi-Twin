/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalModelInfo } from '@/common/adapter/ipcBridge';
import type { LocalModelRuntimeOptions } from '@/common/config/storage';
import { ConfigStorage } from '@/common/config/storage';
import { Alert, Button, Message, Tooltip } from '@arco-design/web-react';
import { Close, FolderOpen, Info, Plus, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import CatalogSection from './CatalogSection';
import ExecutablePanel from './ExecutablePanel';
import ModelRow from './ModelRow';
import RuntimeAlert, { type RuntimeAlertState } from './RuntimeAlert';
import SemanticSearchPanel from './SemanticSearchPanel';

/** Every SWR key under which a model selector caches the provider list. */
const MODEL_CONFIG_SWR_KEYS = ['model.config', 'model.config.shared', 'model.config.welcome'] as const;

const cleanRuntimeOptions = (options: LocalModelRuntimeOptions): LocalModelRuntimeOptions => {
  const next: LocalModelRuntimeOptions = {};
  if (options.contextSize !== undefined) next.contextSize = options.contextSize;
  if (options.gpuLayers !== undefined) next.gpuLayers = options.gpuLayers;
  if (options.readinessTimeoutMs !== undefined) next.readinessTimeoutMs = options.readinessTimeoutMs;
  if (options.reasoning !== undefined) next.reasoning = options.reasoning;
  if (options.embedding !== undefined) next.embedding = options.embedding;
  return next;
};

const LocalGgufModels: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate: mutateGlobal } = useSWRConfig();
  const [message, messageContext] = Message.useMessage();
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [expandedOptionsPath, setExpandedOptionsPath] = useState<string | null>(null);
  const [alertState, setAlertState] = useState<RuntimeAlertState | null>(null);

  const {
    data: scan,
    error: scanError,
    mutate: mutateScan,
  } = useSWR('local-model.list', async () => {
    const res = await ipcBridge.localModel.listModels.invoke();
    if (!res.success) throw new Error(res.msg || t('settings.localGguf.loadFailed'));
    return res.data ?? { roots: [], models: [] };
  });
  const { data: status, mutate: mutateStatus } = useSWR('local-model.status', () =>
    ipcBridge.localModel.getStatus.invoke().then((res) => res.data)
  );
  const { data: directories, mutate: mutateDirectories } = useSWR('local-model.directories', () =>
    ipcBridge.localModel.getDirectories.invoke().then((res) => res.data ?? [])
  );
  const { data: runtimeOptions, mutate: mutateRuntimeOptions } = useSWR('local-model.runtime-options', () =>
    ipcBridge.localModel.getRuntimeOptions.invoke().then((res) => res.data ?? {})
  );
  const { data: executable, mutate: mutateExecutable } = useSWR('local-model.executable-status', () =>
    ipcBridge.localModel.getExecutableStatus.invoke().then((res) => res.data)
  );

  const llmModels = (scan?.models ?? []).filter((model) => model.kind === 'llm');
  const missingRoots = (scan?.roots ?? []).filter((root) => !root.exists);
  const runningPath = status?.running ? status.modelPath : undefined;

  // Reuses ModelRow's SWR key, so the machine memory budget shown by the catalog
  // costs no extra IPC round trip.
  const { data: firstModelInfo } = useSWR<LocalModelInfo | null>(
    llmModels[0] ? ['local-model.info', llmModels[0].path] : null,
    async () => {
      const res = await ipcBridge.localModel.getModelInfo.invoke({ modelPath: llmModels[0].path });
      return res.success ? (res.data ?? null) : null;
    }
  );

  const refreshProviders = useCallback((): void => {
    void mutateStatus();
    // Each model selector reads the provider list under its own SWR key, so all of
    // them have to be invalidated for a load/crash to reach the chat and guid pickers.
    for (const key of MODEL_CONFIG_SWR_KEYS) void mutateGlobal(key);
  }, [mutateGlobal, mutateStatus]);

  // A managed server that dies takes its provider with it: surface why, and refresh
  // the model selector so the dead entry disappears from the chat picker.
  useEffect(() => {
    const removeListener = ipcBridge.localModel.runtimeChanged.on((event) => {
      if (event.status === 'crashed') {
        const reason = event.signal ? `signal ${event.signal}` : `code ${event.exitCode ?? 'unknown'}`;
        setAlertState({
          title: t('settings.localGguf.runtimeCrashedTitle'),
          detail: t('settings.localGguf.runtimeCrashedDetail', { reason }),
          log: event.stderrTail || undefined,
        });
      }
      refreshProviders();
    });
    return () => removeListener?.();
  }, [refreshProviders, t]);

  const applyDirectories = async (next: string[]): Promise<void> => {
    await ipcBridge.localModel.setDirectories.invoke({ directories: next });
    void mutateDirectories();
    void mutateScan();
  };

  const handleAddFolder = async (): Promise<void> => {
    const picked = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
    const folder = picked?.[0];
    if (!folder) return;
    await applyDirectories([...(directories ?? []), folder]);
  };

  const handleRemoveFolder = async (folder: string): Promise<void> => {
    await applyDirectories((directories ?? []).filter((dir) => dir !== folder));
  };

  const saveRuntimeOptions = async (modelPath: string, nextOptions: LocalModelRuntimeOptions): Promise<void> => {
    const cleaned = cleanRuntimeOptions(nextOptions);
    const res = await ipcBridge.localModel.setRuntimeOptions.invoke({ modelPath, options: cleaned });
    if (!res.success) {
      message.error?.(res.msg || t('settings.localGguf.optionsSaveFailed'));
      return;
    }
    void mutateRuntimeOptions({ ...runtimeOptions, [modelPath]: res.data ?? cleaned }, false);
  };

  const patchRuntimeOptions = (modelPath: string, patch: LocalModelRuntimeOptions): void => {
    const current = runtimeOptions?.[modelPath] ?? {};
    void saveRuntimeOptions(modelPath, { ...current, ...patch });
  };

  const findLoadedProviderRef = async (
    runtime: { baseUrl?: string; name?: string } | undefined
  ): Promise<{ id: string; useModel: string } | null> => {
    if (!runtime?.baseUrl || !runtime.name) return null;
    const providers = await ipcBridge.mode.getModelConfig.invoke();
    const provider = providers.find(
      (item) => item.baseUrl === runtime.baseUrl && Array.isArray(item.model) && item.model.includes(runtime.name!)
    );
    return provider ? { id: provider.id, useModel: runtime.name } : null;
  };

  const handleUseInChat = async (): Promise<void> => {
    const modelRef = await findLoadedProviderRef(status);
    if (!modelRef) {
      message.error?.(t('settings.localGguf.useInChatFailed'));
      return;
    }
    await Promise.all([
      ConfigStorage.set('guid.lastSelectedAgent', 'aionrs'),
      ConfigStorage.set('aionrs.defaultModel', modelRef),
    ]);
    message.success?.(t('settings.localGguf.useInChatReady'));
    void navigate('/guid');
  };

  const handleLoad = async (modelPath: string, name: string): Promise<void> => {
    setBusyPath(modelPath);
    try {
      const options = runtimeOptions?.[modelPath];
      const res = await ipcBridge.localModel.start.invoke({ modelPath, options });
      if (res.success) {
        setAlertState(null);
        message.success?.(t('settings.localGguf.loadedMessage', { name }));
        refreshProviders();
      } else {
        const reason = res.msg || t('settings.localGguf.loadFailed');
        const [summary, ...log] = reason.split('llama-server stderr:');
        setAlertState({
          title: t('settings.localGguf.runtimeErrorTitle'),
          detail: summary.trim(),
          log: log.join('llama-server stderr:').trim() || undefined,
        });
        message.error?.(t('settings.localGguf.loadFailed'));
      }
    } catch (error) {
      setAlertState({
        title: t('settings.localGguf.runtimeErrorTitle'),
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyPath(null);
    }
  };

  const handleUnload = async (): Promise<void> => {
    setBusyPath(runningPath ?? '__unload__');
    try {
      await ipcBridge.localModel.stop.invoke();
      message.info?.(t('settings.localGguf.unloadedMessage'));
      refreshProviders();
    } finally {
      setBusyPath(null);
    }
  };

  const refreshExecutable = useCallback((): void => {
    void mutateExecutable();
  }, [mutateExecutable]);

  const showError = useCallback(
    (text: string): void => {
      message.error?.(text);
    },
    [message]
  );

  const onCatalogDownloaded = useCallback((): void => {
    void mutateScan();
  }, [mutateScan]);

  return (
    <div className='mb-16px'>
      {messageContext}
      <div className='flex items-center justify-between mb-8px'>
        <div className='flex items-center gap-6px'>
          <span className='font-medium text-14px'>{t('settings.localGguf.title')}</span>
          <Tooltip content={t('settings.localGguf.serverHint')}>
            <Info theme='outline' size='14' className='text-t-secondary cursor-help' />
          </Tooltip>
        </div>
        <Button size='mini' icon={<Refresh theme='outline' size='14' />} onClick={() => void mutateScan()}>
          {t('settings.localGguf.refresh')}
        </Button>
      </div>
      <div className='text-12px text-t-secondary mb-12px'>{t('settings.localGguf.description')}</div>

      {alertState ? <RuntimeAlert state={alertState} onClose={() => setAlertState(null)} /> : null}

      <ExecutablePanel status={executable} onChanged={refreshExecutable} onError={showError} />

      <div className='flex items-center justify-between mb-6px'>
        <span className='text-12px text-t-secondary'>{t('settings.localGguf.foldersTitle')}</span>
        <Button size='mini' icon={<Plus theme='outline' size='14' />} onClick={() => void handleAddFolder()}>
          {t('settings.localGguf.addFolder')}
        </Button>
      </div>
      <div className='flex flex-col gap-4px mb-12px'>
        {(directories ?? []).map((dir) => (
          <div key={dir} className='flex items-center justify-between gap-8px px-10px py-4px rounded-6px bg-fill-1'>
            <div className='flex items-center gap-6px min-w-0'>
              <FolderOpen theme='outline' size='14' className='text-t-secondary shrink-0' />
              <span className='truncate text-12px'>{dir}</span>
            </div>
            <Tooltip content={t('settings.localGguf.removeFolder')}>
              <Button
                size='mini'
                type='text'
                icon={<Close theme='outline' size='14' />}
                onClick={() => void handleRemoveFolder(dir)}
              />
            </Tooltip>
          </div>
        ))}
      </div>

      {missingRoots.map((root) => (
        <div key={root.path} className='text-12px text-t-secondary mb-6px'>
          {t('settings.localGguf.folderMissing', { path: root.path })}
        </div>
      ))}

      {scanError ? (
        <Alert
          type='error'
          className='mb-8px'
          content={scanError instanceof Error ? scanError.message : String(scanError)}
        />
      ) : null}

      {!scanError && llmModels.length === 0 ? (
        <div className='text-12px text-t-secondary py-8px'>{t('settings.localGguf.noModels')}</div>
      ) : !scanError ? (
        <div className='flex flex-col gap-6px'>
          {llmModels.map((model) => (
            <ModelRow
              key={model.path}
              model={model}
              isRunning={runningPath === model.path}
              isBusy={busyPath === model.path}
              loadDisabled={busyPath !== null && busyPath !== model.path}
              optionsExpanded={expandedOptionsPath === model.path}
              options={runtimeOptions?.[model.path] ?? {}}
              onToggleOptions={() => setExpandedOptionsPath(expandedOptionsPath === model.path ? null : model.path)}
              onPatchOptions={(patch) => patchRuntimeOptions(model.path, patch)}
              onLoad={() => void handleLoad(model.path, model.name)}
              onUnload={() => void handleUnload()}
              onUseInChat={() => void handleUseInChat()}
            />
          ))}
        </div>
      ) : null}

      <CatalogSection
        budgetBytes={firstModelInfo?.fit?.budgetBytes}
        onDownloaded={onCatalogDownloaded}
        onError={showError}
      />

      <SemanticSearchPanel />
    </div>
  );
};

export default LocalGgufModels;
