/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Popover, Progress } from '@arco-design/web-react';
import { Cpu } from '@icon-park/react';
import { ipcBridge } from '@/common';
import useSWR from 'swr';

const formatGb = (bytes: number): string => {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1);
};

export const HardwareHUD: React.FC = () => {
  const { data: metricsRes } = useSWR(
    'system-metrics.get',
    async () => {
      const res = await ipcBridge.systemMetrics.getMetrics.invoke();
      return res.success ? res.data : null;
    },
    { refreshInterval: 4000 }
  );

  if (!metricsRes) return null;

  const totalGb = formatGb(metricsRes.totalMemBytes);
  const usedGb = formatGb(metricsRes.usedMemBytes);
  const percent = Math.round((metricsRes.usedMemBytes / metricsRes.totalMemBytes) * 100);

  const popoverContent = (
    <div className='p-6px text-12px min-w-220px'>
      <div className='flex items-center gap-6px font-semibold mb-8px pb-4px border-b-1px border-solid border-[var(--color-border-2)]'>
        <Cpu theme='outline' size='15' />
        <span>{metricsRes.isAppleSilicon ? 'Apple Silicon Unified Memory' : 'System Hardware Telemetry'}</span>
      </div>
      <div className='flex flex-col gap-6px text-t-secondary'>
        <div className='flex justify-between'>
          <span>CPU Platform:</span>
          <span className='font-mono font-medium text-t-primary'>{metricsRes.cpuModel || 'Apple Silicon'}</span>
        </div>
        <div className='flex justify-between'>
          <span>Memory Allocated:</span>
          <span className='font-mono font-medium text-t-primary'>
            {usedGb} GB / {totalGb} GB ({percent}%)
          </span>
        </div>
        <div className='flex justify-between'>
          <span>Memory Headroom:</span>
          <span className='font-mono font-medium text-emerald-500'>{formatGb(metricsRes.freeMemBytes)} GB free</span>
        </div>
        {metricsRes.activeLlama ? (
          <div className='mt-6px pt-6px border-t-1px border-solid border-[var(--color-border-2)]'>
            <div className='text-11px font-semibold text-t-primary mb-2px'>Active Neural Engine Model:</div>
            <div className='font-mono text-11px truncate text-t-secondary'>{metricsRes.activeLlama.alias}</div>
            <div className='text-10px text-t-secondary'>PID: {metricsRes.activeLlama.pid} (Metal GPU offload)</div>
          </div>
        ) : (
          <div className='mt-4px text-11px text-t-secondary italic'>Local model engine idle.</div>
        )}
      </div>
    </div>
  );

  return (
    <Popover content={popoverContent} trigger='hover' position='bottom'>
      <div className='flex items-center gap-6px px-8px py-3px rounded-full bg-fill-2 border-1px border-solid border-[var(--color-border-2)] cursor-pointer hover:bg-fill-3 transition-colors select-none'>
        <Cpu theme='outline' size='13' className='text-t-secondary' />
        <span className='text-11px font-mono text-t-secondary'>
          {usedGb}/{totalGb} GB
        </span>
        <div className='w-28px'>
          <Progress
            percent={percent}
            size='mini'
            showText={false}
            status={percent > 85 ? 'warning' : 'normal'}
            color={percent > 85 ? '#f59e0b' : '#3b82f6'}
          />
        </div>
      </div>
    </Popover>
  );
};

export default HardwareHUD;
