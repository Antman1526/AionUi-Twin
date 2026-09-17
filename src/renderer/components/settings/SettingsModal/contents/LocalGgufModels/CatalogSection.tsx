/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalModelDownloadProgressEvent } from '@/common/adapter/ipcBridge';
import { Button, Progress, Tag, Tooltip } from '@arco-design/web-react';
import { CheckOne, Close, Download } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { formatBytes } from './formatBytes';

/**
 * Size-only fit badge for a model that is not on disk yet: the download plus a
 * 25% runtime margin, against the same memory budget the estimator uses.
 */
function sizeOnlyVerdict(bytes: number, budgetBytes: number): 'fits' | 'tight' | 'wontFit' {
  const required = bytes * 1.25;
  if (required <= budgetBytes * 0.7) return 'fits';
  if (required <= budgetBytes) return 'tight';
  return 'wontFit';
}

const FIT_COLORS = { fits: 'green', tight: 'orange', wontFit: 'red' } as const;
const FIT_LABELS = {
  fits: 'settings.localGguf.fitFits',
  tight: 'settings.localGguf.fitTight',
  wontFit: 'settings.localGguf.fitWontFit',
} as const;

/**
 * Curated GGUF models available for one-click, checksum-verified download.
 *
 * `budgetBytes` comes from the fit estimate of an already-scanned model, so the
 * catalog reuses the same machine budget instead of guessing a second time.
 */
const CatalogSection: React.FC<{
  budgetBytes?: number;
  onDownloaded: () => void;
  onError: (message: string) => void;
}> = ({ budgetBytes, onDownloaded, onError }) => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<LocalModelDownloadProgressEvent | null>(null);

  const { data: catalog, mutate: mutateCatalog } = useSWR('local-model.catalog', async () => {
    const res = await ipcBridge.localModel.getCatalog.invoke();
    return res.success ? (res.data ?? []) : [];
  });

  useEffect(() => {
    const removeListener = ipcBridge.localModel.downloadProgress.on((event) => {
      setProgress(event.state === 'downloading' ? event : null);
      if (event.state === 'done') {
        void mutateCatalog();
        onDownloaded();
      }
    });
    return () => removeListener?.();
  }, [mutateCatalog, onDownloaded]);

  const startDownload = async (id: string): Promise<void> => {
    const res = await ipcBridge.localModel.downloadCatalogModel.invoke({ id });
    setProgress(null);
    if (!res.success) {
      onError(res.msg || t('settings.localGguf.catalogDownloadFailed'));
      return;
    }
    void mutateCatalog();
    onDownloaded();
  };

  return (
    <div className='mt-16px'>
      <div className='font-medium text-13px mb-4px'>{t('settings.localGguf.catalogTitle')}</div>
      <div className='text-12px text-t-secondary mb-8px'>{t('settings.localGguf.catalogDescription')}</div>
      <div className='flex flex-col gap-6px'>
        {(catalog ?? []).map((entry) => {
          const downloading = progress?.id === entry.id;
          const verdict = budgetBytes ? sizeOnlyVerdict(entry.bytes, budgetBytes) : undefined;
          return (
            <div
              key={entry.id}
              className='rounded-6px border-1px border-solid border-[var(--color-border-2)] px-12px py-8px'
            >
              <div className='flex items-center justify-between gap-8px'>
                <div className='flex items-center gap-6px min-w-0 flex-wrap'>
                  <span className='truncate text-13px'>{entry.label}</span>
                  <Tag size='small' color='gray'>
                    {formatBytes(entry.bytes)}
                  </Tag>
                  <Tag size='small' color='gray'>
                    {entry.kind === 'embedding'
                      ? t('settings.localGguf.catalogEmbedding')
                      : t('settings.localGguf.catalogChat')}
                  </Tag>
                  {entry.recommendedDefault ? (
                    <Tag size='small' color='arcoblue'>
                      {t('settings.localGguf.catalogRecommended')}
                    </Tag>
                  ) : null}
                  {verdict ? (
                    <Tag size='small' color={FIT_COLORS[verdict]}>
                      {t(FIT_LABELS[verdict])}
                    </Tag>
                  ) : null}
                </div>
                <div className='shrink-0'>
                  {entry.installedPath ? (
                    <Tooltip content={entry.installedPath}>
                      <Tag size='small' color='green' icon={<CheckOne theme='outline' size='12' />}>
                        {t('settings.localGguf.catalogInstalled')}
                      </Tag>
                    </Tooltip>
                  ) : downloading ? (
                    <Button
                      size='mini'
                      status='danger'
                      icon={<Close theme='outline' size='14' />}
                      onClick={() => void ipcBridge.localModel.cancelDownload.invoke({ id: entry.id })}
                    >
                      {t('settings.localGguf.catalogCancel')}
                    </Button>
                  ) : (
                    <Button
                      size='mini'
                      icon={<Download theme='outline' size='14' />}
                      disabled={progress !== null}
                      onClick={() => void startDownload(entry.id)}
                    >
                      {t('settings.localGguf.catalogDownload')}
                    </Button>
                  )}
                </div>
              </div>
              {downloading ? (
                <Progress
                  className='mt-6px'
                  size='small'
                  percent={
                    progress.totalBytes
                      ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
                      : 0
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CatalogSection;
