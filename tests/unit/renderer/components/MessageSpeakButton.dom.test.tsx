/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The read-aloud button on assistant messages: it only appears when read aloud
 * is enabled, and a second click stops instead of queueing another utterance.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  speak: vi.fn(() => true),
  cancel: vi.fn(),
  getClientBusinessSetting: vi.fn(),
  turnCompletedHandlers: [] as Array<(payload: { session_id: string }) => void>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnCompleted: {
        on: (handler: (payload: { session_id: string }) => void) => {
          mocks.turnCompletedHandlers.push(handler);
          return () => {
            mocks.turnCompletedHandlers.splice(mocks.turnCompletedHandlers.indexOf(handler), 1);
          };
        },
      },
    },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: (...args: unknown[]) => mocks.getClientBusinessSetting(...args),
}));

vi.mock('@/renderer/services/TextToSpeechService', () => ({
  DEFAULT_TEXT_TO_SPEECH_CONFIG: { enabled: false, autoReadReplies: false, rate: 1, voiceURI: '' },
  TEXT_TO_SPEECH_CONFIG_CHANGED_EVENT: 'aionui:text-to-speech-config-changed',
  cancel: (...args: unknown[]) => mocks.cancel(...args),
  normalizeTextToSpeechConfig: (config?: Record<string, unknown>) => ({
    enabled: false,
    autoReadReplies: false,
    rate: 1,
    voiceURI: '',
    ...config,
  }),
  speak: (...args: unknown[]) => mocks.speak(...args),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversation_id: 'conv-1' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MessageSpeakButton = (await import('@/renderer/pages/conversation/Messages/components/MessageSpeak')).default;

describe('MessageSpeakButton', () => {
  beforeEach(() => {
    mocks.speak.mockClear().mockReturnValue(true);
    mocks.cancel.mockClear();
    mocks.turnCompletedHandlers.length = 0;
    mocks.getClientBusinessSetting.mockResolvedValue({ enabled: true, autoReadReplies: false, rate: 1.2 });
  });

  it('renders nothing while read aloud is disabled', async () => {
    mocks.getClientBusinessSetting.mockResolvedValue({ enabled: false });
    render(<MessageSpeakButton messageKey='m1' text='hello' />);
    await waitFor(() => expect(mocks.getClientBusinessSetting).toHaveBeenCalled());
    expect(screen.queryByTestId('message-speak-button')).toBeNull();
  });

  it('speaks the message text on click', async () => {
    render(<MessageSpeakButton messageKey='m1' text='**hello**' />);
    const button = await screen.findByTestId('message-speak-button');

    fireEvent.click(button);

    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(mocks.speak.mock.calls[0][0]).toBe('**hello**');
    expect(mocks.speak.mock.calls[0][1]).toMatchObject({ rate: 1.2 });
  });

  it('stops instead of starting a second utterance on the next click', async () => {
    render(<MessageSpeakButton messageKey='m1' text='hello' />);
    const button = await screen.findByTestId('message-speak-button');

    fireEvent.click(button);
    fireEvent.click(button);

    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it('auto-reads the last reply once when a turn completes', async () => {
    mocks.getClientBusinessSetting.mockResolvedValue({ enabled: true, autoReadReplies: true, rate: 1 });
    render(<MessageSpeakButton messageKey='auto-1' text='the reply' isLastMessage />);
    await screen.findByTestId('message-speak-button');
    await waitFor(() => expect(mocks.turnCompletedHandlers.length).toBeGreaterThan(0));

    mocks.turnCompletedHandlers.forEach((handler) => handler({ session_id: 'other' }));
    expect(mocks.speak).not.toHaveBeenCalled();

    mocks.turnCompletedHandlers.forEach((handler) => handler({ session_id: 'conv-1' }));
    mocks.turnCompletedHandlers.forEach((handler) => handler({ session_id: 'conv-1' }));

    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(mocks.speak.mock.calls[0][0]).toBe('the reply');
  });
});
