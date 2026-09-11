/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Badge, Tooltip } from '@arco-design/web-react';
import { Shield, Lock } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { soundEffects } from '@/renderer/utils/audio/soundEffects';

export const GhostModeToggle: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);

  useEffect(() => {
    void ipcBridge.ghostMode.getStatus.invoke().then((res) => {
      if (res.success && res.data) {
        setEnabled(res.data.enabled);
        setBlockedCount(res.data.blockedRequestsCount);
      }
    });

    const unsubscribe = ipcBridge.ghostMode.statusChanged.on((data) => {
      setEnabled(data.enabled);
      setBlockedCount(data.blockedRequestsCount);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleToggle = async () => {
    const next = !enabled;
    soundEffects.playShieldLock(next);
    const res = await ipcBridge.ghostMode.toggle.invoke({ enabled: next });
    if (res.success && res.data) {
      setEnabled(res.data.enabled);
      setBlockedCount(res.data.blockedRequestsCount);
    }
  };

  return (
    <Tooltip
      content={
        enabled
          ? `Air-Gapped Ghost Mode Active: External web traffic is physically blocked. (Blocked: ${blockedCount} calls)`
          : 'Air-Gapped Ghost Mode: Click to isolate WE into 100% offline, zero-telemetry operation.'
      }
    >
      <div
        role='button'
        tabIndex={0}
        onClick={() => void handleToggle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            void handleToggle();
          }
        }}
        className={`flex items-center gap-4px px-8px py-3px rounded-full border-1px border-solid cursor-pointer transition-all duration-200 select-none focus:outline-none ${
          enabled
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
            : 'bg-fill-2 border-[var(--color-border-2)] text-t-secondary hover:bg-fill-3'
        }`}
      >
        {enabled ? <Lock theme='filled' size='13' /> : <Shield theme='outline' size='13' />}
        <span className='text-11px font-semibold'>{enabled ? 'Ghost' : 'Ghost Off'}</span>
        {enabled && blockedCount > 0 ? (
          <Badge count={blockedCount} maxCount={99} className='ml-2px scale-75 origin-left' />
        ) : null}
      </div>
    </Tooltip>
  );
};

export default GhostModeToggle;
