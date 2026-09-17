/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalModelExecutableStatus } from '@/common/adapter/ipcBridge';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Alert, Button } from '@arco-design/web-react';
import { FolderOpen, Link, Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/** Upstream release page, used when no package manager applies. */
export const LLAMA_CPP_RELEASES_URL = 'https://github.com/ggml-org/llama.cpp/releases';

/** Per-platform install hint. Commands come from the llama.cpp install docs. */
const installHintKey = (
  platform: string
): 'executableInstallMac' | 'executableInstallWindows' | 'executableInstallLinux' => {
  if (platform === 'darwin') return 'executableInstallMac';
  if (platform === 'win32') return 'executableInstallWindows';
  return 'executableInstallLinux';
};

/**
 * Shows where `llama-server` was found, or per-platform install guidance plus a
 * manual picker when it is missing. Nothing is ever downloaded automatically.
 */
const ExecutablePanel: React.FC<{
  status?: LocalModelExecutableStatus;
  onChanged: () => void;
  onError: (message: string) => void;
}> = ({ status, onChanged, onError }) => {
  const { t } = useTranslation();

  const chooseExecutable = async (): Promise<void> => {
    const picked = await ipcBridge.dialog.showOpen.invoke({ properties: ['openFile'] });
    const file = picked?.[0];
    if (!file) return;
    const res = await ipcBridge.localModel.setExecutablePath.invoke({ path: file });
    if (!res.success) {
      onError(res.msg || t('settings.localGguf.executableSaveFailed'));
      return;
    }
    onChanged();
  };

  const actions = (
    <div className='flex items-center gap-6px mt-6px'>
      <Button size='mini' icon={<FolderOpen theme='outline' size='14' />} onClick={() => void chooseExecutable()}>
        {t('settings.localGguf.executableChoose')}
      </Button>
      <Button size='mini' icon={<Refresh theme='outline' size='14' />} onClick={onChanged}>
        {t('settings.localGguf.executableRecheck')}
      </Button>
    </div>
  );

  if (!status) return null;

  if (status.found) {
    return (
      <div className='flex items-center justify-between gap-8px mb-12px px-10px py-6px rounded-6px bg-fill-1'>
        <span className='truncate text-12px text-t-secondary'>
          {t('settings.localGguf.executableFound', { path: status.path ?? '' })}
        </span>
        <Button size='mini' icon={<FolderOpen theme='outline' size='14' />} onClick={() => void chooseExecutable()}>
          {t('settings.localGguf.executableChoose')}
        </Button>
      </div>
    );
  }

  return (
    <Alert
      type='warning'
      className='mb-12px'
      title={t('settings.localGguf.executableTitle')}
      content={
        <div className='flex flex-col gap-2px'>
          <span className='text-12px'>{t('settings.localGguf.executableMissing')}</span>
          <span className='text-12px'>{t(`settings.localGguf.${installHintKey(status.platform)}`)}</span>
          <Button
            size='mini'
            type='text'
            className='self-start px-0'
            icon={<Link theme='outline' size='14' />}
            onClick={() => void openExternalUrl(LLAMA_CPP_RELEASES_URL)}
          >
            {t('settings.localGguf.executableReleases')}
          </Button>
          {actions}
        </div>
      }
    />
  );
};

export default ExecutablePanel;
