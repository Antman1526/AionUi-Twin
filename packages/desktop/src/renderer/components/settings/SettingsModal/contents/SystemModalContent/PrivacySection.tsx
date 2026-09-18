/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import PreferenceRow from './PreferenceRow';

/**
 * Crash-reporting consent.
 *
 * Opt-in: the switch is off until the user turns it on. Ghost Mode isolates the
 * app entirely, so while it is active telemetry is forced off and the switch is
 * locked to communicate that the stored preference is being overridden.
 */
const PrivacySection: React.FC = () => {
  const { t } = useTranslation();
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [ghostMode, setGhostMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ConfigStorage.get('telemetry.enabled')
      .then((value) => {
        if (!cancelled) setTelemetryEnabled(value === true);
      })
      .catch((): undefined => undefined);
    void ipcBridge.ghostMode.getStatus
      .invoke()
      .then((res) => {
        if (!cancelled) setGhostMode(res?.data?.enabled === true);
      })
      .catch((): undefined => undefined);
    const off = ipcBridge.ghostMode.statusChanged.on((status) => setGhostMode(status?.enabled === true));
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const handleChange = useCallback((checked: boolean) => {
    setTelemetryEnabled(checked);
    void ConfigStorage.set('telemetry.enabled', checked).catch((): undefined => undefined);
  }, []);

  return (
    <PreferenceRow
      label={t('settings.privacy.crashReports')}
      description={ghostMode ? t('settings.privacy.crashReportsGhostMode') : t('settings.privacy.crashReportsDesc')}
    >
      <Switch checked={ghostMode ? false : telemetryEnabled} disabled={ghostMode} onChange={handleChange} />
    </PreferenceRow>
  );
};

export default PrivacySection;
