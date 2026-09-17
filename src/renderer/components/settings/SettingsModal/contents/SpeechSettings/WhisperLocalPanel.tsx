/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  WhisperDownloadProgress,
  WhisperExecutableStatus,
  WhisperModelInfo,
  WhisperRuntimeStatus,
} from '@/common/types/speech';
import { Button, Input, Message, Progress, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from './formatBytes';

type WhisperLocalPanelProps = {
  language?: string;
  onLanguageChange: (language: string) => void;
};

/**
 * Executable status, curated model catalog (download/progress), and
 * start/stop controls for the managed offline `whisper-server` process.
 */
const WhisperLocalPanel: React.FC<WhisperLocalPanelProps> = ({ language, onLanguageChange }) => {
  const { t } = useTranslation();
  const [executableStatus, setExecutableStatus] = useState<WhisperExecutableStatus | null>(null);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<WhisperRuntimeStatus>({ running: false });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [busy, setBusy] = useState(false);

  const refreshModels = useCallback(async () => {
    const res = await ipcBridge.speechToText.local.listModels.invoke();
    if (res.success && res.data) setModels(res.data);
  }, []);

  const refreshStatus = useCallback(async () => {
    const res = await ipcBridge.speechToText.local.status.invoke();
    if (res.success && res.data) setRuntimeStatus(res.data);
  }, []);

  const refreshExecutable = useCallback(async () => {
    const res = await ipcBridge.speechToText.local.getExecutableStatus.invoke();
    if (res.success && res.data) setExecutableStatus(res.data);
  }, []);

  useEffect(() => {
    void refreshExecutable();
    void refreshModels();
    void refreshStatus();
  }, [refreshExecutable, refreshModels, refreshStatus]);

  useEffect(() => {
    return ipcBridge.speechToText.local.downloadProgress.on((progress: WhisperDownloadProgress) => {
      if (progress.id !== downloadingId) return;
      const percent = progress.totalBytes ? Math.round((progress.receivedBytes / progress.totalBytes) * 100) : 0;
      setDownloadPercent(percent);
      if (progress.state === 'done') {
        setDownloadingId(null);
        void refreshModels();
      } else if (progress.state === 'error' || progress.state === 'cancelled') {
        setDownloadingId(null);
        if (progress.state === 'error') {
          Message.error(progress.error || t('settings.voice.whisperModelDownloadFailed'));
        }
      }
    });
  }, [downloadingId, refreshModels, t]);

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    setDownloadPercent(0);
    const res = await ipcBridge.speechToText.local.downloadModel.invoke({ id });
    if (!res.success) {
      setDownloadingId(null);
      Message.error(res.msg || t('settings.voice.whisperModelDownloadFailed'));
    }
  };

  const handleStart = async (modelPath: string) => {
    setBusy(true);
    try {
      const res = await ipcBridge.speechToText.local.start.invoke({ modelPath });
      if (res.success && res.data) {
        setRuntimeStatus(res.data);
      } else {
        Message.error(res.msg || t('settings.voice.whisperServerStartFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const res = await ipcBridge.speechToText.local.stop.invoke();
      if (res.success && res.data) setRuntimeStatus(res.data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-12px mt-12px'>
      <div className='flex items-center gap-8px flex-wrap'>
        {executableStatus === null ? (
          <Tag>{t('settings.voice.whisperExecutableChecking')}</Tag>
        ) : executableStatus.found ? (
          <Tag color='green'>{t('settings.voice.whisperExecutableFound')}</Tag>
        ) : (
          <Tag color='red'>{t('settings.voice.whisperExecutableNotFound')}</Tag>
        )}
        {executableStatus?.found && executableStatus.path && (
          <span className='text-12px text-t-tertiary'>{executableStatus.path}</span>
        )}
      </div>

      {executableStatus && !executableStatus.found && (
        <div className='text-13px text-t-secondary flex flex-col gap-4px'>
          <span>{t('settings.voice.whisperInstallHintMac')}</span>
          <a
            href='https://github.com/ggml-org/whisper.cpp/releases'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))]'
          >
            {t('settings.voice.whisperReleasesLink')}
          </a>
        </div>
      )}

      <div className='flex items-center gap-8px'>
        <span className='text-13px text-t-secondary shrink-0'>{t('settings.voice.whisperLanguage')}</span>
        <Input
          value={language}
          placeholder={t('settings.voice.whisperLanguagePlaceholder')}
          onChange={onLanguageChange}
          style={{ maxWidth: 220 }}
        />
      </div>

      <div className='flex flex-col gap-8px'>
        <span className='text-13px text-t-primary'>{t('settings.voice.whisperModelsTitle')}</span>
        {models.map((model) => {
          const isActive = runtimeStatus.running && runtimeStatus.modelPath === model.path;
          const isDownloading = downloadingId === model.id;
          return (
            <div
              key={model.id}
              className='flex items-center justify-between gap-12px px-12px py-8px rd-8px border border-border-2'
            >
              <div className='flex flex-col gap-2px min-w-0'>
                <span className='text-13px text-t-primary'>{model.label}</span>
                <span className='text-12px text-t-tertiary'>{formatBytes(model.bytes)}</span>
                {isDownloading && <Progress percent={downloadPercent} size='small' style={{ width: 160 }} />}
              </div>
              <div className='flex items-center gap-8px shrink-0'>
                {isActive && (
                  <Tag color='arcoblue'>{t('settings.voice.whisperServerRunning', { port: runtimeStatus.port })}</Tag>
                )}
                {!model.downloaded ? (
                  <Button
                    size='small'
                    loading={isDownloading}
                    disabled={Boolean(downloadingId)}
                    onClick={() => void handleDownload(model.id)}
                  >
                    {t('settings.voice.whisperModelDownload')}
                  </Button>
                ) : isActive ? (
                  <Button size='small' status='danger' loading={busy} onClick={() => void handleStop()}>
                    {t('settings.voice.whisperServerStop')}
                  </Button>
                ) : (
                  <Button size='small' type='primary' loading={busy} onClick={() => void handleStart(model.path)}>
                    {t('settings.voice.whisperServerStart')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!runtimeStatus.running && (
        <span className='text-12px text-t-tertiary'>{t('settings.voice.whisperServerStopped')}</span>
      )}
    </div>
  );
};

export default WhisperLocalPanel;
