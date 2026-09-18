/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { WhisperExecutableStatus, WhisperLocalModel, WhisperLocalStatus } from '@/common/adapter/ipcBridge';
import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import AionSelect from '@/renderer/components/base/AionSelect';
import { Alert, Button, Divider, Form, Message, Progress, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const WHISPER_RELEASES_URL = 'https://github.com/ggml-org/whisper.cpp/releases';

type LocalWhisperPanelProps = {
  config: SpeechToTextConfig;
  onChange: (updater: (current: SpeechToTextConfig) => SpeechToTextConfig) => void;
};

/** Per-platform install hint. The Homebrew formula is `whisper.cpp`. */
const installHintKey = (platform: string): string => {
  if (platform === 'darwin') return 'settings.voice.localInstallHintMac';
  if (platform === 'win32') return 'settings.voice.localInstallHintWindows';
  return 'settings.voice.localInstallHintLinux';
};

const LocalWhisperPanel: React.FC<LocalWhisperPanelProps> = ({ config, onChange }) => {
  const { t } = useTranslation();
  const [executable, setExecutable] = useState<WhisperExecutableStatus | null>(null);
  const [models, setModels] = useState<WhisperLocalModel[]>([]);
  const [runtime, setRuntime] = useState<WhisperLocalStatus>({ running: false });
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const refreshModels = useCallback(async () => {
    const response = await ipcBridge.speechToText.local.listModels.invoke();
    if (response.success && response.data) {
      setModels(response.data);
    }
  }, []);

  useEffect(() => {
    void ipcBridge.speechToText.local.getExecutableStatus.invoke().then((response) => {
      if (response.success && response.data) setExecutable(response.data);
    });
    void ipcBridge.speechToText.local.status.invoke().then((response) => {
      if (response.success && response.data) setRuntime(response.data);
    });
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    return ipcBridge.speechToText.local.downloadProgress.on((progress) => {
      setDownloading((current) => {
        if (progress.status === 'downloading') {
          return { ...current, [progress.id]: progress.percent };
        }
        const { [progress.id]: _removed, ...rest } = current;
        return rest;
      });
      if (progress.status === 'completed') {
        void refreshModels();
      }
    });
  }, [refreshModels]);

  const handleDownload = useCallback(
    async (id: string) => {
      setDownloading((current) => ({ ...current, [id]: 0 }));
      const response = await ipcBridge.speechToText.local.downloadModel.invoke({ id });
      if (!response.success) {
        setDownloading((current) => {
          const { [id]: _removed, ...rest } = current;
          return rest;
        });
        Message.error(response.msg || t('settings.voice.localDownloadFailed'));
        return;
      }
      await refreshModels();
    },
    [refreshModels, t]
  );

  const handleSelect = useCallback(
    (modelPath: string) => {
      onChange((current) => ({
        ...current,
        whisperLocal: { ...current.whisperLocal, modelPath },
      }));
    },
    [onChange]
  );

  const handleStart = useCallback(async () => {
    const modelPath = config.whisperLocal?.modelPath;
    if (!modelPath) {
      Message.warning(t('settings.voice.localNeedModel'));
      return;
    }
    setBusy(true);
    const response = await ipcBridge.speechToText.local.start.invoke({ modelPath });
    setBusy(false);
    if (!response.success || !response.data) {
      Message.error(response.msg || t('settings.voice.localStartFailed'));
      return;
    }
    setRuntime(response.data);
  }, [config.whisperLocal?.modelPath, t]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    const response = await ipcBridge.speechToText.local.stop.invoke();
    setBusy(false);
    setRuntime(response.success && response.data ? response.data : { running: false });
  }, []);

  const downloadedModels = models.filter((model) => model.downloaded);
  const selectedPath = config.whisperLocal?.modelPath ?? '';

  return (
    <div className='flex flex-col gap-12px'>
      <Alert
        type={executable?.installed ? 'success' : 'warning'}
        content={
          executable?.installed ? (
            t('settings.voice.localExecutableFound', { path: executable.executablePath ?? '' })
          ) : (
            <span>
              {t('settings.voice.localExecutableMissing')} {t(installHintKey(executable?.platform ?? 'linux'))}{' '}
              <a href={WHISPER_RELEASES_URL} target='_blank' rel='noreferrer'>
                {WHISPER_RELEASES_URL}
              </a>
            </span>
          )
        }
      />

      <div className='flex flex-col gap-8px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.localModels')}</span>
        {models.map((model) => {
          const percent = downloading[model.id];
          return (
            <div key={model.id} className='flex items-center justify-between gap-12px'>
              <span className='text-13px text-t-primary'>
                {model.label} · {Math.round(model.sizeBytes / 1024 / 1024)} MB
              </span>
              {percent === undefined ? (
                model.downloaded ? (
                  <span className='text-13px text-t-secondary'>{t('settings.voice.localDownloaded')}</span>
                ) : (
                  <Button size='mini' type='outline' onClick={() => void handleDownload(model.id)}>
                    {t('settings.voice.localDownload')}
                  </Button>
                )
              ) : (
                <Progress size='small' percent={percent} className='w-120px' />
              )}
            </div>
          );
        })}
      </div>

      <Divider className='my-4px' />

      <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
        <Form.Item label={t('settings.voice.localModel')}>
          <AionSelect
            value={selectedPath || undefined}
            onChange={handleSelect}
            placeholder={t('settings.voice.localNeedModel')}
          >
            {downloadedModels.map((model) => (
              <AionSelect.Option key={model.id} value={model.path ?? ''}>
                {model.label}
              </AionSelect.Option>
            ))}
          </AionSelect>
        </Form.Item>

        <Form.Item label={t('settings.voice.localTranslate')}>
          <Switch
            checked={config.whisperLocal?.translate ?? false}
            onChange={(checked) =>
              onChange((current) => ({
                ...current,
                whisperLocal: { ...current.whisperLocal, translate: checked },
              }))
            }
          />
        </Form.Item>
      </Form>

      <div className='flex items-center gap-12px'>
        <Button
          type='outline'
          shape='round'
          loading={busy}
          disabled={!executable?.installed}
          onClick={() => void (runtime.running ? handleStop() : handleStart())}
        >
          {runtime.running ? t('settings.voice.localStop') : t('settings.voice.localStart')}
        </Button>
        <span className='text-13px text-t-secondary'>
          {runtime.running
            ? t('settings.voice.localRunning', { port: runtime.port ?? 0 })
            : t('settings.voice.localStopped')}
        </span>
      </div>
    </div>
  );
};

export default LocalWhisperPanel;
