/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layout, Tabs, Typography } from '@arco-design/web-react';
import HeldOutTab from './HeldOutTab';
import ProposalsTab from './ProposalsTab';
import ReviewTab from './ReviewTab';

/** Native SkillOpt "Sleep Review" page (`/sleep-review`). */
const SleepReviewPage: React.FC = () => {
  const { t } = useTranslation();
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeTab, setActiveTab] = useState('review');

  return (
    <Layout className='size-full overflow-y-auto'>
      <Layout.Content className='p-24px flex flex-col gap-16px'>
        <div className='flex flex-col gap-4px'>
          <Typography.Title heading={5} className='!m-0 text-t-primary'>
            {t('sleepReview.title')}
          </Typography.Title>
          <Typography.Text className='text-t-secondary'>{t('sleepReview.subtitle')}</Typography.Text>
        </div>
        <Tabs activeTab={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane key='review' title={t('sleepReview.tabs.review')}>
            <ReviewTab
              onProposalStaged={() => {
                setRefreshToken((token) => token + 1);
                setActiveTab('proposals');
              }}
            />
          </Tabs.TabPane>
          <Tabs.TabPane key='proposals' title={t('sleepReview.tabs.proposals')}>
            <ProposalsTab refreshToken={refreshToken} />
          </Tabs.TabPane>
          <Tabs.TabPane key='heldOut' title={t('sleepReview.tabs.heldOut')}>
            <HeldOutTab />
          </Tabs.TabPane>
        </Tabs>
      </Layout.Content>
    </Layout>
  );
};

export default SleepReviewPage;
