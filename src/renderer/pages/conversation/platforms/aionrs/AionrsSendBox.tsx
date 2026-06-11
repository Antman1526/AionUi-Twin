/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';
import SendBox from '@/renderer/components/chat/sendbox';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import FilePreview from '@/renderer/components/media/FilePreview';
import HorizontalFileList from '@/renderer/components/media/HorizontalFileList';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/chat/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';
import { useOpenFileSelector } from '@/renderer/hooks/file/useOpenFileSelector';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { useAddOrUpdateMessage, useRemoveMessageByMsgId } from '@/renderer/pages/conversation/Messages/hooks';
import { assertBridgeSuccess } from '@/renderer/pages/conversation/platforms/assertBridgeSuccess';
import {
  shouldEnqueueConversationCommand,
  useConversationCommandQueue,
  type ConversationCommandQueueItem,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { allSupportedExts } from '@/renderer/services/FileService';
import { iconColors } from '@/renderer/styles/colors';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems } from '@/renderer/utils/file/fileSelection';
import { buildDisplayMessage, collectSelectedFiles } from '@/renderer/utils/file/messageFiles';
import { mergeWithCapabilities, type AgentModeOption } from '@/renderer/utils/model/agentModes';
import { getModelContextLimit } from '@/renderer/utils/model/modelContextLimits';
import { Message, Tag } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { useAionrsMessage } from './useAionrsMessage';
import type { AionrsModelSelection } from './useAionrsModelSelection';

const useAionrsSendBoxDraft = getSendBoxDraftHook('aionrs', {
  _type: 'aionrs',
  atPath: [],
  content: '',
  uploadFile: [],
});

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];

const normalizeBaseUrl = (url?: string): string => {
  if (!url) return '';
  return url.replace(/\/+$/, '');
};

const isLoopbackBaseUrl = (url?: string): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAionrsSendBoxDraft(conversation_id);

  const atPath = data?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = data?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = data?.content ?? '';

  const setAtPath = useCallback(
    (nextAtPath: Array<string | FileOrFolderItem>) => {
      mutate((prev) => ({ ...prev, atPath: nextAtPath }));
    },
    [data, mutate]
  );

  const setUploadFile = createSetUploadFile(mutate, data);

  const setContent = useCallback(
    (nextContent: string) => {
      mutate((prev) => ({ ...prev, content: nextContent }));
    },
    [data, mutate]
  );

  return {
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
    content,
    setContent,
  };
};

const AionrsSendBox: React.FC<{
  conversation_id: string;
  modelSelection: AionrsModelSelection;
  teamId?: string;
  agentSlotId?: string;
  sessionMode?: string;
}> = ({ conversation_id, modelSelection, teamId, agentSlotId, sessionMode }) => {
  const [workspacePath, setWorkspacePath] = useState('');
  const [dynamicModes, setDynamicModes] = useState<AgentModeOption[]>([]);
  const { t } = useTranslation();
  const { checkAndUpdateTitle } = useAutoTitle();
  const { currentModel, getDisplayModelName } = modelSelection;

  const { thought, running, hasHydratedRunningState, tokenUsage, beginWaitingResponse, clearPendingResponseMessage, resetState } =
    useAionrsMessage(conversation_id, {
      onConfigChanged: (capabilities) => {
        const modes = (capabilities as { modes?: string[] })?.modes;
        if (modes && modes.length > 0) {
          setDynamicModes(mergeWithCapabilities('aionrs', modes));
        }
      },
    });

  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent } = useSendBoxDraft(conversation_id);

  useEffect(() => {
    void ipcBridge.conversation.get.invoke({ id: conversation_id }).then((res) => {
      if (!res?.extra?.workspace) return;
      setWorkspacePath(res.extra.workspace);
    });
  }, [conversation_id]);

  const slashCommands = useSlashCommands(conversation_id);
  const { data: localModelStatus } = useSWR(
    running ? 'aionrs.local-model-runtime-status' : null,
    () => ipcBridge.localModel.getStatus.invoke().then((res) => res.data),
    { refreshInterval: 2000 }
  );

  const addOrUpdateMessage = useAddOrUpdateMessage();
  const removeMessageByMsgId = useRemoveMessageByMsgId();
  const { setSendBoxHandler } = usePreviewContext();
  const isBusy = running;

  const localRuntimeDescription = useMemo(() => {
    const modelName = currentModel?.useModel ? getDisplayModelName(currentModel.useModel) : '';
    const currentBaseUrl = normalizeBaseUrl(currentModel?.baseUrl);
    const runtimeBaseUrl = normalizeBaseUrl(localModelStatus?.baseUrl);
    const isCurrentLocalRuntime =
      Boolean(localModelStatus?.running) &&
      currentBaseUrl &&
      runtimeBaseUrl &&
      currentBaseUrl === runtimeBaseUrl &&
      (!localModelStatus?.name || localModelStatus.name === currentModel?.useModel);

    if (isCurrentLocalRuntime) {
      return t('conversation.chat.localModelReady', { model: modelName });
    }
    if (isLoopbackBaseUrl(currentModel?.baseUrl)) {
      return localModelStatus
        ? t('conversation.chat.localModelNotRunning')
        : t('conversation.chat.localModelChecking');
    }
    return t('conversation.chat.waitingForModel', { model: modelName });
  }, [currentModel?.baseUrl, currentModel?.useModel, getDisplayModelName, localModelStatus, t]);

  const setContentRef = useLatestRef(setContent);
  const atPathRef = useLatestRef(atPath);

  // Register handler for adding text from preview panel to sendbox
  useEffect(() => {
    const handler = (text: string) => {
      const newContent = content ? `${content}\n${text}` : text;
      setContentRef.current(newContent);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  // Listen for sendbox.fill event to populate input from external sources
  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      setContentRef.current(text);
    },
    []
  );

  // Shared file handling logic
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });

  const executeCommand = useCallback(
    async ({ input, files }: Pick<ConversationCommandQueueItem, 'input' | 'files'>) => {
      if (!currentModel?.useModel) {
        Message.warning(t('conversation.chat.noModelSelected'));
        throw new Error('No model selected');
      }

      const msg_id = uuid();
      beginWaitingResponse(msg_id, {
        subject: t('conversation.chat.generatingAnswer'),
        description: localRuntimeDescription,
        noFirstTokenMessage: t('conversation.chat.noFirstTokenYet'),
        stillWaitingSubject: t('conversation.chat.stillWaiting'),
      });

      const displayMessage = buildDisplayMessage(input, files, workspacePath);
      if (!teamId) {
        addOrUpdateMessage(
          {
            id: msg_id,
            type: 'text',
            position: 'right',
            conversation_id,
            content: {
              content: displayMessage,
            },
            createdAt: Date.now(),
          },
          true
        );
      }

      try {
        void checkAndUpdateTitle(conversation_id, input);
        if (teamId) {
          if (agentSlotId) {
            const result = await ipcBridge.team.sendMessageToAgent.invoke({
              teamId,
              slotId: agentSlotId,
              content: displayMessage,
              files,
            });
            const maybeError = result as unknown as { __bridgeError?: boolean; message?: string };
            if (maybeError.__bridgeError) {
              throw new Error(maybeError.message || 'Failed to send message to agent');
            }
          } else {
            const result = await ipcBridge.team.sendMessage.invoke({ teamId, content: displayMessage, files });
            const maybeError = result as unknown as { __bridgeError?: boolean; message?: string };
            if (maybeError.__bridgeError) {
              throw new Error(maybeError.message || 'Failed to send message to team');
            }
          }
        } else {
          const result = await ipcBridge.conversation.sendMessage.invoke({
            input: displayMessage,
            msg_id,
            conversation_id,
            files,
          });
          assertBridgeSuccess(result, 'Failed to send message to Aion CLI');
        }
        emitter.emit('chat.history.refresh');
        if (files.length > 0) {
          emitter.emit('aionrs.workspace.refresh');
        }
      } catch (error) {
        clearPendingResponseMessage();
        removeMessageByMsgId(msg_id);
        addOrUpdateMessage(
          {
            id: `send-error-${msg_id}`,
            type: 'tips',
            msg_id: `${msg_id}:send-error`,
            position: 'center',
            conversation_id,
            content: {
              content: error instanceof Error ? error.message : t('conversation.chat.sendFailed'),
              type: 'error',
            },
            createdAt: Date.now(),
          },
          true
        );
        throw error;
      }
    },
    [
      addOrUpdateMessage,
      agentSlotId,
      checkAndUpdateTitle,
      conversation_id,
      currentModel?.useModel,
      beginWaitingResponse,
      clearPendingResponseMessage,
      localRuntimeDescription,
      removeMessageByMsgId,
      t,
      teamId,
      workspacePath,
    ]
  );

  const {
    items: queuedCommands,
    isPaused: isQueuePaused,
    isInteractionLocked: isQueueInteractionLocked,
    hasPendingCommands,
    enqueue,
    remove,
    clear,
    reorder,
    pause,
    resume,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  } = useConversationCommandQueue({
    conversationId: conversation_id,
    enabled: true,
    isBusy,
    isHydrated: hasHydratedRunningState,
    onExecute: executeCommand,
  });

  // Handle initial message from Guid page
  useEffect(() => {
    if (!conversation_id) return;

    const storageKey = `aionrs_initial_message_${conversation_id}`;
    const processedKey = `aionrs_initial_processed_${conversation_id}`;

    const processInitialMessage = async () => {
      if (sessionStorage.getItem(processedKey)) return;
      const storedMessage = sessionStorage.getItem(storageKey);
      if (!storedMessage) return;

      sessionStorage.setItem(processedKey, '1');
      sessionStorage.removeItem(storageKey);

      try {
        const { input, files: initialFiles } = JSON.parse(storedMessage);
        await executeCommand({ input, files: initialFiles || [] });
      } catch (error) {
        console.error('[AionrsSendBox] Failed to send initial message:', error);
        sessionStorage.removeItem(processedKey);
      }
    };

    void processInitialMessage();
  }, [conversation_id, executeCommand]);

  const onSendHandler = async (message: string) => {
    if (!teamId && isBusy) {
      Message.warning(t('messages.conversationInProgress'));
      return;
    }

    const filesToSend = collectSelectedFiles(uploadFile, atPath);
    clearFiles();
    emitter.emit('aionrs.selected.file.clear');

    if (
      shouldEnqueueConversationCommand({
        enabled: true,
        isBusy,
        hasPendingCommands,
      })
    ) {
      enqueue({ input: message, files: filesToSend });
      return;
    }

    await executeCommand({ input: message, files: filesToSend });
  };

  const handleEditQueuedCommand = useCallback(
    (item: ConversationCommandQueueItem) => {
      remove(item.id);
      setContent(item.input);
      setUploadFile(Array.from(new Set(item.files)));
      setAtPath([]);
      emitter.emit('aionrs.selected.file.clear');
    },
    [remove, setAtPath, setContent, setUploadFile]
  );

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      setUploadFile((prev) => [...prev, ...files]);
    },
    [setUploadFile]
  );
  const { openFileSelector, onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
  });

  useAddEventListener('aionrs.selected.file', setAtPath);
  useAddEventListener('aionrs.selected.file.append', (selectedItems: Array<string | FileOrFolderItem>) => {
    const merged = mergeFileSelectionItems(atPathRef.current, selectedItems);
    if (merged !== atPathRef.current) {
      setAtPath(merged as Array<string | FileOrFolderItem>);
    }
  });

  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    try {
      await ipcBridge.conversation.stop.invoke({ conversation_id });
    } finally {
      resetState();
      resetActiveExecution('stop');
    }
  };

  return (
    <div className='max-w-800px w-full mx-auto flex flex-col mt-auto mb-16px'>
      <CommandQueuePanel
        items={queuedCommands}
        paused={isQueuePaused}
        interactionLocked={isQueueInteractionLocked}
        onPause={pause}
        onResume={resume}
        onInteractionLock={lockInteraction}
        onInteractionUnlock={unlockInteraction}
        onEdit={handleEditQueuedCommand}
        onReorder={reorder}
        onRemove={remove}
        onClear={clear}
      />
      <ThoughtDisplay thought={thought} running={running} onStop={handleStop} />

      <SendBox
        value={content}
        onChange={setContent}
        selectedWorkspaceItems={atPath}
        onSelectedWorkspaceItemsChange={(items) => {
          emitter.emit('aionrs.selected.file', items);
          setAtPath(items);
        }}
        loading={isBusy}
        disabled={!currentModel?.useModel}
        placeholder={
          currentModel?.useModel
            ? t('conversation.chat.sendMessageTo', { model: getDisplayModelName(currentModel.useModel) })
            : t('conversation.chat.noModelSelected')
        }
        onStop={handleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        hasPendingAttachments={uploadFile.length > 0 || atPath.length > 0}
        supportedExts={allSupportedExts}
        defaultMultiLine={true}
        lockMultiLine={true}
        tools={
          <div className='flex items-center gap-4px'>
            <FileAttachButton openFileSelector={openFileSelector} onLocalFilesAdded={handleFilesAdded} />
            <AgentModeSelector
              backend='aionrs'
              conversationId={conversation_id}
              compact
              initialMode={sessionMode}
              dynamicModes={dynamicModes}
              compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
              modeLabelFormatter={(mode) => t(`agentMode.${mode.value}`, { defaultValue: mode.label })}
              compactLabelPrefix={t('agentMode.permission')}
              hideCompactLabelPrefixOnMobile
            />
          </div>
        }
        sendButtonPrefix={
          <ContextUsageIndicator
            tokenUsage={tokenUsage}
            contextLimit={getModelContextLimit(currentModel?.useModel)}
            size={24}
          />
        }
        prefix={
          <>
            {uploadFile.length > 0 && (
              <HorizontalFileList>
                {uploadFile.map((path) => (
                  <FilePreview
                    key={path}
                    path={path}
                    onRemove={() => setUploadFile(uploadFile.filter((v) => v !== path))}
                  />
                ))}
              </HorizontalFileList>
            )}
            {atPath.some((item) => (typeof item === 'string' ? false : !item.isFile)) && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                {atPath.map((item) => {
                  if (typeof item === 'string') return null;
                  if (!item.isFile) {
                    return (
                      <Tag
                        key={item.path}
                        color='blue'
                        closable
                        onClose={() => {
                          const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                          emitter.emit('aionrs.selected.file', newAtPath);
                          setAtPath(newAtPath);
                        }}
                      >
                        {item.name}
                      </Tag>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </>
        }
        onSend={onSendHandler}
        slashCommands={slashCommands}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        allowSendWhileLoading
      />
    </div>
  );
};

export default AionrsSendBox;
