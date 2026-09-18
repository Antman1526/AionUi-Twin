/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Progress, Radio, Spin, Tag, Message } from '@arco-design/web-react';
import { Download, Search, Close, Check, Cpu, CheckOne, Info } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { HfDownloadProgress, HfModelDetail, HfModelKind, HfModelSummary } from '@/common/adapter/ipcBridge';

interface HfModelHubModalProps {
  visible: boolean;
  onCancel: () => void;
  onModelDownloaded?: () => void;
}

export const HfModelHubModal: React.FC<HfModelHubModalProps> = ({ visible, onCancel, onModelDownloaded }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [modelType, setModelType] = useState<HfModelKind>('all');
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<HfModelSummary[]>([]);
  const [selectedModel, setSelectedModel] = useState<HfModelDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, HfDownloadProgress>>({});

  const handleSearch = async () => {
    setLoading(true);
    try {
      const res = await ipcBridge.hfHub.searchModels.invoke({
        query: query.trim() || undefined,
        type: modelType,
        limit: 15,
      });
      if (res.success && res.data) {
        setModels(res.data);
      }
    } catch {
      Message.error('Failed to search Hugging Face models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      void handleSearch();
    }
  }, [visible, modelType]);

  useEffect(() => {
    const unsub = ipcBridge.hfHub.downloadProgress.on((progress) => {
      setDownloads((prev) => ({
        ...prev,
        [progress.downloadId]: progress,
      }));

      if (progress.status === 'completed') {
        Message.success(`Downloaded ${progress.fileName} successfully!`);
        onModelDownloaded?.();
      } else if (progress.status === 'failed') {
        Message.error(`Download failed: ${progress.error || 'Unknown error'}`);
      }
    });

    return () => {
      unsub();
    };
  }, [onModelDownloaded]);

  const handleSelectModel = async (summary: HfModelSummary) => {
    setDetailsLoading(true);
    try {
      const res = await ipcBridge.hfHub.getModelDetails.invoke({ modelId: summary.id });
      if (res.success && res.data) {
        setSelectedModel(res.data);
      }
    } catch {
      Message.error('Failed to fetch model details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleStartDownload = async (modelId: string, fileName?: string, isMlx?: boolean) => {
    try {
      const res = await ipcBridge.hfHub.startDownload.invoke({ modelId, fileName, isMlx });
      if (res.success && res.data) {
        Message.info(`Starting download for ${fileName || modelId}...`);
      } else {
        Message.error(res.msg || 'Could not start download');
      }
    } catch (err: unknown) {
      Message.error(err instanceof Error ? err.message : 'Download error');
    }
  };

  const handleCancelDownload = async (downloadId: string) => {
    await ipcBridge.hfHub.cancelDownload.invoke({ downloadId });
    Message.info('Download cancelled');
  };

  return (
    <Modal
      title='Hugging Face Model Hub'
      visible={visible}
      onCancel={onCancel}
      footer={null}
      style={{ width: 780 }}
      className='hf-model-hub-modal'
    >
      <div className='flex flex-col gap-12px'>
        <div className='flex items-center gap-8px'>
          <Input
            prefix={<Search theme='outline' size='14' />}
            placeholder='Search GGUF and Apple Silicon native MLX models (e.g. Qwen2.5, Llama-3, DeepSeek)...'
            value={query}
            onChange={setQuery}
            onPressEnter={() => void handleSearch()}
            allowClear
          />
          <Button type='primary' onClick={() => void handleSearch()} loading={loading}>
            Search
          </Button>
        </div>

        <div className='flex items-center justify-between'>
          <Radio.Group
            type='button'
            size='small'
            value={modelType}
            onChange={(val) => setModelType(val as HfModelKind)}
          >
            <Radio value='all'>All Models</Radio>
            <Radio value='gguf'>GGUF (llama.cpp)</Radio>
            <Radio value='mlx'>MLX (Apple Native)</Radio>
          </Radio.Group>
          <span className='text-11px text-t-secondary'>Directly streamed into your WE models directory</span>
        </div>

        {/* Active Downloads Bar */}
        {Object.values(downloads).length > 0 && (
          <div className='flex flex-col gap-4px p-8px rounded-6px bg-fill-2 border-1px border-solid border-[var(--color-border-2)]'>
            <div className='text-11px font-semibold text-t-secondary'>Active Downloads</div>
            {Object.values(downloads).map((dl) => (
              <div key={dl.downloadId} className='flex items-center justify-between gap-8px text-12px'>
                <div className='flex items-center gap-6px truncate'>
                  <Tag size='small' color={dl.isMlx ? 'arcoblue' : 'green'}>
                    {dl.isMlx ? 'MLX' : 'GGUF'}
                  </Tag>
                  <span className='truncate font-mono text-11px'>{dl.fileName}</span>
                  {dl.status === 'downloading' && (
                    <span className='text-10px text-t-secondary'>
                      ({(dl.speedBytesPerSec / 1024 / 1024).toFixed(1)} MB/s)
                    </span>
                  )}
                  {dl.status === 'completed' ? (
                    dl.verified ? (
                      <Tag size='small' color='green' icon={<CheckOne theme='outline' size='11' />}>
                        {t('settings.localGguf.hfVerified')}
                      </Tag>
                    ) : (
                      <Tag size='small' color='gray' icon={<Info theme='outline' size='11' />}>
                        {t('settings.localGguf.hfNotVerified')}
                      </Tag>
                    )
                  ) : null}
                </div>
                <div className='flex items-center gap-8px shrink-0'>
                  <div className='w-80px'>
                    <Progress
                      percent={dl.percent}
                      size='mini'
                      status={dl.status === 'completed' ? 'success' : dl.status === 'failed' ? 'error' : 'normal'}
                    />
                  </div>
                  {dl.status === 'downloading' && (
                    <Button
                      size='mini'
                      type='text'
                      status='danger'
                      icon={<Close theme='outline' size='12' />}
                      onClick={() => void handleCancelDownload(dl.downloadId)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Model Results Grid & File Viewer */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-10px min-h-340px max-h-460px overflow-y-auto'>
          {loading ? (
            <div className='col-span-2 flex items-center justify-center py-40px'>
              <Spin tip='Searching Hugging Face...' />
            </div>
          ) : models.length === 0 ? (
            <div className='col-span-2 text-center text-t-secondary py-40px text-12px'>
              No models found. Try searching for "qwen", "llama", or "deepseek".
            </div>
          ) : (
            models.map((item) => {
              const isSelected = selectedModel?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => void handleSelectModel(item)}
                  className={`p-10px rounded-6px border-1px border-solid cursor-pointer transition-colors flex flex-col justify-between ${
                    isSelected
                      ? 'border-[var(--color-primary-light-4)] bg-primary-1'
                      : 'border-[var(--color-border-2)] hover:bg-fill-1'
                  }`}
                >
                  <div>
                    <div className='flex items-center justify-between mb-4px'>
                      <span className='font-semibold text-13px truncate'>{item.id}</span>
                      <Tag size='small' color={item.modelType === 'mlx' ? 'arcoblue' : 'green'}>
                        {item.modelType.toUpperCase()}
                      </Tag>
                    </div>
                    <div className='text-11px text-t-secondary mb-6px line-clamp-2'>
                      {item.description || 'Community model hosted on Hugging Face'}
                    </div>
                  </div>
                  <div className='flex items-center justify-between text-11px text-t-secondary'>
                    <span>📥 {item.downloads.toLocaleString()}</span>
                    <span>❤️ {item.likes.toLocaleString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Details and Download Drawer */}
        {selectedModel && (
          <div className='p-10px rounded-6px border-1px border-solid border-[var(--color-border-2)] bg-fill-1'>
            {detailsLoading ? (
              <div className='flex items-center justify-center py-16px'>
                <Spin tip='Loading model artifacts...' />
              </div>
            ) : (
              <div className='flex flex-col gap-8px'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-6px'>
                    <Cpu theme='outline' size='14' />
                    <span className='font-semibold text-12px'>{selectedModel.id}</span>
                  </div>
                  {selectedModel.modelType === 'mlx' && (
                    <Button
                      size='mini'
                      type='primary'
                      icon={<Download theme='outline' size='14' />}
                      onClick={() => void handleStartDownload(selectedModel.id, undefined, true)}
                    >
                      Download MLX Model Bundle
                    </Button>
                  )}
                </div>

                {selectedModel.modelType === 'gguf' && (
                  <div>
                    <div className='text-11px text-t-secondary mb-4px font-medium'>
                      Select Quantization to Download:
                    </div>
                    <div className='flex flex-col gap-4px max-h-140px overflow-y-auto'>
                      {selectedModel.files.map((file) => (
                        <div
                          key={file.name}
                          className='flex items-center justify-between px-8px py-4px rounded-4px bg-fill-2 text-12px'
                        >
                          <div className='flex items-center gap-6px truncate'>
                            <span className='truncate font-mono text-11px'>{file.name}</span>
                            {file.quantization && (
                              <Tag size='small' color='blue'>
                                {file.quantization}
                              </Tag>
                            )}
                          </div>
                          <Button
                            size='mini'
                            type='outline'
                            icon={<Download theme='outline' size='12' />}
                            onClick={() => void handleStartDownload(selectedModel.id, file.name, false)}
                          >
                            Download
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default HfModelHubModal;
