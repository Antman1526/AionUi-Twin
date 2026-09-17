/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/config/storage';
import type { SpeechToTextConfig, SpeechToTextProvider, TextToSpeechConfig } from '@/common/types/speech';
import AionSelect from '@/renderer/components/base/AionSelect';
import { TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT } from '@/renderer/services/TextToSpeechService';
import { Divider, Form, Input, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TextToSpeechSection from './TextToSpeechSection';
import WhisperLocalPanel from './WhisperLocalPanel';

const SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT = 'aionui:speech-to-text-config-changed';

const DEFAULT_SPEECH_TO_TEXT_CONFIG: SpeechToTextConfig = {
  enabled: false,
  provider: 'openai',
  openai: {
    apiKey: '',
    baseUrl: '',
    language: '',
    model: 'whisper-1',
  },
  deepgram: {
    apiKey: '',
    baseUrl: '',
    detectLanguage: true,
    language: '',
    model: 'nova-2',
    punctuate: true,
    smartFormat: true,
  },
  whisperLocal: {
    modelPath: '',
    language: '',
  },
};

const DEFAULT_TEXT_TO_SPEECH_CONFIG: TextToSpeechConfig = {
  enabled: false,
  rate: 1,
  autoReadReplies: false,
};

const normalizeSpeechToTextConfig = (config?: SpeechToTextConfig): SpeechToTextConfig => ({
  ...DEFAULT_SPEECH_TO_TEXT_CONFIG,
  ...config,
  openai: {
    ...DEFAULT_SPEECH_TO_TEXT_CONFIG.openai,
    ...config?.openai,
  },
  deepgram: {
    ...DEFAULT_SPEECH_TO_TEXT_CONFIG.deepgram,
    ...config?.deepgram,
  },
  whisperLocal: {
    ...DEFAULT_SPEECH_TO_TEXT_CONFIG.whisperLocal,
    ...config?.whisperLocal,
  },
});

const normalizeTextToSpeechConfig = (config?: TextToSpeechConfig): TextToSpeechConfig => ({
  ...DEFAULT_TEXT_TO_SPEECH_CONFIG,
  ...config,
});

/**
 * Voice settings mount point: speech-to-text (cloud providers + the offline
 * `whisper-local` runtime) and text-to-speech ("Read aloud"). Fully
 * self-contained — loads and persists both `tools.speechToText` and
 * `tools.textToSpeech` on its own so `ToolsModalContent` only needs to render
 * `<SpeechSettings />`.
 */
const SpeechSettings: React.FC = () => {
  const { t } = useTranslation();
  const [speechToTextConfig, setSpeechToTextConfig] = useState<SpeechToTextConfig>(DEFAULT_SPEECH_TO_TEXT_CONFIG);
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig>(DEFAULT_TEXT_TO_SPEECH_CONFIG);

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const [storedSpeechToText, storedTextToSpeech] = await Promise.all([
          ConfigStorage.get('tools.speechToText'),
          ConfigStorage.get('tools.textToSpeech'),
        ]);
        setSpeechToTextConfig(normalizeSpeechToTextConfig(storedSpeechToText));
        setTextToSpeechConfig(normalizeTextToSpeechConfig(storedTextToSpeech));
      } catch (error) {
        console.error('Failed to load speech config:', error);
      }
    };
    void loadConfigs();
  }, []);

  const updateSpeechToTextConfig = useCallback((updater: (current: SpeechToTextConfig) => SpeechToTextConfig) => {
    setSpeechToTextConfig((current) => {
      const next = normalizeSpeechToTextConfig(updater(current));
      ConfigStorage.set('tools.speechToText', next).catch((error) => {
        console.error('Failed to save speech-to-text config:', error);
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT));
      }
      return next;
    });
  }, []);

  const updateTextToSpeechConfig = useCallback((updater: (current: TextToSpeechConfig) => TextToSpeechConfig) => {
    setTextToSpeechConfig((current) => {
      const next = normalizeTextToSpeechConfig(updater(current));
      ConfigStorage.set('tools.textToSpeech', next).catch((error) => {
        console.error('Failed to save text-to-speech config:', error);
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT));
      }
      return next;
    });
  }, []);

  const renderSpeechToTextFieldLabel = useCallback(
    (labelKey: string, requirement: 'required' | 'optional') => (
      <span className='inline-flex items-center gap-6px'>
        <span>{t(labelKey)}</span>
        <span aria-hidden='true' className='text-12px text-t-tertiary'>
          ({t(requirement === 'required' ? 'settings.speechToTextRequired' : 'settings.speechToTextOptional')})
        </span>
      </span>
    ),
    [t]
  );

  const handleProviderChange = useCallback(
    (value: string) => {
      updateSpeechToTextConfig((current) => ({
        ...current,
        provider: value as SpeechToTextProvider,
      }));
    },
    [updateSpeechToTextConfig]
  );

  const handleOpenAIChange = useCallback(
    (field: keyof NonNullable<SpeechToTextConfig['openai']>, value: string) => {
      updateSpeechToTextConfig((current) => ({
        ...current,
        openai: { ...current.openai, [field]: value },
      }));
    },
    [updateSpeechToTextConfig]
  );

  const handleDeepgramChange = useCallback(
    (field: keyof NonNullable<SpeechToTextConfig['deepgram']>, value: string | boolean) => {
      updateSpeechToTextConfig((current) => ({
        ...current,
        deepgram: { ...current.deepgram, [field]: value },
      }));
    },
    [updateSpeechToTextConfig]
  );

  const handleWhisperLanguageChange = useCallback(
    (value: string) => {
      updateSpeechToTextConfig((current) => ({
        ...current,
        whisperLocal: { ...current.whisperLocal, language: value },
      }));
    },
    [updateSpeechToTextConfig]
  );

  return (
    <>
      <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-border-2'>
        <div className='flex items-center justify-between gap-12px mb-8px'>
          <div className='flex flex-col gap-4px'>
            <span className='text-14px text-t-primary'>{t('settings.speechToText')}</span>
            <span className='text-13px text-t-secondary'>{t('settings.speechToTextDescription')}</span>
          </div>
          <Switch
            checked={speechToTextConfig.enabled}
            onChange={(checked) => updateSpeechToTextConfig((current) => ({ ...current, enabled: checked }))}
          />
        </div>

        <Divider className='mt-0px mb-20px' />

        <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
          <Form.Item label={t('settings.speechToTextProvider')}>
            <AionSelect value={speechToTextConfig.provider} onChange={handleProviderChange}>
              <AionSelect.Option value='openai'>{t('settings.speechToTextProviderOpenAI')}</AionSelect.Option>
              <AionSelect.Option value='deepgram'>{t('settings.speechToTextProviderDeepgram')}</AionSelect.Option>
              <AionSelect.Option value='whisper-local'>{t('settings.voice.providerWhisperLocal')}</AionSelect.Option>
            </AionSelect>
          </Form.Item>

          {speechToTextConfig.provider === 'openai' && (
            <>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextApiKey', 'required')}>
                <Input.Password
                  value={speechToTextConfig.openai?.apiKey}
                  visibilityToggle
                  onChange={(value) => handleOpenAIChange('apiKey', value)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextBaseUrl', 'optional')}>
                <Input
                  value={speechToTextConfig.openai?.baseUrl}
                  onChange={(value) => handleOpenAIChange('baseUrl', value)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextModel', 'optional')}>
                <Input
                  value={speechToTextConfig.openai?.model}
                  onChange={(value) => handleOpenAIChange('model', value)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextLanguage', 'optional')}>
                <Input
                  value={speechToTextConfig.openai?.language}
                  onChange={(value) => handleOpenAIChange('language', value)}
                />
              </Form.Item>
            </>
          )}

          {speechToTextConfig.provider === 'deepgram' && (
            <>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextApiKey', 'required')}>
                <Input.Password
                  value={speechToTextConfig.deepgram?.apiKey}
                  visibilityToggle
                  onChange={(value) => handleDeepgramChange('apiKey', value)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextBaseUrl', 'optional')}>
                <Input
                  value={speechToTextConfig.deepgram?.baseUrl}
                  onChange={(value) => handleDeepgramChange('baseUrl', value)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextModel', 'optional')}>
                <Input
                  value={speechToTextConfig.deepgram?.model}
                  onChange={(value) => handleDeepgramChange('model', value)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextLanguage', 'optional')}>
                <Input
                  value={speechToTextConfig.deepgram?.language}
                  onChange={(value) => handleDeepgramChange('language', value)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextDetectLanguage', 'optional')}>
                <Switch
                  checked={speechToTextConfig.deepgram?.detectLanguage !== false}
                  onChange={(checked) => handleDeepgramChange('detectLanguage', checked)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextPunctuate', 'optional')}>
                <Switch
                  checked={speechToTextConfig.deepgram?.punctuate !== false}
                  onChange={(checked) => handleDeepgramChange('punctuate', checked)}
                />
              </Form.Item>
              <Form.Item label={renderSpeechToTextFieldLabel('settings.speechToTextSmartFormat', 'optional')}>
                <Switch
                  checked={speechToTextConfig.deepgram?.smartFormat !== false}
                  onChange={(checked) => handleDeepgramChange('smartFormat', checked)}
                />
              </Form.Item>
            </>
          )}
        </Form>

        {speechToTextConfig.provider === 'whisper-local' && (
          <WhisperLocalPanel
            language={speechToTextConfig.whisperLocal?.language}
            onLanguageChange={handleWhisperLanguageChange}
          />
        )}
      </div>

      <TextToSpeechSection config={textToSpeechConfig} onChange={updateTextToSpeechConfig} />
    </>
  );
};

export default SpeechSettings;
