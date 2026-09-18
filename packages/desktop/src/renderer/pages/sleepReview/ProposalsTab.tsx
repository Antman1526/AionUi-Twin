/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Drawer, Message, Spin, Switch, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { HeldOutComparison, SleepReviewDiff, SleepReviewProposal } from '@/common/types/sleepReview';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';
import ModelPicker, { resolveModel } from './ModelPicker';
import { unwrap } from './useSleepReview';

/** Arco tag colour per proposal status. */
const STATUS_COLOR: Record<SleepReviewProposal['status'], string> = {
  staged: 'arcoblue',
  accepted: 'green',
  rejected: 'gray',
  rolledBack: 'orange',
  failed: 'red',
};

type ProposalsTabProps = {
  proposals: SleepReviewProposal[];
  loading?: boolean;
  onChanged: () => void;
};

/** Staged proposals, with the diff, the evidence and the accept/rollback actions. */
const ProposalsTab: React.FC<ProposalsTabProps> = ({ proposals, loading, onChanged }) => {
  const { t } = useTranslation();
  const { data: providerConfig } = useProvidersQuery();
  const providers = useMemo(
    () => (providerConfig ?? []).filter((entry) => (entry.models ?? []).length > 0),
    [providerConfig]
  );
  const [replayModel, setReplayModel] = useState<string | undefined>(undefined);
  const [localOnly, setLocalOnly] = useState(true);
  const replayProvider = resolveModel(providers, replayModel);
  const [open, setOpen] = useState<SleepReviewProposal | null>(null);
  const [diff, setDiff] = useState<SleepReviewDiff | null>(null);
  const [replay, setReplay] = useState<HeldOutComparison[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const fail = (cause: unknown): void => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    Message.error(message);
  };

  const openDetails = (proposal: SleepReviewProposal): void => {
    setOpen(proposal);
    setDiff(null);
    setReplay(null);
    setError(undefined);
    void ipcBridge.sleepReview.previewProposal
      .invoke({ proposalId: proposal.id })
      .then((response) => setDiff(unwrap(response)))
      .catch(fail);
  };

  const act = (action: 'accept' | 'reject' | 'rollback', proposalId: string): void => {
    setBusy(true);
    setError(undefined);
    void ipcBridge.sleepReview[action]
      .invoke({ proposalId })
      .then((response) => {
        unwrap(response);
        setOpen(null);
        onChanged();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const handleReplay = (proposalId: string): void => {
    if (!replayProvider) return;
    setBusy(true);
    setError(undefined);
    void ipcBridge.sleepReview.runHeldOut
      .invoke({ proposalId, provider: replayProvider, localOnly })
      .then((response) => setReplay(unwrap(response)))
      .catch(fail)
      .finally(() => setBusy(false));
  };

  if (loading) return <Spin />;
  if (proposals.length === 0)
    return <div className='text-13px text-t-secondary'>{t('sleepReview.proposals.empty')}</div>;

  return (
    <div className='flex flex-col gap-8px'>
      {proposals.map((proposal) => (
        <div
          key={proposal.id}
          data-testid='sleep-review-proposal'
          className='flex items-center gap-8px rd-8px bg-fill-1 px-12px py-8px'
        >
          <Tag color={STATUS_COLOR[proposal.status]}>{t(`sleepReview.status.${proposal.status}`)}</Tag>
          <div className='flex-1 min-w-0'>
            <div className='truncate text-13px'>{proposal.targetPath}</div>
            <div className='truncate text-11px text-t-secondary'>
              {new Date(proposal.createdAt).toLocaleString()} · {proposal.modelId}
            </div>
          </div>
          <Button size='small' onClick={() => openDetails(proposal)}>
            {t('sleepReview.proposals.details')}
          </Button>
        </div>
      ))}

      <Drawer
        width={640}
        visible={open !== null}
        title={t('sleepReview.proposals.details')}
        footer={null}
        onCancel={() => setOpen(null)}
      >
        {open && (
          <div className='flex flex-col gap-12px'>
            <Section title={t('sleepReview.proposals.rationale')} body={open.rationale} />
            <Section title={t('sleepReview.proposals.risk')} body={open.risk} />
            <Section title={t('sleepReview.proposals.rollback')} body={open.rollback} />
            {open.heldOutChecks.length > 0 && (
              <div>
                <div className='text-13px font-medium mb-4px'>{t('sleepReview.proposals.heldOutChecks')}</div>
                <ul className='m-0 ps-16px text-12px text-t-secondary'>
                  {open.heldOutChecks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className='text-13px font-medium mb-4px'>{t('sleepReview.proposals.diff')}</div>
              <pre className='m-0 max-h-260px overflow-auto rd-6px bg-fill-2 p-8px text-11px whitespace-pre-wrap'>
                {diff?.patch ?? ''}
              </pre>
            </div>

            <div className='flex items-end gap-8px flex-wrap'>
              <div className='flex-1 min-w-200px flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>{t('sleepReview.review.model')}</span>
                <ModelPicker
                  providers={providers}
                  value={replayModel}
                  localOnly={localOnly}
                  placeholder={t('sleepReview.review.selectModel')}
                  onChange={setReplayModel}
                />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>{t('sleepReview.review.localOnly')}</span>
                <Switch checked={localOnly} onChange={setLocalOnly} />
              </div>
            </div>

            <div className='flex items-center gap-8px flex-wrap'>
              <Button
                type='primary'
                disabled={busy || open.status === 'accepted'}
                onClick={() => act('accept', open.id)}
              >
                {t('sleepReview.proposals.accept')}
              </Button>
              <Button disabled={busy} onClick={() => act('reject', open.id)}>
                {t('sleepReview.proposals.reject')}
              </Button>
              <Button disabled={busy || !open.backupPath} onClick={() => act('rollback', open.id)}>
                {t('sleepReview.proposals.rollbackAction')}
              </Button>
              <Button disabled={busy || !replayProvider} onClick={() => handleReplay(open.id)}>
                {t('sleepReview.proposals.replay')}
              </Button>
            </div>

            {open.error && <div className='text-12px text-danger-6'>{open.error}</div>}
            {error && <div className='text-12px text-danger-6'>{error}</div>}

            {replay !== null &&
              (replay.length === 0 ? (
                <div className='text-12px text-t-secondary'>{t('sleepReview.proposals.noReplay')}</div>
              ) : (
                replay.map((comparison) => (
                  <div key={comparison.promptId} className='flex flex-col gap-4px'>
                    <div className='text-12px font-medium'>{comparison.prompt}</div>
                    <div className='flex gap-8px flex-wrap'>
                      <ReplayColumn title={t('sleepReview.proposals.before')} body={comparison.beforeOutput} />
                      <ReplayColumn title={t('sleepReview.proposals.after')} body={comparison.afterOutput} />
                    </div>
                    {comparison.error && <div className='text-11px text-danger-6'>{comparison.error}</div>}
                  </div>
                ))
              ))}
          </div>
        )}
      </Drawer>
    </div>
  );
};

const Section: React.FC<{ title: string; body: string }> = ({ title, body }) =>
  body ? (
    <div>
      <div className='text-13px font-medium mb-4px'>{title}</div>
      <div className='text-12px text-t-secondary whitespace-pre-wrap'>{body}</div>
    </div>
  ) : null;

const ReplayColumn: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className='flex-1 min-w-200px'>
    <div className='text-11px text-t-secondary mb-2px'>{title}</div>
    <pre className='m-0 max-h-160px overflow-auto rd-6px bg-fill-2 p-8px text-11px whitespace-pre-wrap'>{body}</pre>
  </div>
);

export default ProposalsTab;
