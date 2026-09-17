import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captures the config handed to AcpAgentV2 so the test can inspect `extra`.
const { capturedConfigs } = vi.hoisted(() => ({ capturedConfigs: [] as Array<Record<string, unknown>> }));

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: { isPackaged: () => false, getAppPath: () => null },
    worker: { fork: vi.fn(() => ({ on: vi.fn().mockReturnThis(), postMessage: vi.fn(), kill: vi.fn() })) },
  }),
}));
vi.mock('@process/utils/shellEnv', () => ({ getEnhancedEnv: vi.fn(() => ({})) }));
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { emit: vi.fn() } },
    conversation: {
      confirmation: { add: { emit: vi.fn() }, update: { emit: vi.fn() }, remove: { emit: vi.fn() } },
      responseStream: { emit: vi.fn() },
      listChanged: { emit: vi.fn() },
    },
  },
}));
vi.mock('@process/channels/agent/ChannelEventBus', () => ({ channelEventBus: { emitAgentMessage: vi.fn() } }));
vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({
    updateConversation: vi.fn(),
    getConversation: vi.fn(() => ({ success: true, data: { extra: {}, source: 'aionui' } })),
  })),
}));
vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => {
      if (key === 'assistants') {
        return [{ id: 'custom-agent-uuid', name: 'My Agent', defaultCliPath: '/usr/bin/my-agent' }];
      }
      return null;
    }),
    set: vi.fn(async () => {}),
  },
}));
vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
  nextTickToLocalFinish: vi.fn(),
}));
vi.mock('@process/utils/previewUtils', () => ({ handlePreviewOpenEvent: vi.fn() }));
vi.mock('@process/services/cron/CronBusyGuard', () => ({ cronBusyGuard: { setProcessing: vi.fn() } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: () => ({ getAcpAdapters: () => [] }) },
}));
vi.mock('@/common/utils', () => ({ parseError: vi.fn((e: unknown) => String(e)), uuid: vi.fn(() => 'mock-uuid') }));
vi.mock('@process/task/MessageMiddleware', () => ({ extractTextFromMessage: vi.fn(), processCronInMessage: vi.fn() }));
vi.mock('@process/task/ThinkTagDetector', () => ({
  stripThinkTags: vi.fn((s: string) => s),
  extractAndStripThinkTags: vi.fn((s: string) => ({ thinking: '', content: s })),
}));
vi.mock('@process/task/CronCommandDetector', () => ({ hasCronCommands: vi.fn(() => false) }));
vi.mock('@process/utils/initAgent', () => ({
  hasNativeSkillSupport: vi.fn(() => false),
  setupAssistantWorkspace: vi.fn(),
}));
vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (content: string) => ({ content, loadedSkills: [] })),
  buildSystemInstructions: vi.fn(async () => undefined),
}));
vi.mock('@process/acp/compat', () => ({
  AcpAgentV2: vi.fn().mockImplementation(function (config: Record<string, unknown>) {
    capturedConfigs.push(config);
    return {
      start: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ success: true })),
      getModelInfo: vi.fn(() => null),
      getSessionState: vi.fn(() => null),
      setMode: vi.fn(async () => undefined),
      stop: vi.fn(),
      kill: vi.fn(),
      on: vi.fn().mockReturnThis(),
    };
  }),
}));

import AcpAgentManager from '@process/task/AcpAgentManager';

describe('AcpAgentManager.initAgent — customAgentId pass-through', () => {
  beforeEach(() => {
    capturedConfigs.length = 0;
  });

  it('forwards customAgentId into agentConfig.extra so acp_session.agent_id can identify the agent', async () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-1',
      backend: 'custom',
      workspace: '/tmp/ws',
      customAgentId: 'custom-agent-uuid',
    } as never);

    await manager.initAgent();

    expect(capturedConfigs).toHaveLength(1);
    const extra = capturedConfigs[0].extra as Record<string, unknown>;
    expect(extra.customAgentId).toBe('custom-agent-uuid');
    expect(extra.backend).toBe('custom');
  });

  it('leaves customAgentId undefined for built-in backends', async () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-2',
      backend: 'claude',
      workspace: '/tmp/ws',
    } as never);

    await manager.initAgent();

    const extra = capturedConfigs[0].extra as Record<string, unknown>;
    expect(extra.customAgentId).toBeUndefined();
  });
});
