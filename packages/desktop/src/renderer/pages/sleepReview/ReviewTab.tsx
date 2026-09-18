/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Message, Select, Spin, Switch } from '@arco-design/web-react';
import { Eyes, Play } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { SleepReviewTranscriptPreview } from '@/common/types/sleepReview';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';
import ModelPicker, { resolveModel } from './ModelPicker';
import { unwrap, useSleepReviewConversations, useSleepReviewTargets } from './useSleepReview';

type ReviewTabProps = {
  workspace?: string;
  onWorkspaceChange: (workspace?: string) => void;
  /** Called after a proposal is staged, so the Proposals tab can refresh. */
  onStaged: () => void;
};

/** Pick sessions, pick a target, pick a model, then stage one proposal. */
const ReviewTab: React.FC<ReviewTabProps> = ({ workspace, onWorkspaceChange, onStaged }) => {
  const { t } = useTranslation();
  const { data: providerConfig } = useProvidersQuery();
  const { data: conversations, isLoading: loadingConversations } = useSleepReviewConversations();
  const { data: targets } = useSleepReviewTargets(workspace);

  const [selectedConversations, setSelectedConversations] = useState<string[]>([]);
  const [targetPath, setTargetPath] = useState<string | undefined>(undefined);
  const [modelValue, setModelValue] = useState<string | undefined>(undefined);
  const [localOnly, setLocalOnly] = useState(true);
  const [preview, setPreview] = useState<SleepReviewTranscriptPreview | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const providers = useMemo(
    () => (providerConfig ?? []).filter((entry) => (entry.models ?? []).length > 0),
    [providerConfig]
  );

  const workspaceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const conversation of conversations ?? []) {
      if (conversation.workspace) seen.set(conversation.workspace, conversation.workspace);
    }
    return [...seen.keys()].map((value) => ({ value, label: value }));
  }, [conversations]);

  const provider = resolveModel(providers, modelValue);
  const canRun = Boolean(provider && targetPath && selectedConversations.length > 0) && !running;

  const handlePreview = (): void => {
    const conversationId = selectedConversations[0];
    if (!conversationId) return;
    void ipcBridge.sleepReview.previewTranscript
      .invoke({ conversationId })
      .then((response) => setPreview(unwrap(response)))
      .catch((cause: unknown) => Message.error(cause instanceof Error ? cause.message : String(cause)));
  };

  const handleRun = (): void => {
    if (!provider || !targetPath) return;
    setRunning(true);
    setError(undefined);
    void ipcBridge.sleepReview.run
      .invoke({
        conversationIds: selectedConversations,
        targetPath,
        ...(workspace ? { workspace } : {}),
        provider,
        localOnly,
      })
      .then((response) => {
        unwrap(response);
        Message.success(t('sleepReview.review.staged'));
        onStaged();
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setRunning(false));
  };

  return (
    <div className='flex flex-col gap-12px'>
      <div className='flex flex-col gap-4px'>
        <span className='text-13px font-medium'>{t('sleepReview.review.sessions')}</span>
        <span className='text-12px text-t-secondary'>{t('sleepReview.review.sessionsHint')}</span>
        {loadingConversations ? (
          <Spin />
        ) : (
          <Select
            mode='multiple'
            showSearch
            placeholder={t('sleepReview.review.selectSessions')}
            value={selectedConversations}
            onChange={setSelectedConversations}
            options={(conversations ?? []).map((conversation) => ({
              value: conversation.id,
              label: conversation.title || conversation.id,
            }))}
          />
        )}
        <div>
          <Button
            size='small'
            icon={<Eyes theme='outline' size='14' />}
            disabled={selectedConversations.length === 0}
            onClick={handlePreview}
          >
            {t('sleepReview.review.previewTranscript')}
          </Button>
        </div>
        {preview && (
          <div className='flex flex-col gap-4px'>
            <span className='text-12px text-t-secondary'>
              {t('sleepReview.review.redacted', { count: preview.redactionCount })}
            </span>
            <pre className='m-0 max-h-200px overflow-auto rd-6px bg-fill-2 p-8px text-11px whitespace-pre-wrap'>
              {preview.text}
            </pre>
          </div>
        )}
      </div>

      <div className='flex gap-12px flex-wrap'>
        <div className='flex-1 min-w-220px flex flex-col gap-4px'>
          <span className='text-13px font-medium'>{t('sleepReview.review.workspace')}</span>
          <Select
            allowClear
            placeholder={t('sleepReview.review.selectWorkspace')}
            value={workspace}
            onChange={(next: string | undefined) => onWorkspaceChange(next || undefined)}
            options={workspaceOptions}
            notFoundContent={t('sleepReview.review.noWorkspace')}
          />
        </div>
        <div className='flex-1 min-w-220px flex flex-col gap-4px'>
          <span className='text-13px font-medium'>{t('sleepReview.review.target')}</span>
          <Select
            showSearch
            placeholder={t('sleepReview.review.selectTarget')}
            value={targetPath}
            onChange={setTargetPath}
            options={(targets ?? []).map((target) => ({ value: target.path, label: target.label }))}
          />
        </div>
      </div>

      <div className='flex gap-12px flex-wrap items-end'>
        <div className='flex-1 min-w-220px flex flex-col gap-4px'>
          <span className='text-13px font-medium'>{t('sleepReview.review.model')}</span>
          <ModelPicker
            providers={providers}
            value={modelValue}
            localOnly={localOnly}
            placeholder={t('sleepReview.review.selectModel')}
            onChange={setModelValue}
          />
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-13px font-medium'>{t('sleepReview.review.localOnly')}</span>
          <Switch checked={localOnly} onChange={setLocalOnly} />
        </div>
      </div>
      <span className='text-12px text-t-secondary'>{t('sleepReview.review.localOnlyHint')}</span>

      <div className='flex items-center gap-8px'>
        <Button type='primary' icon={<Play theme='outline' size='14' />} disabled={!canRun} onClick={handleRun}>
          {running ? t('sleepReview.review.running') : t('sleepReview.review.run')}
        </Button>
        {error && <span className='text-12px text-danger-6'>{error}</span>}
      </div>
    </div>
  );
};

export default ReviewTab;
