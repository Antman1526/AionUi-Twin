/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Message, Space, Tag, Typography } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type { SleepReviewProposal, SleepReviewProposalStatus } from '@/common/types/sleepReview';
import ProposalDrawer from './ProposalDrawer';

const STATUS_COLOR: Record<SleepReviewProposalStatus, string> = {
  staged: 'arcoblue',
  accepted: 'green',
  rejected: 'gray',
  rolledBack: 'orange',
  failed: 'red',
};

type ProposalsTabProps = {
  /** Bumped by the parent after a run so the list reloads. */
  refreshToken: number;
};

/** "Proposals" tab: staged proposals with status tags and accept/reject/rollback. */
const ProposalsTab: React.FC<ProposalsTabProps> = ({ refreshToken }) => {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<SleepReviewProposal[]>([]);
  const [active, setActive] = useState<SleepReviewProposal | undefined>(undefined);

  const load = async () => {
    const result = await ipcBridge.sleepReview.listProposals.invoke();
    if (!result?.success) {
      Message.error(result?.msg || t('sleepReview.loadFailed'));
      return;
    }
    setProposals(result.data ?? []);
  };

  useEffect(() => {
    void load();
    // `load` is recreated each render; re-run only when the parent asks for a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleAccept = async (proposal: SleepReviewProposal) => {
    const result = await ipcBridge.sleepReview.accept.invoke({ id: proposal.id });
    if (result?.success) Message.success(t('sleepReview.proposals.accepted'));
    else Message.error(result?.msg || t('sleepReview.loadFailed'));
    setActive(undefined);
    await load();
  };

  const handleReject = async (proposal: SleepReviewProposal) => {
    const result = await ipcBridge.sleepReview.reject.invoke({ id: proposal.id });
    if (result?.success) Message.success(t('sleepReview.proposals.rejected'));
    else Message.error(result?.msg || t('sleepReview.loadFailed'));
    setActive(undefined);
    await load();
  };

  const handleRollback = async (proposal: SleepReviewProposal) => {
    const result = await ipcBridge.sleepReview.rollback.invoke({ id: proposal.id });
    if (result?.success) Message.success(t('sleepReview.proposals.rolledBack'));
    else Message.error(result?.msg || t('sleepReview.loadFailed'));
    setActive(undefined);
    await load();
  };

  if (proposals.length === 0) {
    return <Typography.Text className='text-t-tertiary'>{t('sleepReview.proposals.empty')}</Typography.Text>;
  }

  return (
    <div className='flex flex-col gap-12px'>
      {proposals.map((proposal) => (
        <div key={proposal.id} className='flex flex-col gap-8px p-12px rd-8px b-1px b-solid b-[var(--color-border-2)]'>
          <div className='flex items-center gap-8px'>
            <Tag color={STATUS_COLOR[proposal.status]}>{t(`sleepReview.status.${proposal.status}`)}</Tag>
            <Typography.Text className='text-t-primary'>{proposal.targetPath}</Typography.Text>
          </div>
          <Typography.Text className='text-t-secondary'>{proposal.rationale}</Typography.Text>
          {proposal.error && <Typography.Text className='text-t-tertiary'>{proposal.error}</Typography.Text>}
          <Space>
            <Button size='small' onClick={() => setActive(proposal)}>
              {t('sleepReview.proposals.detail')}
            </Button>
            <Button size='small' type='primary' onClick={() => void handleAccept(proposal)}>
              {t('sleepReview.proposals.accept')}
            </Button>
            <Button size='small' onClick={() => void handleReject(proposal)}>
              {t('sleepReview.proposals.reject')}
            </Button>
            <Button size='small' onClick={() => void handleRollback(proposal)}>
              {t('sleepReview.proposals.rollback')}
            </Button>
          </Space>
        </div>
      ))}

      <ProposalDrawer
        proposal={active}
        onClose={() => setActive(undefined)}
        onAccept={(proposal) => void handleAccept(proposal)}
        onReject={(proposal) => void handleReject(proposal)}
        onRollback={(proposal) => void handleRollback(proposal)}
      />
    </div>
  );
};

export default ProposalsTab;
