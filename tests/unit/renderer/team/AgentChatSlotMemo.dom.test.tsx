// tests/unit/renderer/team/AgentChatSlotMemo.dom.test.tsx
//
// DOM tests for TeamPage.tsx's AgentChatSlot memoization (see
// docs/architecture/team-mode-performance.md #2): one agent's status changing
// should not force every other slot in the team grid to re-render.

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TeamAgent } from '@/common/types/teamTypes';

// ---------------------------------------------------------------------------
// Mocks — mirrors the scaffolding in tests/unit/renderer/team-renderer.dom.test.tsx
// ---------------------------------------------------------------------------

const renderCounts: Record<string, number> = {};

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: vi.fn().mockResolvedValue({ id: 'conv-1', type: 'acp' }) },
      update: { invoke: vi.fn() },
    },
  },
}));

vi.mock('swr', () => ({
  default: (key: unknown) => {
    if (!key) return { data: undefined };
    const conversationId = (key as [string, string])[1];
    return { data: { id: conversationId, type: 'acp' } };
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { success: vi.fn(), error: vi.fn(), useMessage: () => [vi.fn(), null] },
  Modal: { confirm: vi.fn() },
  Spin: ({ loading }: { loading?: boolean }) => (loading ? <div data-testid='spin' /> : null),
}));

vi.mock('@icon-park/react', () => ({
  CloseSmall: () => <span data-testid='close-icon' />,
  FullScreen: () => <span data-testid='fullscreen-icon' />,
  OffScreen: () => <span data-testid='offscreen-icon' />,
  Left: () => <span data-testid='left-icon' />,
  Right: () => <span data-testid='right-icon' />,
}));

vi.mock('@/renderer/pages/team/components/TeamAgentIdentity', () => ({
  default: ({ agentName }: { agentName: string }) => <span data-testid='agent-identity'>{agentName}</span>,
}));

vi.mock('@/renderer/components/agent/AcpModelSelector', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/platforms/gemini/GeminiModelSelector', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiModelSelection', () => ({
  useGeminiModelSelection: () => ({}),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection', () => ({
  useAionrsModelSelection: () => ({}),
}));

vi.mock('@/renderer/pages/team/components/TeamChatView', () => ({
  default: (props: { conversation: { id: string } }) => {
    renderCounts[props.conversation.id] = (renderCounts[props.conversation.id] ?? 0) + 1;
    return <div data-testid={`chat-view-${props.conversation.id}`} />;
  },
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { AgentChatSlot } from '@/renderer/pages/team/TeamPage';

function makeAgent(overrides: Partial<TeamAgent> = {}): TeamAgent {
  return {
    slotId: 'slot-1',
    conversationId: 'conv-1',
    role: 'teammate',
    agentType: 'acp',
    agentName: 'Agent One',
    conversationType: 'acp',
    status: 'idle',
    ...overrides,
  };
}

describe('AgentChatSlot memoization', () => {
  beforeEach(() => {
    for (const key of Object.keys(renderCounts)) delete renderCounts[key];
  });

  it('does not re-render when the parent re-renders with an unchanged agent', () => {
    const agent = makeAgent();
    const { rerender } = render(<AgentChatSlot agent={agent} teamId='team-1' isLeader={false} />);
    expect(renderCounts['conv-1']).toBe(1);

    // Parent re-render with a brand new agent object but identical field values
    // (simulates the parent's `agents` array being rebuilt for an unrelated reason).
    rerender(<AgentChatSlot agent={{ ...agent }} teamId='team-1' isLeader={false} />);
    expect(renderCounts['conv-1']).toBe(1);
  });

  it('re-renders when the agent status changes', () => {
    const agent = makeAgent({ status: 'idle' });
    const { rerender } = render(<AgentChatSlot agent={agent} teamId='team-1' isLeader={false} />);
    expect(renderCounts['conv-1']).toBe(1);

    rerender(<AgentChatSlot agent={{ ...agent, status: 'active' }} teamId='team-1' isLeader={false} />);
    expect(renderCounts['conv-1']).toBe(2);
  });

  it('re-renders when teamId or isLeader changes even if the agent is unchanged', () => {
    const agent = makeAgent();
    const { rerender } = render(<AgentChatSlot agent={agent} teamId='team-1' isLeader={false} />);
    expect(renderCounts['conv-1']).toBe(1);

    rerender(<AgentChatSlot agent={agent} teamId='team-1' isLeader />);
    expect(renderCounts['conv-1']).toBe(2);
  });
});
