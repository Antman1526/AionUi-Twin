/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Message } from '@arco-design/web-react';
import { Delete, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { HeldOutPrompt } from '@/common/types/sleepReview';
import { unwrap, useHeldOutPrompts } from './useSleepReview';

type HeldOutTabProps = {
  workspace?: string;
};

/** Add, edit and delete the prompts replayed before and after an edit. */
const HeldOutTab: React.FC<HeldOutTabProps> = ({ workspace }) => {
  const { t } = useTranslation();
  const { data, mutate } = useHeldOutPrompts(workspace);
  const [prompts, setPrompts] = useState<HeldOutPrompt[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrompts(data ?? []);
  }, [data]);

  const update = (index: number, patch: Partial<HeldOutPrompt>): void =>
    setPrompts((current) => current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));

  const handleSave = (): void => {
    setSaving(true);
    void ipcBridge.sleepReview.saveHeldOut
      .invoke({ ...(workspace ? { workspace } : {}), prompts })
      .then((response) => {
        unwrap(response);
        Message.success(t('sleepReview.heldOut.saved'));
        void mutate();
      })
      .catch((cause: unknown) => Message.error(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false));
  };

  return (
    <div className='flex flex-col gap-12px'>
      <span className='text-12px text-t-secondary'>{t('sleepReview.heldOut.hint')}</span>

      {prompts.length === 0 && <span className='text-13px text-t-secondary'>{t('sleepReview.heldOut.empty')}</span>}

      {prompts.map((entry, index) => (
        <div key={entry.id} className='flex gap-8px items-start flex-wrap'>
          <div className='flex-1 min-w-220px flex flex-col gap-4px'>
            <Input
              value={entry.prompt}
              placeholder={t('sleepReview.heldOut.prompt')}
              onChange={(value: string) => update(index, { prompt: value })}
            />
            <Input
              value={entry.expected ?? ''}
              placeholder={t('sleepReview.heldOut.expected')}
              onChange={(value: string) => update(index, { expected: value })}
            />
          </div>
          <Button
            icon={<Delete theme='outline' size='14' />}
            onClick={() => setPrompts((current) => current.filter((_, position) => position !== index))}
          >
            {t('sleepReview.heldOut.remove')}
          </Button>
        </div>
      ))}

      <div className='flex items-center gap-8px'>
        <Button
          icon={<Plus theme='outline' size='14' />}
          onClick={() =>
            setPrompts((current) => [...current, { id: `h-${Date.now()}-${current.length}`, prompt: '', expected: '' }])
          }
        >
          {t('sleepReview.heldOut.add')}
        </Button>
        <Button type='primary' loading={saving} onClick={handleSave}>
          {t('sleepReview.heldOut.save')}
        </Button>
      </div>
    </div>
  );
};

export default HeldOutTab;
