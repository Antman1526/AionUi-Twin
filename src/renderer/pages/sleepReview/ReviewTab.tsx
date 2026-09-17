/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Drawer, Message, Select, Space, Switch, Typography } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type {
  SleepReviewConversation,
  SleepReviewProvider,
  SleepReviewTarget,
  SleepReviewTranscriptPreview,
} from '@/common/types/sleepReview';

type ReviewTabProps = {
  /** Called after a run stages a new proposal so the proposals tab can refresh. */
  onProposalStaged: () => void;
};

/**
 * "Review" tab: pick conversations (with a redaction preview), a target file and
 * a provider/model, then stage one proposal.
 */
const ReviewTab: React.FC<ReviewTabProps> = ({ onProposalStaged }) => {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<SleepReviewConversation[]>([]);
  const [targets, setTargets] = useState<SleepReviewTarget[]>([]);
  const [providers, setProviders] = useState<SleepReviewProvider[]>([]);
  const [selectedConversations, setSelectedConversations] = useState<string[]>([]);
  const [targetPath, setTargetPath] = useState<string>('');
  const [providerId, setProviderId] = useState<string>('');
  const [modelId, setModelId] = useState<string>('');
  const [localOnly, setLocalOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<SleepReviewTranscriptPreview | undefined>(undefined);

  const loadProviders = async (onlyLocal: boolean) => {
    const result = await ipcBridge.sleepReview.listProviders.invoke({ localOnly: onlyLocal });
    if (!result?.success) {
      Message.error(result?.msg || t('sleepReview.loadFailed'));
      return;
    }
    const list = result.data ?? [];
    const keepsSelection = list.some((provider) => provider.id === providerId);
    setProviders(list);
    if (!keepsSelection) {
      setProviderId('');
      setModelId('');
    }
  };

  useEffect(() => {
    void (async () => {
      const [conversationResult, targetResult] = await Promise.all([
        ipcBridge.sleepReview.listConversations.invoke(),
        ipcBridge.sleepReview.listTargets.invoke({}),
      ]);
      if (conversationResult?.success) setConversations(conversationResult.data ?? []);
      if (targetResult?.success) setTargets(targetResult.data ?? []);
    })();
  }, []);

  useEffect(() => {
    void loadProviders(localOnly);
    // Reload only when the local-only filter flips; `loadProviders` is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localOnly]);

  const selectedProvider = providers.find((provider) => provider.id === providerId);

  const handlePreview = async (conversationId: string) => {
    const result = await ipcBridge.sleepReview.previewTranscript.invoke({ conversationId });
    if (!result?.success || !result.data) {
      Message.error(result?.msg || t('sleepReview.loadFailed'));
      return;
    }
    setPreview(result.data);
  };

  const handleRun = async () => {
    if (selectedConversations.length === 0) {
      Message.warning(t('sleepReview.review.selectConversation'));
      return;
    }
    if (!targetPath) {
      Message.warning(t('sleepReview.review.selectTarget'));
      return;
    }
    if (!providerId || !modelId) {
      Message.warning(t('sleepReview.review.selectModel'));
      return;
    }
    setRunning(true);
    try {
      const result = await ipcBridge.sleepReview.run.invoke({
        conversationIds: selectedConversations,
        targetPath,
        providerId,
        modelId,
        localOnly,
      });
      if (!result?.success) {
        Message.error(result?.msg || t('sleepReview.loadFailed'));
        return;
      }
      Message.success(t('sleepReview.review.runSuccess'));
      onProposalStaged();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className='flex flex-col gap-16px'>
      <div className='flex flex-col gap-8px'>
        <Typography.Text className='text-t-secondary'>{t('sleepReview.review.conversations')}</Typography.Text>
        <Select
          mode='multiple'
          value={selectedConversations}
          placeholder={t('sleepReview.review.conversationsPlaceholder')}
          onChange={(value: string[]) => setSelectedConversations(value)}
          options={conversations.map((conversation) => ({ label: conversation.name, value: conversation.id }))}
        />
        {selectedConversations.length > 0 && (
          <Space wrap>
            {selectedConversations.map((id) => (
              <Button
                key={id}
                size='mini'
                title={t('sleepReview.review.preview')}
                onClick={() => void handlePreview(id)}
              >
                {conversations.find((conversation) => conversation.id === id)?.name ?? id}
              </Button>
            ))}
          </Space>
        )}
      </div>

      <div className='flex flex-col gap-8px'>
        <Typography.Text className='text-t-secondary'>{t('sleepReview.review.target')}</Typography.Text>
        <Select
          value={targetPath || undefined}
          placeholder={t('sleepReview.review.targetPlaceholder')}
          onChange={(value: string) => setTargetPath(value)}
          options={targets.map((target) => ({ label: `${target.label} — ${target.path}`, value: target.path }))}
        />
      </div>

      <div className='flex flex-col gap-8px'>
        <div className='flex items-center gap-8px'>
          <Typography.Text className='text-t-secondary'>{t('sleepReview.review.localOnly')}</Typography.Text>
          <Switch checked={localOnly} onChange={(checked: boolean) => setLocalOnly(checked)} />
        </div>
        <Select
          value={providerId || undefined}
          placeholder={t('sleepReview.review.providerPlaceholder')}
          onChange={(value: string) => {
            setProviderId(value);
            setModelId('');
          }}
          options={providers.map((provider) => ({ label: provider.name, value: provider.id }))}
        />
        <Select
          value={modelId || undefined}
          placeholder={t('sleepReview.review.modelPlaceholder')}
          onChange={(value: string) => setModelId(value)}
          options={(selectedProvider?.models ?? []).map((model) => ({ label: model, value: model }))}
        />
      </div>

      <div>
        <Button type='primary' loading={running} onClick={() => void handleRun()}>
          {t('sleepReview.review.run')}
        </Button>
      </div>

      <Drawer
        width={560}
        visible={Boolean(preview)}
        title={t('sleepReview.review.previewTitle')}
        footer={null}
        onCancel={() => setPreview(undefined)}
      >
        {preview && (
          <div className='flex flex-col gap-8px'>
            <Typography.Text className='text-t-tertiary'>
              {t('sleepReview.review.redactionCount', { count: preview.redactionCount })}
            </Typography.Text>
            <pre className='whitespace-pre-wrap break-words text-12px text-t-primary'>{preview.text}</pre>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default ReviewTab;
