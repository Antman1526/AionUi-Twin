/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextToSpeechConfig } from '@/common/types/provider/speech';
import AionSelect from '@/renderer/components/base/AionSelect';
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import {
  DEFAULT_TEXT_TO_SPEECH_CONFIG,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT,
  cancel as cancelSpeech,
  isSpeechSynthesisSupported,
  listVoices,
  normalizeTextToSpeechConfig,
  speak,
} from '@/renderer/services/TextToSpeechService';
import { Alert, Button, Divider, Form, Slider, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type VoiceOption = { label: string; value: string };

const ReadAloudPanel: React.FC = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<TextToSpeechConfig>(DEFAULT_TEXT_TO_SPEECH_CONFIG);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const supported = isSpeechSynthesisSupported();

  useEffect(() => {
    let cancelled = false;
    void getClientBusinessSetting('tools.textToSpeech')
      .then((stored) => {
        if (!cancelled) setConfig(normalizeTextToSpeechConfig(stored));
      })
      .catch((error: unknown) => {
        console.error('Failed to load text-to-speech config:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const readVoices = () => {
      setVoices(listVoices().map((voice) => ({ label: `${voice.name} (${voice.lang})`, value: voice.voiceURI })));
    };
    readVoices();
    // Chromium populates the voice list asynchronously on first access.
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    synth?.addEventListener?.('voiceschanged', readVoices);
    return () => synth?.removeEventListener?.('voiceschanged', readVoices);
  }, []);

  // Stop any in-flight test when the settings modal unmounts.
  useEffect(() => () => cancelSpeech(), []);

  const updateConfig = useCallback((updater: (current: TextToSpeechConfig) => TextToSpeechConfig) => {
    setConfig((current) => {
      const next = normalizeTextToSpeechConfig(updater(current));
      void setClientBusinessSetting('tools.textToSpeech', next).catch((error: unknown) => {
        console.error('Failed to save text-to-speech config:', error);
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT));
      }
      return next;
    });
  }, []);

  const handleTest = useCallback(() => {
    if (isTesting) {
      cancelSpeech();
      setIsTesting(false);
      return;
    }
    // Set the flag before speaking so a double-click cannot queue two utterances.
    setIsTesting(true);
    const started = speak(t('settings.voice.readAloudSample'), {
      voiceURI: config.voiceURI,
      rate: config.rate,
      onEnd: () => setIsTesting(false),
      onError: () => setIsTesting(false),
    });
    if (!started) setIsTesting(false);
  }, [config.rate, config.voiceURI, isTesting, t]);

  return (
    <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-border-2 mt-16px'>
      <div className='flex items-center justify-between gap-12px mb-8px'>
        <div className='flex flex-col gap-4px'>
          <span className='text-14px text-t-primary'>{t('settings.voice.readAloud')}</span>
          <span className='text-13px text-t-secondary'>{t('settings.voice.readAloudDescription')}</span>
        </div>
        <Switch
          checked={config.enabled}
          onChange={(checked) => updateConfig((current) => ({ ...current, enabled: checked }))}
        />
      </div>

      {config.enabled && (
        <>
          <Divider className='mt-0px mb-20px' />
          {!supported && (
            <Alert type='warning' content={t('settings.voice.readAloudUnsupported')} className='mb-12px' />
          )}
          <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
            <Form.Item label={t('settings.voice.readAloudVoice')}>
              <AionSelect
                value={config.voiceURI || ''}
                onChange={(value: string) => updateConfig((current) => ({ ...current, voiceURI: value }))}
              >
                <AionSelect.Option value=''>{t('settings.voice.readAloudVoiceDefault')}</AionSelect.Option>
                {voices.map((voice) => (
                  <AionSelect.Option key={voice.value} value={voice.value}>
                    {voice.label}
                  </AionSelect.Option>
                ))}
              </AionSelect>
            </Form.Item>

            <Form.Item label={t('settings.voice.readAloudRate')}>
              <Slider
                value={config.rate ?? 1}
                min={MIN_SPEECH_RATE}
                max={MAX_SPEECH_RATE}
                step={0.1}
                showTicks
                onChange={(value) =>
                  updateConfig((current) => ({ ...current, rate: Array.isArray(value) ? value[0] : value }))
                }
              />
            </Form.Item>

            <Form.Item label={t('settings.voice.readAloudAuto')}>
              <Switch
                checked={config.autoReadReplies ?? false}
                onChange={(checked) => updateConfig((current) => ({ ...current, autoReadReplies: checked }))}
              />
            </Form.Item>
          </Form>

          <Button type='outline' shape='round' disabled={!supported} onClick={handleTest}>
            {isTesting ? t('settings.voice.readAloudStop') : t('settings.voice.readAloudTest')}
          </Button>
        </>
      )}
    </div>
  );
};

export default ReadAloudPanel;
