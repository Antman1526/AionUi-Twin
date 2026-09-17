// src/process/acp/runtime/AcpRuntime.ts

import type { TMessage } from '@/common/chat/chatLib';
import { getTeamGuideStdioConfig } from '@/process/team/mcp/guide/teamGuideSingleton';
import type { McpServer } from '@agentclientprotocol/sdk';
import type { ClientFactory } from '@process/acp/infra/IAcpClient';
import { IdleReclaimer } from '@process/acp/runtime/IdleReclaimer';
import { AcpSession } from '@process/acp/session/AcpSession';
import { McpConfig } from '@process/acp/session/McpConfig';
import type {
  AgentConfig,
  ConfigOption,
  RuntimeOptions,
  SessionCallbacks,
  SessionEntry,
  SessionStatus,
  SignalEvent,
} from '@process/acp/types';
import { getAcpSessionRepository, serializeSessionConfig } from '@process/acp/acpSessionRepo';
import type { IAcpSessionRepository } from '@process/services/database/IAcpSessionRepository';
import { shouldInjectTeamGuideMcp } from '@process/team/prompts/teamGuideCapability';
import { ProcessConfig } from '@process/utils/initStorage';

const DEFAULT_IDLE_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_CHECK_INTERVAL_MS = 30_000; // 30 seconds

type StreamEventHandler = (convId: string, message: TMessage) => void;
type SignalEventHandler = (convId: string, event: SignalEvent) => void;

/**
 * Owns the live ACP sessions and mirrors their lifecycle into the
 * `acp_session` table so an ACP session id survives a restart.
 */
export class AcpRuntime {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly idleReclaimer: IdleReclaimer;
  /** Resolves to `null` when persistence is unavailable — never rejects. */
  private readonly acpSessionRepo: Promise<IAcpSessionRepository | null>;

  onStreamEvent: StreamEventHandler = () => {};
  onSignalEvent: SignalEventHandler = () => {};

  constructor(
    private readonly clientFactory: ClientFactory,
    options?: RuntimeOptions,
    acpSessionRepo?: IAcpSessionRepository
  ) {
    this.acpSessionRepo = acpSessionRepo ? Promise.resolve(acpSessionRepo) : getAcpSessionRepository();
    this.idleReclaimer = new IdleReclaimer(
      this.sessions,
      options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    );
    this.idleReclaimer.start();
  }

  /**
   * Run a write against the acp_session table. Failures are logged and
   * swallowed so persistence can never break the conversation flow.
   */
  private writeSessionRow(op: string, fn: (repo: IAcpSessionRepository) => void): void {
    void this.acpSessionRepo
      .then((repo) => {
        if (repo) fn(repo);
      })
      .catch((err) => {
        console.warn(`[AcpRuntime] acp_session ${op} failed:`, err);
      });
  }

  /**
   * Read back the ACP session id persisted for this conversation.
   * Returns `null` unless the stored row belongs to the same agent — a row
   * left behind by a different agent must not be resumed into.
   */
  private async readPersistedSessionId(convId: string, agentId: string): Promise<string | null> {
    try {
      const repo = await this.acpSessionRepo;
      const row = repo?.getSession(convId);
      if (row?.session_id && row.agent_id === agentId) return row.session_id;
    } catch (err) {
      console.warn('[AcpRuntime] acp_session read failed:', err);
    }
    return null;
  }

  async createConversation(convId: string, agentConfig: AgentConfig): Promise<void> {
    if (this.sessions.has(convId)) return;

    // Shallow-clone to avoid mutating the caller's object (e.g., MCP servers would
    // duplicate on retries if we pushed into the original arrays). `convId` is the
    // authoritative conversation id regardless of what the caller populated.
    const config = { ...agentConfig, conversationId: convId };

    // Inject team-guide MCP server for solo agents (not in team mode) so the
    // agent has the aion_create_team tool available.
    if (!config.teamMcpConfig) {
      if (await shouldInjectTeamGuideMcp(config.agentBackend)) {
        const aionStdioConfig = getTeamGuideStdioConfig();
        if (aionStdioConfig) {
          const guideServer: McpServer = {
            name: aionStdioConfig.name,
            command: aionStdioConfig.command,
            args: aionStdioConfig.args,
            env: [
              ...aionStdioConfig.env,
              { name: 'AION_MCP_BACKEND', value: config.agentBackend },
              { name: 'AION_MCP_CONVERSATION_ID', value: convId },
            ],
          };
          config.presetMcpServers = [...(config.presetMcpServers || []), guideServer];
        }
      }
    }

    // Load user-configured (builtin) MCP servers from settings, filtered by
    // cached agent MCP capabilities.

    const rawMcpServers = await ProcessConfig.get('mcp.config');
    if (Array.isArray(rawMcpServers) && rawMcpServers.length > 0) {
      const cachedInit = await ProcessConfig.get('acp.cachedInitializeResult');
      const caps = cachedInit?.[config.agentBackend]?.capabilities?.mcpCapabilities;
      const userServers = McpConfig.fromStorageConfig(rawMcpServers, caps);
      if (userServers.length > 0) {
        config.mcpServers = [...(config.mcpServers || []), ...userServers];
      }
    }

    // Restore hook: SessionLifecycle seeds its session id from
    // `agentConfig.resumeSessionId` inside its constructor, so a persisted id
    // has to be applied before `new AcpSession(...)` below. An explicit
    // resumeSessionId from the caller always wins.
    if (!config.resumeSessionId) {
      const persisted = await this.readPersistedSessionId(convId, config.agentId);
      if (persisted) config.resumeSessionId = persisted;
    }

    const callbacks = this.buildCallbacks(convId);
    const session = new AcpSession(config, this.clientFactory, callbacks);

    this.sessions.set(convId, { session, lastActiveAt: Date.now() });

    this.writeSessionRow('upsert', (repo) =>
      repo.upsertSession({
        conversation_id: convId,
        agent_backend: config.agentBackend,
        agent_source: config.agentSource,
        agent_id: config.agentId,
        session_id: config.resumeSessionId ?? null,
        session_status: 'idle',
        session_config: serializeSessionConfig(config),
        last_active_at: Date.now(),
        suspended_at: null,
      })
    );

    session.start();
  }

  async closeConversation(convId: string): Promise<void> {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    const session = entry.session as AcpSession;
    await session.stop();
    this.sessions.delete(convId);
    this.writeSessionRow('delete', (repo) => repo.deleteSession(convId));
  }

  async sendMessage(convId: string, text: string, files?: string[]): Promise<void> {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    const session = entry.session as AcpSession;
    entry.lastActiveAt = Date.now();
    this.writeSessionRow('touchLastActive', (repo) => repo.touchLastActive(convId));
    await session.sendMessage(text, files);
  }

  confirmPermission(convId: string, callId: string, optionId: string): void {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    (entry.session as AcpSession).confirmPermission(callId, optionId);
  }

  cancelPrompt(convId: string): void {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    (entry.session as AcpSession).cancelPrompt();
  }

  cancelAll(convId: string): void {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    (entry.session as AcpSession).cancelAll();
  }

  setModel(convId: string, modelId: string): void {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    (entry.session as AcpSession).setModel(modelId);
  }

  setMode(convId: string, modeId: string): void {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    (entry.session as AcpSession).setMode(modeId);
  }

  setConfigOption(convId: string, id: string, value: string | boolean): void {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    (entry.session as AcpSession).setConfigOption(id, value);
  }

  getConfigOptions(convId: string): ConfigOption[] | null {
    const entry = this.sessions.get(convId);
    if (!entry) return null;
    return (entry.session as AcpSession).getConfigOptions();
  }

  retryAuth(convId: string, credentials?: Record<string, string>): void {
    const entry = this.sessions.get(convId);
    if (!entry) return;
    (entry.session as AcpSession).retryAuth(credentials);
  }

  getSessionStatus(convId: string): SessionStatus | null {
    const entry = this.sessions.get(convId);
    if (!entry) return null;
    return (entry.session as AcpSession).status;
  }

  async shutdown(): Promise<void> {
    this.idleReclaimer.stop();
    const promises: Promise<void>[] = [];
    for (const [_, entry] of this.sessions) {
      const session = entry.session as AcpSession;
      if (session.status === 'active' || session.status === 'prompting') {
        promises.push(session.suspend());
      }
    }
    await Promise.allSettled(promises);
    this.sessions.clear();
  }

  private buildCallbacks(convId: string): SessionCallbacks {
    return {
      onMessage: (message) => {
        this.onStreamEvent(convId, message);
      },
      onSessionId: (sessionId) => {
        this.writeSessionRow('updateSessionId', (repo) => repo.updateSessionId(convId, sessionId));
      },
      onStatusChange: (status) => {
        this.persistStatus(convId, status);
        this.onSignalEvent(convId, { type: 'status_change', status });
      },
      onConfigUpdate: (config) => {
        this.writeSessionRow('updateSessionConfig', (repo) => repo.updateSessionConfig(convId, JSON.stringify(config)));
        this.onSignalEvent(convId, { type: 'config_update', config });
      },
      onModelUpdate: (model) => {
        this.onSignalEvent(convId, { type: 'model_update', model });
      },
      onModeUpdate: (mode) => {
        this.onSignalEvent(convId, { type: 'mode_update', mode });
      },
      onContextUsage: (usage) => {
        this.onSignalEvent(convId, { type: 'context_usage', usage });
      },
      onPermissionRequest: (data) => {
        this.onSignalEvent(convId, { type: 'permission_request', data });
      },
      onSignal: (signal) => {
        switch (signal.type) {
          case 'auth_required':
            this.onSignalEvent(convId, { type: 'auth_required', auth: signal.auth });
            break;

          case 'error':
            this.onSignalEvent(convId, {
              type: 'error',
              message: signal.message,
              recoverable: signal.recoverable,
            });
            break;

          case 'session_expired':
            this.onSignalEvent(convId, {
              type: 'error',
              message: 'Session expired',
              recoverable: true,
            });
            break;
        }
      },
    };
  }

  /** Persist status: 7 in-memory states → 4 stable DB states. */
  private persistStatus(convId: string, status: SessionStatus): void {
    const stableStatus = this.toStableStatus(status);
    const suspendedAt = status === 'suspended' ? Date.now() : null;
    this.writeSessionRow('updateStatus', (repo) => repo.updateStatus(convId, stableStatus, suspendedAt));
  }

  private toStableStatus(status: SessionStatus): 'idle' | 'active' | 'suspended' | 'error' {
    switch (status) {
      case 'idle':
        return 'idle';
      case 'starting':
      case 'active':
      case 'prompting':
      case 'resuming':
        return 'active';
      case 'suspended':
        return 'suspended';
      case 'error':
        return 'error';
    }
  }
}
