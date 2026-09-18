/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepReviewProposal } from '@/common/types/sleepReview';

const previewProposalInvoke = vi.fn();
const acceptInvoke = vi.fn();
const rejectInvoke = vi.fn();
const rollbackInvoke = vi.fn();
const runHeldOutInvoke = vi.fn();

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
    sleepReview: {
      previewProposal: { invoke: (...args: unknown[]) => previewProposalInvoke(...args) },
      accept: { invoke: (...args: unknown[]) => acceptInvoke(...args) },
      reject: { invoke: (...args: unknown[]) => rejectInvoke(...args) },
      rollback: { invoke: (...args: unknown[]) => rollbackInvoke(...args) },
      runHeldOut: { invoke: (...args: unknown[]) => runHeldOutInvoke(...args) },
    },
  },
}));

// Arco's imperative Message uses the legacy ReactDOM.render, which React 19
// no longer provides; the component under test only needs it to not explode.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, Message: { error: vi.fn(), success: vi.fn() } };
});

vi.mock('@renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: [] }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

import ProposalsTab from '@renderer/pages/sleepReview/ProposalsTab';

const proposal = (overrides: Partial<SleepReviewProposal>): SleepReviewProposal => ({
  id: 'p1',
  createdAt: 1_700_000_000_000,
  targetPath: '/skills/demo/SKILL.md',
  targetKind: 'skill',
  baselineSha256: 'hash',
  status: 'staged',
  rationale: 'the trigger was unclear',
  edit: { type: 'replace', anchor: '', before: 'a', after: 'b' },
  heldOutChecks: ['does it still trigger?'],
  risk: 'low',
  rollback: 'restore the backup',
  modelId: 'qwen3',
  providerId: 'local',
  sourceConversationIds: ['c1'],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  previewProposalInvoke.mockResolvedValue({
    success: true,
    data: { proposalId: 'p1', targetPath: '/skills/demo/SKILL.md', before: 'a', after: 'b', patch: '-a\n+b' },
  });
  acceptInvoke.mockResolvedValue({ success: true, data: proposal({ status: 'accepted' }) });
});

describe('ProposalsTab', () => {
  it('renders the empty state when there is nothing staged', () => {
    render(<ProposalsTab proposals={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('sleepReview.proposals.empty')).toBeInTheDocument();
  });

  it('renders one row per proposal with its status', () => {
    render(
      <ProposalsTab
        proposals={[
          proposal({ id: 'p1', status: 'staged' }),
          proposal({ id: 'p2', status: 'accepted' }),
          proposal({ id: 'p3', status: 'failed' }),
        ]}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getAllByTestId('sleep-review-proposal')).toHaveLength(3);
    expect(screen.getByText('sleepReview.status.staged')).toBeInTheDocument();
    expect(screen.getByText('sleepReview.status.accepted')).toBeInTheDocument();
    expect(screen.getByText('sleepReview.status.failed')).toBeInTheDocument();
  });

  it('shows the diff and the evidence once the details drawer is opened', async () => {
    render(<ProposalsTab proposals={[proposal({})]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('sleepReview.proposals.details'));

    await waitFor(() => expect(previewProposalInvoke).toHaveBeenCalledWith({ proposalId: 'p1' }));
    expect(await screen.findByText(/-a\s*\+b/)).toBeInTheDocument();
    expect(screen.getByText('the trigger was unclear')).toBeInTheDocument();
    expect(screen.getByText('does it still trigger?')).toBeInTheDocument();
  });

  it('calls the accept bridge method and refreshes the list', async () => {
    const onChanged = vi.fn();
    render(<ProposalsTab proposals={[proposal({})]} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('sleepReview.proposals.details'));

    const accept = await screen.findByText('sleepReview.proposals.accept');
    fireEvent.click(accept);

    await waitFor(() => expect(acceptInvoke).toHaveBeenCalledWith({ proposalId: 'p1' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('surfaces a failed accept instead of pretending it worked', async () => {
    acceptInvoke.mockResolvedValue({ success: false, msg: 'The target file changed' });
    const onChanged = vi.fn();
    render(<ProposalsTab proposals={[proposal({})]} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('sleepReview.proposals.details'));

    fireEvent.click(await screen.findByText('sleepReview.proposals.accept'));

    expect(await screen.findByText('The target file changed')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
