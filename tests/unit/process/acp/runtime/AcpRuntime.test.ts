// tests/unit/process/acp/runtime/AcpRuntime.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpRuntime } from '@process/acp/runtime/AcpRuntime';
import type { AgentConfig, SessionCallbacks } from '@process/acp/types';
import type { AcpSessionRow, IAcpSessionRepository } from '@process/services/database/IAcpSessionRepository';

let capturedCallbacks: SessionCallbacks;
let capturedConfig: AgentConfig;
let mockStart: ReturnType<typeof vi.fn>;
let mockStop: ReturnType<typeof vi.fn>;
let mockSendMessage: ReturnType<typeof vi.fn>;

vi.mock('@process/acp/session/AcpSession', () => ({
  AcpSession: class MockAcpSession {
    constructor(config: AgentConfig, _factory: unknown, callbacks: SessionCallbacks) {
      capturedConfig = config;
      capturedCallbacks = callbacks;
    }
    start = (...args: unknown[]) => mockStart(...args);
    stop = (...args: unknown[]) => mockStop(...args);
    sendMessage = (...args: unknown[]) => mockSendMessage(...args);
    get status() {
      return 'idle';
    }
  },
}));

vi.mock('@process/team/prompts/teamGuideCapability', () => ({
  shouldInjectTeamGuideMcp: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/process/team/mcp/guide/teamGuideSingleton', () => ({
  getTeamGuideStdioConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn().mockResolvedValue(undefined) },
}));

/** In-memory IAcpSessionRepository used to assert persistence behaviour. */
class FakeAcpSessionRepository implements IAcpSessionRepository {
  readonly rows = new Map<string, AcpSessionRow>();

  getSession(conversationId: string): AcpSessionRow | null {
    return this.rows.get(conversationId) ?? null;
  }
  upsertSession(session: AcpSessionRow): void {
    this.rows.set(session.conversation_id, { ...session });
  }
  updateSessionId(conversationId: string, sessionId: string): void {
    const row = this.rows.get(conversationId);
    if (row) row.session_id = sessionId;
  }
  updateStatus(
    conversationId: string,
    status: 'idle' | 'active' | 'suspended' | 'error',
    suspendedAt?: number | null
  ): void {
    const row = this.rows.get(conversationId);
    if (row) {
      row.session_status = status;
      row.suspended_at = suspendedAt ?? null;
    }
  }
  updateSessionConfig(conversationId: string, config: string): void {
    const row = this.rows.get(conversationId);
    if (row) row.session_config = config;
  }
  touchLastActive(conversationId: string): void {
    const row = this.rows.get(conversationId);
    if (row) row.last_active_at = Date.now();
  }
  getSuspendedSessions(): AcpSessionRow[] {
    return [...this.rows.values()].filter((r) => r.session_status === 'suspended');
  }
  deleteSession(conversationId: string): void {
    this.rows.delete(conversationId);
  }
}

/** Repository writes are queued on a promise chain — let the microtasks run. */
function flushWrites(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    agentBackend: 'claude',
    agentSource: 'extension',
    agentId: 'claude',
    cwd: '/workspace/test',
    ...overrides,
  } as AgentConfig;
}

function makeRow(overrides: Partial<AcpSessionRow>): AcpSessionRow {
  return {
    conversation_id: 'conv-1',
    agent_backend: 'claude',
    agent_source: 'extension',
    agent_id: 'claude',
    session_id: null,
    session_status: 'idle',
    session_config: '{}',
    last_active_at: null,
    suspended_at: null,
    ...overrides,
  };
}

describe('AcpRuntime - acp_session persistence', () => {
  let repo: FakeAcpSessionRepository;
  let runtime: AcpRuntime;

  beforeEach(() => {
    mockStart = vi.fn();
    mockStop = vi.fn().mockResolvedValue(undefined);
    mockSendMessage = vi.fn().mockResolvedValue(undefined);
    repo = new FakeAcpSessionRepository();
    runtime = new AcpRuntime({ create: vi.fn() } as never, { checkIntervalMs: 1_000_000 }, repo);
  });

  it('upserts a session row on createConversation with the agent id, not the conversation id', async () => {
    await runtime.createConversation('conv-1', makeAgentConfig());
    await flushWrites();

    const row = repo.getSession('conv-1');
    expect(row).not.toBeNull();
    expect(row?.conversation_id).toBe('conv-1');
    expect(row?.agent_id).toBe('claude');
    expect(row?.agent_backend).toBe('claude');
    expect(row?.session_id).toBeNull();
    expect(row?.session_status).toBe('idle');
  });

  it('never writes authCredentials into session_config', async () => {
    await runtime.createConversation('conv-1', makeAgentConfig({ authCredentials: { ANTHROPIC_API_KEY: 'secret' } }));
    await flushWrites();

    expect(repo.getSession('conv-1')?.session_config).not.toContain('secret');
  });

  it('deletes the session row on closeConversation', async () => {
    await runtime.createConversation('conv-1', makeAgentConfig());
    await flushWrites();
    expect(repo.getSession('conv-1')).not.toBeNull();

    await runtime.closeConversation('conv-1');
    await flushWrites();

    expect(repo.getSession('conv-1')).toBeNull();
  });

  it('persists the ACP session id reported by the session', async () => {
    await runtime.createConversation('conv-1', makeAgentConfig());
    await flushWrites();

    capturedCallbacks.onSessionId('acp-session-42');
    await flushWrites();

    expect(repo.getSession('conv-1')?.session_id).toBe('acp-session-42');
  });

  it('persists status transitions as stable DB states', async () => {
    await runtime.createConversation('conv-1', makeAgentConfig());
    await flushWrites();

    capturedCallbacks.onStatusChange('prompting');
    await flushWrites();
    expect(repo.getSession('conv-1')?.session_status).toBe('active');

    capturedCallbacks.onStatusChange('suspended');
    await flushWrites();
    expect(repo.getSession('conv-1')?.session_status).toBe('suspended');
    expect(repo.getSession('conv-1')?.suspended_at).not.toBeNull();
  });

  it('prefers the persisted session id when the agent ids match', async () => {
    repo.upsertSession(makeRow({ agent_id: 'claude', session_id: 'persisted-session' }));

    await runtime.createConversation('conv-1', makeAgentConfig());

    expect(capturedConfig.resumeSessionId).toBe('persisted-session');
  });

  it('ignores the persisted session id when the agent ids differ', async () => {
    repo.upsertSession(makeRow({ agent_id: 'codex', session_id: 'persisted-session' }));

    await runtime.createConversation('conv-1', makeAgentConfig({ agentId: 'claude' }));

    expect(capturedConfig.resumeSessionId).toBeUndefined();
  });

  it('keeps an explicit resumeSessionId over the persisted one', async () => {
    repo.upsertSession(makeRow({ agent_id: 'claude', session_id: 'persisted-session' }));

    await runtime.createConversation('conv-1', makeAgentConfig({ resumeSessionId: 'explicit-session' }));

    expect(capturedConfig.resumeSessionId).toBe('explicit-session');
  });

  it('does not break the conversation flow when the repository throws', async () => {
    vi.spyOn(repo, 'upsertSession').mockImplementation(() => {
      throw new Error('db is gone');
    });
    vi.spyOn(repo, 'getSession').mockImplementation(() => {
      throw new Error('db is gone');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(runtime.createConversation('conv-1', makeAgentConfig())).resolves.toBeUndefined();
    await flushWrites();

    expect(mockStart).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
