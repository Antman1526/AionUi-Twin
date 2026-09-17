import { fireEvent } from '@testing-library/dom';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockKeywordSearch = vi.hoisted(() => vi.fn());
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
// Stable identity: the component memoizes callbacks on `t`, and a fresh function
// per render would retrigger its effects forever.
const mockT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@arco-design/web-react', () => {
  const RadioGroup = ({
    value,
    onChange,
    children,
  }: {
    value: string;
    onChange: (value: string) => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid='mode-group' data-value={value}>
      {React.Children.map(children, (child) => {
        const option = child as React.ReactElement<{ value: string; children?: React.ReactNode }>;
        return (
          <button type='button' onClick={() => onChange(option.props.value)}>
            {option.props.children}
          </button>
        );
      })}
    </div>
  );
  const Radio = Object.assign(({ children }: { children?: React.ReactNode }) => <span>{children}</span>, {
    Group: RadioGroup,
  });
  return {
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
    Empty: ({ description }: { description?: React.ReactNode }) => <div data-testid='empty'>{description}</div>,
    Radio,
    Spin: () => <div data-testid='spin' />,
    Typography: { Paragraph: ({ children }: { children?: React.ReactNode }) => <p>{children}</p> },
  };
});

vi.mock('@icon-park/react', () => ({
  Close: () => <i />,
  CloseSmall: () => <i />,
  MessageOne: () => <i />,
  Search: () => <i />,
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) =>
    visible ? <div data-testid='search-modal'>{children}</div> : null,
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useOptionalConversationTabs: () => null,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({ getAgentLogo: () => null }));

vi.mock('@/renderer/utils/ui/focus', () => ({
  blockMobileInputFocus: vi.fn(),
  blurActiveElement: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/utils/exportHelpers', () => ({
  getBackendKeyFromConversation: () => 'gemini',
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { searchConversationMessages: { invoke: mockKeywordSearch } },
    semanticSearch: {
      getSettings: { invoke: mockGetSettings },
      query: { invoke: mockQuery },
    },
  },
}));

import ConversationSearchPopover from '@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';

const openModal = (): void => {
  render(<ConversationSearchPopover />);
  fireEvent.click(screen.getByLabelText('conversation.historySearch.tooltip'));
};

const switchToSemantic = (): void => {
  fireEvent.click(screen.getByText('conversation.semanticSearch.modeSemantic'));
};

beforeEach(() => {
  vi.clearAllMocks();
  mockKeywordSearch.mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 20, hasMore: false });
  mockGetSettings.mockResolvedValue({ success: true, data: { enabled: true, hasEmbeddingSource: true } });
  mockQuery.mockResolvedValue({ success: true, data: [] });
});

describe('ConversationSearchPopover semantic mode', () => {
  it('shows the Keyword / Semantic toggle, starting on Keyword', () => {
    openModal();

    expect(screen.getByText('conversation.semanticSearch.modeKeyword')).toBeInTheDocument();
    expect(screen.getByText('conversation.semanticSearch.modeSemantic')).toBeInTheDocument();
    expect(screen.getByTestId('mode-group')).toHaveAttribute('data-value', 'keyword');
  });

  it('calls the semantic bridge instead of the keyword bridge once switched', async () => {
    openModal();
    switchToSemantic();

    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('conversation.semanticSearch.placeholder'), {
      target: { value: 'deploy the service' },
    });

    await waitFor(() =>
      expect(mockQuery).toHaveBeenCalledWith({ text: 'deploy the service', limit: 20, scope: 'history' })
    );
    expect(mockKeywordSearch).not.toHaveBeenCalledWith(expect.objectContaining({ keyword: 'deploy the service' }));
  });

  it('renders each hit with its score and snippet and navigates on click', async () => {
    mockQuery.mockResolvedValue({
      success: true,
      data: [
        {
          conversationId: 'c1',
          messageId: 'm1#2',
          score: 0.8123,
          snippet: 'how to deploy the service',
          conversationTitle: 'Deploy notes',
        },
      ],
    });

    openModal();
    switchToSemantic();
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('conversation.semanticSearch.placeholder'), {
      target: { value: 'deploy' },
    });

    await waitFor(() => expect(screen.getByText('how to deploy the service')).toBeInTheDocument());
    expect(screen.getByText('conversation.semanticSearch.score')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Deploy notes'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/conversation/c1', {
        state: { targetMessageId: 'm1', fromConversationSearch: true },
      })
    );
  });

  it('shows a hint linking to settings when semantic search is disabled', async () => {
    mockGetSettings.mockResolvedValue({ success: true, data: { enabled: false, hasEmbeddingSource: false } });

    openModal();
    switchToSemantic();

    await waitFor(() => expect(screen.getByText('conversation.semanticSearch.disabledHint')).toBeInTheDocument());
    expect(mockQuery).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('settings.semanticSearch.title'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/model');
  });
});
