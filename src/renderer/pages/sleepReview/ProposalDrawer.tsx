/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Drawer, Message, Space, Typography } from '@arco-design/web-react';
import { createTwoFilesPatch } from 'diff';
import { ipcBridge } from '@/common';
import type { HeldOutRunResult, SleepReviewProposal } from '@/common/types/sleepReview';

type ProposalDrawerProps = {
  proposal?: SleepReviewProposal;
  onClose: () => void;
  onAccept: (proposal: SleepReviewProposal) => void;
  onReject: (proposal: SleepReviewProposal) => void;
  onRollback: (proposal: SleepReviewProposal) => void;
};

/**
 * Detail view for one proposal: rationale, risk, rollback plan, held-out checks,
 * and a unified diff of the target file with the edit applied.
 */
const ProposalDrawer: React.FC<ProposalDrawerProps> = ({ proposal, onClose, onAccept, onReject, onRollback }) => {
  const { t } = useTranslation();
  const [patch, setPatch] = useState('');
  const [checks, setChecks] = useState<HeldOutRunResult[]>([]);
  const [runningChecks, setRunningChecks] = useState(false);

  useEffect(() => {
    setChecks([]);
    setPatch('');
    if (!proposal) return;
    void (async () => {
      const result = await ipcBridge.sleepReview.previewProposal.invoke({ id: proposal.id });
      if (!result?.success || !result.data) {
        Message.error(result?.msg || t('sleepReview.loadFailed'));
        return;
      }
      setPatch(
        createTwoFilesPatch(proposal.targetPath, proposal.targetPath, result.data.before, result.data.after, '', '')
      );
    })();
  }, [proposal, t]);

  const handleRunChecks = async () => {
    if (!proposal) return;
    setRunningChecks(true);
    try {
      const result = await ipcBridge.sleepReview.runHeldOut.invoke({ proposalId: proposal.id });
      if (!result?.success) {
        Message.error(result?.msg || t('sleepReview.loadFailed'));
        return;
      }
      setChecks(result.data ?? []);
    } finally {
      setRunningChecks(false);
    }
  };

  return (
    <Drawer
      width={640}
      visible={Boolean(proposal)}
      title={t('sleepReview.proposals.detail')}
      footer={null}
      onCancel={onClose}
    >
      {proposal && (
        <div className='flex flex-col gap-16px'>
          <section className='flex flex-col gap-4px'>
            <Typography.Text className='text-t-secondary'>{t('sleepReview.proposals.rationale')}</Typography.Text>
            <Typography.Text className='text-t-primary'>{proposal.rationale}</Typography.Text>
          </section>
          <section className='flex flex-col gap-4px'>
            <Typography.Text className='text-t-secondary'>{t('sleepReview.proposals.risk')}</Typography.Text>
            <Typography.Text className='text-t-primary'>{proposal.risk}</Typography.Text>
          </section>
          <section className='flex flex-col gap-4px'>
            <Typography.Text className='text-t-secondary'>{t('sleepReview.proposals.rollbackPlan')}</Typography.Text>
            <Typography.Text className='text-t-primary'>{proposal.rollback}</Typography.Text>
          </section>
          <section className='flex flex-col gap-4px'>
            <Typography.Text className='text-t-secondary'>{t('sleepReview.proposals.heldOutChecks')}</Typography.Text>
            <ul className='m-0 pl-16px text-t-primary'>
              {proposal.heldOutChecks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </section>
          <section className='flex flex-col gap-4px'>
            <Typography.Text className='text-t-secondary'>{t('sleepReview.proposals.diff')}</Typography.Text>
            <pre className='whitespace-pre-wrap break-words text-12px text-t-primary bg-fill-1 p-8px rd-4px'>
              {patch}
            </pre>
          </section>

          <Space>
            <Button type='primary' onClick={() => onAccept(proposal)}>
              {t('sleepReview.proposals.accept')}
            </Button>
            <Button onClick={() => onReject(proposal)}>{t('sleepReview.proposals.reject')}</Button>
            <Button onClick={() => onRollback(proposal)}>{t('sleepReview.proposals.rollback')}</Button>
            <Button loading={runningChecks} onClick={() => void handleRunChecks()}>
              {t('sleepReview.proposals.runChecks')}
            </Button>
          </Space>

          {checks.length > 0 && (
            <section className='flex flex-col gap-8px'>
              {checks.map((check) => (
                <div key={check.prompt} className='flex flex-col gap-4px'>
                  <Typography.Text className='text-t-primary'>{check.prompt}</Typography.Text>
                  <div className='flex gap-8px'>
                    <div className='flex-1 flex flex-col gap-2px'>
                      <Typography.Text className='text-t-tertiary'>{t('sleepReview.proposals.before')}</Typography.Text>
                      <pre className='whitespace-pre-wrap break-words text-12px text-t-primary'>
                        {check.beforeOutput}
                      </pre>
                    </div>
                    <div className='flex-1 flex flex-col gap-2px'>
                      <Typography.Text className='text-t-tertiary'>{t('sleepReview.proposals.after')}</Typography.Text>
                      <pre className='whitespace-pre-wrap break-words text-12px text-t-primary'>
                        {check.afterOutput}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
};

export default ProposalDrawer;
