import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepReviewProposal } from '@/common/types/sleepReview';

const mockListProposals = vi.hoisted(() => vi.fn());
const mockAccept = vi.hoisted(() => vi.fn());
const mockReject = vi.hoisted(() => vi.fn());
const mockRollback = vi.hoisted(() => vi.fn());
const mockPreviewProposal = vi.hoisted(() => vi.fn());
const mockRunHeldOut = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Drawer: ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) =>
    visible ? <div data-testid='arco-drawer'>{children}</div> : null,
  Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Space: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children?: React.ReactNode }) => <span data-testid='status-tag'>{children}</span>,
  Typography: {
    Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  },
}));

vi.mock('diff', () => ({
  createTwoFilesPatch: () => 'patch',
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    sleepReview: {
      listProposals: { invoke: mockListProposals },
      accept: { invoke: mockAccept },
      reject: { invoke: mockReject },
      rollback: { invoke: mockRollback },
      previewProposal: { invoke: mockPreviewProposal },
      runHeldOut: { invoke: mockRunHeldOut },
    },
  },
}));

import ProposalsTab from '@/renderer/pages/sleepReview/ProposalsTab';

const proposal = (overrides: Partial<SleepReviewProposal> = {}): SleepReviewProposal => ({
  id: 'p1',
  createdAt: 1,
  targetPath: '/skills/deploy/SKILL.md',
  targetKind: 'skill',
  baselineSha256: 'hash',
  status: 'staged',
  rationale: 'the skill never mentions confirmation',
  edit: { type: 'add', anchor: '## Safety', after: 'Always confirm.' },
  heldOutChecks: [],
  risk: 'low',
  rollback: 'delete the line',
  modelId: 'model-a',
  providerId: 'provider-a',
  sourceConversationIds: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAccept.mockResolvedValue({ success: true, data: proposal({ status: 'accepted' }) });
  mockPreviewProposal.mockResolvedValue({ success: true, data: { before: 'a', after: 'b' } });
});

describe('ProposalsTab', () => {
  it('renders the empty state when there are no proposals', async () => {
    mockListProposals.mockResolvedValue({ success: true, data: [] });

    render(<ProposalsTab refreshToken={0} />);

    expect(await screen.findByText('sleepReview.proposals.empty')).toBeTruthy();
  });

  it('renders one status tag per proposal', async () => {
    mockListProposals.mockResolvedValue({
      success: true,
      data: [proposal(), proposal({ id: 'p2', status: 'failed' })],
    });

    render(<ProposalsTab refreshToken={0} />);

    const tags = await screen.findAllByTestId('status-tag');
    expect(tags.map((tag) => tag.textContent)).toEqual(['sleepReview.status.staged', 'sleepReview.status.failed']);
  });

  it('calls the accept bridge with the proposal id and reloads the list', async () => {
    mockListProposals.mockResolvedValue({ success: true, data: [proposal()] });

    render(<ProposalsTab refreshToken={0} />);

    const acceptButton = await screen.findByText('sleepReview.proposals.accept');
    fireEvent.click(acceptButton);

    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith({ id: 'p1' }));
    await waitFor(() => expect(mockListProposals).toHaveBeenCalledTimes(2));
  });
});
