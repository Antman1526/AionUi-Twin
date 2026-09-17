/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextToSpeechConfig } from '@/common/types/speech';
import AionSelect from '@/renderer/components/base/AionSelect';
import TextToSpeechService, { isTextToSpeechSupported } from '@/renderer/services/TextToSpeechService';
import { Button, Divider, Form, Message, Slider, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type TextToSpeechSectionProps = {
  config: TextToSpeechConfig;
  onChange: (updater: (current: TextToSpeechConfig) => TextToSpeechConfig) => void;
};

/**
 * "Read aloud" settings — local, offline text-to-speech via the browser's
 * `speechSynthesis` API (system voices, no network call, no API key).
 */
const TextToSpeechSection: React.FC<TextToSpeechSectionProps> = ({ config, onChange }) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const supported = isTextToSpeechSupported();

  useEffect(() => {
    if (!supported) return;
    const refreshVoices = () => setVoices(TextToSpeechService.listVoices());
    refreshVoices();
    window.speechSynthesis?.addEventListener?.('voiceschanged', refreshVoices);
    return () => {
      window.speechSynthesis?.removeEventListener?.('voiceschanged', refreshVoices);
    };
  }, [supported]);

  const handleTestVoice = useCallback(() => {
    TextToSpeechService.speak(t('settings.voice.testPhrase'), {
      voiceURI: config.voiceURI,
      rate: config.rate,
    }).catch(() => {
      Message.error(t('settings.voice.testVoiceFailed'));
    });
  }, [config.rate, config.voiceURI, t]);

  if (!supported) return null;

  return (
    <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-border-2'>
      <div className='flex items-center justify-between gap-12px mb-8px'>
        <div className='flex flex-col gap-4px'>
          <span className='text-14px text-t-primary'>{t('settings.voice.readAloud')}</span>
          <span className='text-13px text-t-secondary'>{t('settings.voice.readAloudDescription')}</span>
        </div>
        <Switch
          checked={config.enabled}
          onChange={(checked) => onChange((current) => ({ ...current, enabled: checked }))}
        />
      </div>

      <Divider className='mt-0px mb-20px' />

      <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
        <Form.Item label={t('settings.voice.voiceLabel')}>
          <AionSelect
            value={config.voiceURI || ''}
            onChange={(value) => onChange((current) => ({ ...current, voiceURI: (value as string) || undefined }))}
          >
            <AionSelect.Option value=''>{t('settings.voice.voiceSystemDefault')}</AionSelect.Option>
            {voices.map((voice) => (
              <AionSelect.Option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </AionSelect.Option>
            ))}
          </AionSelect>
        </Form.Item>
        <Form.Item label={t('settings.voice.rate')}>
          <div className='flex items-center gap-12px' style={{ maxWidth: 320 }}>
            <Slider
              value={config.rate ?? 1}
              min={0.5}
              max={2}
              step={0.1}
              style={{ flex: 1 }}
              onChange={(value) => onChange((current) => ({ ...current, rate: value as number }))}
            />
            <span className='text-13px text-t-secondary w-36px text-right'>{(config.rate ?? 1).toFixed(1)}x</span>
          </div>
        </Form.Item>
        <Form.Item label={t('settings.voice.autoReadReplies')}>
          <Switch
            checked={config.autoReadReplies === true}
            onChange={(checked) => onChange((current) => ({ ...current, autoReadReplies: checked }))}
          />
        </Form.Item>
        <Form.Item label=' '>
          <Button onClick={handleTestVoice}>{t('settings.voice.testVoice')}</Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default TextToSpeechSection;
