/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import useSWR from 'swr';

export const BreathingOrb: React.FC = () => {
  const { data: statusRes } = useSWR('local-model.status', () => ipcBridge.localModel.getStatus.invoke(), {
    refreshInterval: 3000,
  });

  const isRunning = statusRes?.success && statusRes.data?.running;
  const modelName = statusRes?.data?.name;

  return (
    <Tooltip
      content={
        isRunning
          ? `WE Neural Engine: ${modelName || 'Active'} (Metal GPU Accelerated)`
          : 'WE Neural Engine: Standby (Click to launch or load models)'
      }
    >
      <div className='flex items-center gap-6px px-8px py-3px rounded-full bg-fill-2 border-1px border-solid border-[var(--color-border-2)] cursor-pointer hover:bg-fill-3 transition-colors'>
        <div className='relative flex items-center justify-center w-8px h-8px'>
          {isRunning ? (
            <>
              <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75'></span>
              <span className='relative inline-flex rounded-full h-8px w-8px bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]'></span>
            </>
          ) : (
            <span className='relative inline-flex rounded-full h-7px w-7px bg-[var(--color-text-4)]'></span>
          )}
        </div>
        <span className='text-11px font-medium text-t-secondary select-none'>
          {isRunning ? modelName || 'Local AI' : 'Standby'}
        </span>
      </div>
    </Tooltip>
  );
};

export default BreathingOrb;
