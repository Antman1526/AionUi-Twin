/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalModelRuntimeOptions } from '@/common/config/storage';
import { ConfigStorage } from '@/common/config/storage';
import { Button, InputNumber, Message, Select, Tag, Tooltip } from '@arco-design/web-react';
import { Close, FolderOpen, Info, Play, Plus, Power, Refresh, SettingTwo } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';

/** Human-readable byte size (binary units). */
const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const cleanRuntimeOptions = (options: LocalModelRuntimeOptions): LocalModelRuntimeOptions => {
  const next: LocalModelRuntimeOptions = {};
  if (options.contextSize !== undefined) next.contextSize = options.contextSize;
  if (options.gpuLayers !== undefined) next.gpuLayers = options.gpuLayers;
  if (options.readinessTimeoutMs !== undefined) next.readinessTimeoutMs = options.readinessTimeoutMs;
  if (options.reasoning !== undefined) next.reasoning = options.reasoning;
  return next;
};

const getGpuMode = (options: LocalModelRuntimeOptions): 'auto' | 'cpu' | 'custom' => {
  if (options.gpuLayers === undefined) return 'auto';
  return options.gpuLayers === 0 ? 'cpu' : 'custom';
};

const getTimeoutMode = (options: LocalModelRuntimeOptions): 'auto' | '300000' | '600000' | 'custom' => {
  if (options.readinessTimeoutMs === undefined) return 'auto';
  if (options.readinessTimeoutMs === 300_000) return '300000';
  if (options.readinessTimeoutMs === 600_000) return '600000';
  return 'custom';
};

const LocalGgufModels: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate: mutateGlobal } = useSWRConfig();
  const [message, messageContext] = Message.useMessage();
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [expandedOptionsPath, setExpandedOptionsPath] = useState<string | null>(null);

  const { data: scan, mutate: mutateScan } = useSWR('local-model.list', () =>
    ipcBridge.localModel.listModels.invoke().then((res) => res.data ?? { roots: [], models: [] })
  );
  const { data: status, mutate: mutateStatus } = useSWR('local-model.status', () =>
    ipcBridge.localModel.getStatus.invoke().then((res) => res.data)
  );
  const { data: directories, mutate: mutateDirectories } = useSWR('local-model.directories', () =>
    ipcBridge.localModel.getDirectories.invoke().then((res) => res.data ?? [])
  );
  const { data: runtimeOptions, mutate: mutateRuntimeOptions } = useSWR('local-model.runtime-options', () =>
    ipcBridge.localModel.getRuntimeOptions.invoke().then((res) => res.data ?? {})
  );

  const llmModels = (scan?.models ?? []).filter((model) => model.kind === 'llm');
  const missingRoots = (scan?.roots ?? []).filter((root) => !root.exists);
  const runningPath = status?.running ? status.modelPath : undefined;

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

  const refreshProviders = (): void => {
    void mutateStatus();
    void mutateGlobal('model.config');
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
      ConfigStorage.set('gemini.defaultModel', modelRef),
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
        message.success?.(t('settings.localGguf.loadedMessage', { name }));
        refreshProviders();
      } else {
        message.error?.(res.msg || t('settings.localGguf.loadFailed'));
      }
    } catch (error) {
      message.error?.(error instanceof Error ? error.message : t('settings.localGguf.loadFailed'));
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

  const renderAdvancedOptions = (modelPath: string) => {
    const options = runtimeOptions?.[modelPath] ?? {};
    const gpuMode = getGpuMode(options);
    const timeoutMode = getTimeoutMode(options);

    return (
      <div className='px-12px pb-10px pt-2px border-t-1px border-solid border-[var(--color-border-2)] bg-fill-1'>
        <div className='grid grid-cols-1 md:grid-cols-4 gap-10px'>
          <div>
            <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.contextSize')}</div>
            <InputNumber
              size='mini'
              min={512}
              max={262144}
              step={512}
              value={options.contextSize}
              placeholder={t('settings.localGguf.auto')}
              onChange={(value) =>
                patchRuntimeOptions(modelPath, {
                  contextSize: typeof value === 'number' && Number.isFinite(value) ? value : undefined,
                })
              }
            />
          </div>
          <div>
            <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.gpuLayers')}</div>
            <div className='flex gap-6px'>
              <Select
                size='mini'
                value={gpuMode}
                className='min-w-110px'
                onChange={(value) => {
                  if (value === 'auto') patchRuntimeOptions(modelPath, { gpuLayers: undefined });
                  if (value === 'cpu') patchRuntimeOptions(modelPath, { gpuLayers: 0 });
                  if (value === 'custom') patchRuntimeOptions(modelPath, { gpuLayers: options.gpuLayers || 99 });
                }}
              >
                <Select.Option value='auto'>{t('settings.localGguf.auto')}</Select.Option>
                <Select.Option value='cpu'>{t('settings.localGguf.cpuOnly')}</Select.Option>
                <Select.Option value='custom'>{t('settings.localGguf.custom')}</Select.Option>
              </Select>
              {gpuMode === 'custom' ? (
                <InputNumber
                  size='mini'
                  min={0}
                  max={999}
                  step={1}
                  value={options.gpuLayers}
                  onChange={(value) =>
                    patchRuntimeOptions(modelPath, {
                      gpuLayers: typeof value === 'number' && Number.isFinite(value) ? value : undefined,
                    })
                  }
                />
              ) : null}
            </div>
          </div>
          <div>
            <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.timeout')}</div>
            <div className='flex gap-6px'>
              <Select
                size='mini'
                value={timeoutMode}
                className='min-w-110px'
                onChange={(value) => {
                  if (value === 'auto') patchRuntimeOptions(modelPath, { readinessTimeoutMs: undefined });
                  if (value === '300000') patchRuntimeOptions(modelPath, { readinessTimeoutMs: 300_000 });
                  if (value === '600000') patchRuntimeOptions(modelPath, { readinessTimeoutMs: 600_000 });
                  if (value === 'custom') {
                    patchRuntimeOptions(modelPath, { readinessTimeoutMs: options.readinessTimeoutMs || 300_000 });
                  }
                }}
              >
                <Select.Option value='auto'>{t('settings.localGguf.auto')}</Select.Option>
                <Select.Option value='300000'>{t('settings.localGguf.timeoutFiveMinutes')}</Select.Option>
                <Select.Option value='600000'>{t('settings.localGguf.timeoutTenMinutes')}</Select.Option>
                <Select.Option value='custom'>{t('settings.localGguf.custom')}</Select.Option>
              </Select>
              {timeoutMode === 'custom' ? (
                <InputNumber
                  size='mini'
                  min={30}
                  max={900}
                  step={30}
                  value={Math.round((options.readinessTimeoutMs ?? 300_000) / 1000)}
                  onChange={(value) =>
                    patchRuntimeOptions(modelPath, {
                      readinessTimeoutMs:
                        typeof value === 'number' && Number.isFinite(value) ? Math.round(value) * 1000 : undefined,
                    })
                  }
                />
              ) : null}
            </div>
          </div>
          <div>
            <div className='text-11px text-t-secondary mb-4px'>{t('settings.localGguf.reasoning')}</div>
            <Select
              size='mini'
              value={options.reasoning ?? 'auto'}
              className='w-full'
              onChange={(value) => {
                if (value === 'auto') patchRuntimeOptions(modelPath, { reasoning: undefined });
                if (value === 'off' || value === 'on') patchRuntimeOptions(modelPath, { reasoning: value });
              }}
            >
              <Select.Option value='auto'>{t('settings.localGguf.auto')}</Select.Option>
              <Select.Option value='off'>{t('settings.localGguf.reasoningOff')}</Select.Option>
              <Select.Option value='on'>{t('settings.localGguf.reasoningOn')}</Select.Option>
            </Select>
          </div>
        </div>
        <div className='text-11px text-t-secondary mt-8px'>{t('settings.localGguf.advancedHint')}</div>
      </div>
    );
  };

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

      {llmModels.length === 0 ? (
        <div className='text-12px text-t-secondary py-8px'>{t('settings.localGguf.noModels')}</div>
      ) : (
        <div className='flex flex-col gap-6px'>
          {llmModels.map((model) => {
            const isRunning = runningPath === model.path;
            const isBusy = busyPath === model.path;
            const optionsExpanded = expandedOptionsPath === model.path;
            return (
              <div
                key={model.path}
                className='rounded-6px border-1px border-solid border-[var(--color-border-2)] overflow-hidden'
              >
                <div className='flex items-center justify-between gap-8px px-12px py-8px'>
                  <div className='flex items-center gap-8px min-w-0'>
                    <span className='truncate text-13px'>{model.name}</span>
                    <Tag size='small' color='gray'>
                      {formatBytes(model.sizeBytes)}
                    </Tag>
                    {isRunning ? (
                      <Tag size='small' color='green'>
                        {t('settings.localGguf.running')}
                      </Tag>
                    ) : null}
                  </div>
                  <div className='flex items-center gap-6px shrink-0'>
                    <Tooltip content={t('settings.localGguf.advancedOptions')}>
                      <Button
                        size='mini'
                        type='text'
                        icon={<SettingTwo theme='outline' size='14' />}
                        onClick={() => setExpandedOptionsPath(optionsExpanded ? null : model.path)}
                      />
                    </Tooltip>
                    {isRunning ? (
                      <>
                        <Button size='mini' type='primary' onClick={() => void handleUseInChat()}>
                          {t('settings.localGguf.useInChat')}
                        </Button>
                        <Button
                          size='mini'
                          status='danger'
                          icon={<Power theme='outline' size='14' />}
                          loading={isBusy}
                          onClick={() => void handleUnload()}
                        >
                          {t('settings.localGguf.unload')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size='mini'
                        type='primary'
                        icon={<Play theme='outline' size='14' />}
                        loading={isBusy}
                        disabled={busyPath !== null && !isBusy}
                        onClick={() => void handleLoad(model.path, model.name)}
                      >
                        {isBusy ? t('settings.localGguf.loadingState') : t('settings.localGguf.load')}
                      </Button>
                    )}
                  </div>
                </div>
                {optionsExpanded ? renderAdvancedOptions(model.path) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LocalGgufModels;
