/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TextToSpeechConfig } from '@/common/types/provider/speech';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import {
  DEFAULT_TEXT_TO_SPEECH_CONFIG,
  TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT,
  cancel as cancelSpeech,
  normalizeTextToSpeechConfig,
  speak,
} from '@/renderer/services/TextToSpeechService';
import { iconColors } from '@/renderer/styles/colors';
import { Tooltip } from '@arco-design/web-react';
import { Mute, VolumeNotice } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Message keys already read aloud automatically. Module-scoped so a remount of
 * the last message (scroll virtualization, a re-render after a tool card
 * settles) cannot make the same reply speak twice.
 */
const autoReadMessageKeys = new Set<string>();

type MessageSpeakButtonProps = {
  /** Stable identity of the reply, used to deduplicate auto-read. */
  messageKey: string;
  /** Full reply text, Markdown included — stripping happens in the service. */
  text: string;
  /** Only the last assistant message subscribes to the auto-read signal. */
  isLastMessage?: boolean;
};

const MessageSpeakButton: React.FC<MessageSpeakButtonProps> = ({ messageKey, text, isLastMessage = false }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<TextToSpeechConfig>(DEFAULT_TEXT_TO_SPEECH_CONFIG);
  const [isSpeakingHere, setIsSpeakingHere] = useState(false);
  const conversationContext = useConversationContextSafe();
  const conversationId = conversationContext?.conversation_id;

  const textRef = useRef(text);
  textRef.current = text;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getClientBusinessSetting('tools.textToSpeech')
        .then((stored) => {
          if (!cancelled) setConfig(normalizeTextToSpeechConfig(stored));
        })
        .catch(() => {
          /* keep defaults — read aloud simply stays off */
        });
    };
    load();
    window.addEventListener(TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT, load);
    };
  }, []);

  // Stop this message's playback when it leaves the screen. Reads a ref so the
  // cleanup only runs on unmount, not on every flip of the speaking flag.
  const isSpeakingRef = useRef(false);
  isSpeakingRef.current = isSpeakingHere;
  useEffect(
    () => () => {
      if (isSpeakingRef.current) cancelSpeech();
    },
    []
  );

  const startSpeaking = useCallback((value: string) => {
    // Flip the flag before calling speak() so a second click within the same
    // tick takes the "stop" branch instead of queueing a second utterance.
    setIsSpeakingHere(true);
    const started = speak(value, {
      voiceURI: configRef.current.voiceURI,
      rate: configRef.current.rate,
      onEnd: () => setIsSpeakingHere(false),
      onError: () => setIsSpeakingHere(false),
    });
    if (!started) setIsSpeakingHere(false);
  }, []);

  /**
   * Auto-read hooks `conversation.turnCompleted` — the same turn-boundary event
   * `useMessageLstCache` already treats as "the agent is done with this turn".
   * The per-chunk text stream has no terminal frame we could rely on, and the
   * last text chunk is indistinguishable from a mid-turn one, so this is the
   * only signal that means the reply is final.
   */
  useEffect(() => {
    if (!isLastMessage || !config.enabled || !config.autoReadReplies || !conversationId) {
      return;
    }
    return ipcBridge.conversation.turnCompleted.on((payload) => {
      if (payload.session_id !== conversationId) return;
      if (autoReadMessageKeys.has(messageKey)) return;
      autoReadMessageKeys.add(messageKey);
      startSpeaking(textRef.current);
    });
  }, [config.autoReadReplies, config.enabled, conversationId, isLastMessage, messageKey, startSpeaking]);

  const handleClick = useCallback(() => {
    if (isSpeakingHere) {
      cancelSpeech();
      setIsSpeakingHere(false);
      return;
    }
    startSpeaking(textRef.current);
  }, [isSpeakingHere, startSpeaking]);

  if (!config.enabled) {
    return null;
  }

  return (
    <Tooltip content={t(isSpeakingHere ? 'conversation.voice.stopReading' : 'conversation.voice.readAloud')}>
      <div
        className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
        onClick={handleClick}
        style={{ lineHeight: 0 }}
        data-testid='message-speak-button'
      >
        {isSpeakingHere ? (
          <Mute theme='outline' size='16' fill={iconColors.secondary} />
        ) : (
          <VolumeNotice theme='outline' size='16' fill={iconColors.secondary} />
        )}
      </div>
    </Tooltip>
  );
};

export default MessageSpeakButton;
