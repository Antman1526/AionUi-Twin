/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Modal, Space, Table, Typography } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type { HeldOutPrompt } from '@/common/types/sleepReview';

type DraftPrompt = HeldOutPrompt & { isNew?: boolean };

/** "Held-out prompts" tab: CRUD over the validation prompt library. */
const HeldOutTab: React.FC = () => {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<HeldOutPrompt[]>([]);
  const [draft, setDraft] = useState<DraftPrompt | undefined>(undefined);

  const load = async () => {
    const result = await ipcBridge.sleepReview.listHeldOut.invoke({});
    if (!result?.success) {
      Message.error(result?.msg || t('sleepReview.loadFailed'));
      return;
    }
    setPrompts(result.data ?? []);
  };

  useEffect(() => {
    void load();
    // Load once on mount; `load` is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (next: HeldOutPrompt[]) => {
    const result = await ipcBridge.sleepReview.saveHeldOut.invoke({ prompts: next });
    if (!result?.success) {
      Message.error(result?.msg || t('sleepReview.loadFailed'));
      return;
    }
    setPrompts(result.data ?? next);
    Message.success(t('sleepReview.heldOut.saved'));
  };

  const handleSaveDraft = async () => {
    if (!draft || !draft.prompt.trim()) return;
    const entry: HeldOutPrompt = { id: draft.id, prompt: draft.prompt.trim(), expected: draft.expected?.trim() };
    const next = draft.isNew ? [...prompts, entry] : prompts.map((prompt) => (prompt.id === entry.id ? entry : prompt));
    setDraft(undefined);
    await persist(next);
  };

  const handleDelete = async (id: string) => {
    await persist(prompts.filter((prompt) => prompt.id !== id));
  };

  const columns = [
    { title: t('sleepReview.heldOut.prompt'), dataIndex: 'prompt' },
    { title: t('sleepReview.heldOut.expected'), dataIndex: 'expected' },
    {
      title: t('sleepReview.heldOut.actions'),
      dataIndex: 'id',
      render: (_value: string, record: HeldOutPrompt) => (
        <Space>
          <Button size='mini' onClick={() => setDraft({ ...record })}>
            {t('common.edit')}
          </Button>
          <Button size='mini' status='danger' onClick={() => void handleDelete(record.id)}>
            {t('common.delete')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className='flex flex-col gap-12px'>
      <div>
        <Button
          type='primary'
          onClick={() => setDraft({ id: `held-out-${Date.now()}`, prompt: '', expected: '', isNew: true })}
        >
          {t('common.add')}
        </Button>
      </div>

      {prompts.length === 0 ? (
        <Typography.Text className='text-t-tertiary'>{t('sleepReview.heldOut.empty')}</Typography.Text>
      ) : (
        <Table rowKey='id' data={prompts} columns={columns} pagination={false} />
      )}

      <Modal
        visible={Boolean(draft)}
        title={t('sleepReview.heldOut.modalTitle')}
        onCancel={() => setDraft(undefined)}
        onOk={() => void handleSaveDraft()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <div className='flex flex-col gap-8px'>
          <Input.TextArea
            value={draft?.prompt ?? ''}
            placeholder={t('sleepReview.heldOut.promptPlaceholder')}
            onChange={(value: string) => setDraft((prev) => (prev ? { ...prev, prompt: value } : prev))}
          />
          <Input
            value={draft?.expected ?? ''}
            placeholder={t('sleepReview.heldOut.expectedPlaceholder')}
            onChange={(value: string) => setDraft((prev) => (prev ? { ...prev, expected: value } : prev))}
          />
        </div>
      </Modal>
    </div>
  );
};

export default HeldOutTab;
