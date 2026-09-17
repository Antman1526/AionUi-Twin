/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import PreferenceRow from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/PreferenceRow';
import { Switch } from '@arco-design/web-react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate as mutateSWR } from 'swr';

/** Shared SWR key so the Titlebar pill and model selectors pick up the toggle instantly. */
const PRIVATE_MODE_SWR_KEY = 'privacy.privateMode';
const TELEMETRY_ENABLED_SWR_KEY = 'telemetry.enabled';

/**
 * Privacy settings: Private Mode (local-only models, no telemetry, no
 * public-IP lookup, no remote extension downloads) and the crash-reporting
 * opt-in, which Private Mode forces off.
 */
const PrivacySettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const { data: privateMode } = useSWR(PRIVATE_MODE_SWR_KEY, () => ipcBridge.privacy.getPrivateMode.invoke());
  const { data: telemetryEnabled } = useSWR(TELEMETRY_ENABLED_SWR_KEY, () => ConfigStorage.get('telemetry.enabled'));

  const handlePrivateModeChange = useCallback((checked: boolean) => {
    void mutateSWR(PRIVATE_MODE_SWR_KEY, checked, { revalidate: false });
    ipcBridge.privacy.setPrivateMode.invoke({ enabled: checked }).catch(() => {
      void mutateSWR(PRIVATE_MODE_SWR_KEY, !checked, { revalidate: false });
    });
  }, []);

  const handleTelemetryChange = useCallback((checked: boolean) => {
    void mutateSWR(TELEMETRY_ENABLED_SWR_KEY, checked, { revalidate: false });
    ConfigStorage.set('telemetry.enabled', checked).catch(() => {
      void mutateSWR(TELEMETRY_ENABLED_SWR_KEY, !checked, { revalidate: false });
    });
  }, []);

  return (
    <div className='mt-16px px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px'>
      <div className='text-14px font-medium text-t-primary mb-8px'>{t('settings.privacy.title')}</div>
      <div className='w-full flex flex-col divide-y divide-border-2'>
        <PreferenceRow label={t('settings.privacy.privateMode')} description={t('settings.privacy.privateModeDesc')}>
          <Switch checked={!!privateMode} onChange={handlePrivateModeChange} />
        </PreferenceRow>
        <PreferenceRow
          label={t('settings.privacy.sendCrashReports')}
          description={t('settings.privacy.sendCrashReportsDesc')}
        >
          <Switch
            checked={!privateMode && !!telemetryEnabled}
            disabled={!!privateMode}
            onChange={handleTelemetryChange}
          />
        </PreferenceRow>
      </div>
    </div>
  );
};

export default PrivacySettingsSection;
