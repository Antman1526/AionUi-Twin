/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Message, Tag, Tooltip } from '@arco-design/web-react';
import { Close, FolderOpen, Info, Play, Plus, Power, Refresh } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';

/** Human-readable byte size (binary units). */
const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const LocalGgufModels: React.FC = () => {
  const { t } = useTranslation();
  const { mutate: mutateGlobal } = useSWRConfig();
  const [message, messageContext] = Message.useMessage();
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const { data: scan, mutate: mutateScan } = useSWR('local-model.list', () =>
    ipcBridge.localModel.listModels.invoke().then((res) => res.data ?? { roots: [], models: [] })
  );
  const { data: status, mutate: mutateStatus } = useSWR('local-model.status', () =>
    ipcBridge.localModel.getStatus.invoke().then((res) => res.data)
  );
  const { data: directories, mutate: mutateDirectories } = useSWR('local-model.directories', () =>
    ipcBridge.localModel.getDirectories.invoke().then((res) => res.data ?? [])
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
    const picked = await ipcBridge.dialog.showOpen({ properties: ['openDirectory'] });
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

  const handleLoad = async (modelPath: string, name: string): Promise<void> => {
    setBusyPath(modelPath);
    try {
      const res = await ipcBridge.localModel.start.invoke({ modelPath });
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
            return (
              <div
                key={model.path}
                className='flex items-center justify-between gap-8px px-12px py-8px rounded-6px border-1px border-solid border-[var(--color-border-2)]'
              >
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
                {isRunning ? (
                  <Button
                    size='mini'
                    status='danger'
                    icon={<Power theme='outline' size='14' />}
                    loading={isBusy}
                    onClick={() => void handleUnload()}
                  >
                    {t('settings.localGguf.unload')}
                  </Button>
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
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LocalGgufModels;
