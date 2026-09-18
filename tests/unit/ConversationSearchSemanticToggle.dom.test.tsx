/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchConversationMessagesInvoke = vi.fn();
const semanticQueryInvoke = vi.fn();
const semanticStatsInvoke = vi.fn();
const navigateMock = vi.fn();

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      searchConversationMessages: {
        invoke: (...args: unknown[]) => searchConversationMessagesInvoke(...args),
      },
    },
    semanticSearch: {
      query: { invoke: (...args: unknown[]) => semanticQueryInvoke(...args) },
      getStats: { invoke: (...args: unknown[]) => semanticStatsInvoke(...args) },
    },
  },
}));

vi.mock('@renderer/components/base/AionModal', () => ({
  default: ({ visible, children }: { visible?: boolean; children?: ReactNode }) =>
    visible ? <div data-testid='conversation-search-modal'>{children}</div> : null,
}));

vi.mock('@renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@renderer/utils/ui/focus', () => ({
  blockMobileInputFocus: vi.fn(),
  blurActiveElement: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import ConversationSearchPopover from '@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';

const openAndType = async (text: string): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: 'conversation.historySearch.tooltip' }));
  fireEvent.change(screen.getByPlaceholderText('conversation.historySearch.placeholder'), {
    target: { value: text },
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
};

const switchToSemantic = (): void => {
  fireEvent.click(screen.getByText('conversation.semanticSearch.modeSemantic'));
};

describe('ConversationSearchPopover semantic mode', () => {
  beforeEach(() => {
    searchConversationMessagesInvoke.mockReset().mockResolvedValue({
      items: [],
      total: 0,
      page: 0,
      page_size: 20,
      has_more: false,
    });
    semanticQueryInvoke.mockReset();
    semanticStatsInvoke.mockReset();
    navigateMock.mockReset();
    globalThis.localStorage?.clear?.();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders both search modes and starts on keyword', async () => {
    render(<ConversationSearchPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.historySearch.tooltip' }));

    expect(screen.getByText('conversation.semanticSearch.modeKeyword')).toBeInTheDocument();
    expect(screen.getByText('conversation.semanticSearch.modeSemantic')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('conversation.historySearch.placeholder')).toBeInTheDocument();
    expect(semanticQueryInvoke).not.toHaveBeenCalled();
  });

  it('calls the semantic bridge and renders score plus snippet after switching modes', async () => {
    semanticStatsInvoke.mockResolvedValue({ success: true, data: { enabled: true, rows: 12 } });
    semanticQueryInvoke.mockResolvedValue({
      success: true,
      data: [
        {
          conversationId: 'conv-1',
          messageId: 'msg-1',
          score: 0.82,
          snippet: 'the deploy script rotates credentials',
          conversationTitle: 'Topic A',
        },
      ],
    });

    render(<ConversationSearchPopover />);
    await openAndType('rotating secrets');
    await act(async () => {
      switchToSemantic();
    });

    await waitFor(() => {
      expect(semanticQueryInvoke).toHaveBeenCalledWith({
        text: 'rotating secrets',
        limit: 20,
        scope: { kind: 'conversations' },
      });
    });

    expect(await screen.findByText('the deploy script rotates credentials')).toBeInTheDocument();
    expect(screen.getByText('conversation.semanticSearch.score:{"score":82}')).toBeInTheDocument();
    // The keyword index is not queried while semantic mode is active.
    expect(searchConversationMessagesInvoke).toHaveBeenCalledTimes(1);
  });

  it('navigates to the hit exactly like a keyword result does', async () => {
    semanticStatsInvoke.mockResolvedValue({ success: true, data: { enabled: true, rows: 3 } });
    semanticQueryInvoke.mockResolvedValue({
      success: true,
      data: [
        {
          conversationId: 'conv-9',
          messageId: 'msg-9',
          score: 0.5,
          snippet: 'a matching chunk',
          conversationTitle: 'Topic B',
        },
      ],
    });

    render(<ConversationSearchPopover />);
    await openAndType('something');
    await act(async () => {
      switchToSemantic();
    });
    await screen.findByText('a matching chunk');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /a matching chunk/ }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/conversation/conv-9', {
        state: { targetMessageId: 'msg-9', fromConversationSearch: true },
      });
    });
  });

  it('shows a settings hint instead of an empty list when semantic search is off', async () => {
    semanticStatsInvoke.mockResolvedValue({ success: true, data: { enabled: false, rows: 0 } });

    render(<ConversationSearchPopover />);
    await openAndType('anything');
    await act(async () => {
      switchToSemantic();
    });

    expect(await screen.findByText('conversation.semanticSearch.disabledHint')).toBeInTheDocument();
    expect(semanticQueryInvoke).not.toHaveBeenCalled();
  });

  it('points at settings when the index is empty', async () => {
    semanticStatsInvoke.mockResolvedValue({ success: true, data: { enabled: true, rows: 0 } });

    render(<ConversationSearchPopover />);
    await openAndType('anything');
    await act(async () => {
      switchToSemantic();
    });

    expect(await screen.findByText('conversation.semanticSearch.notIndexed')).toBeInTheDocument();
    expect(semanticQueryInvoke).not.toHaveBeenCalled();
  });
});
