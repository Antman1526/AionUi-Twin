/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import HeldOutTab from './HeldOutTab';
import ProposalsTab from './ProposalsTab';
import ReviewTab from './ReviewTab';
import { useSleepReviewProposals } from './useSleepReview';

/** Native SkillOpt sleep review: harvest → mine → consolidate → gate → stage. */
const SleepReviewPage: React.FC = () => {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('review');
  const { data: proposals, isLoading, mutate } = useSleepReviewProposals();

  return (
    <div className='size-full flex flex-col gap-12px p-16px overflow-auto'>
      <div>
        <h1 className='text-18px font-semibold m-0'>{t('sleepReview.title')}</h1>
        <p className='text-12px text-t-secondary mt-4px mb-0'>{t('sleepReview.description')}</p>
      </div>

      <Tabs activeTab={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane key='review' title={t('sleepReview.tabs.review')}>
          <ReviewTab
            workspace={workspace}
            onWorkspaceChange={setWorkspace}
            onStaged={() => {
              void mutate();
              setActiveTab('proposals');
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane key='proposals' title={t('sleepReview.tabs.proposals')}>
          <ProposalsTab
            proposals={proposals ?? []}
            loading={isLoading}
            onChanged={() => {
              void mutate();
            }}
          />
        </Tabs.TabPane>
        <Tabs.TabPane key='heldOut' title={t('sleepReview.tabs.heldOut')}>
          <HeldOutTab workspace={workspace} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default SleepReviewPage;
