# 07 - Business Logic & Core Algorithms

## Conversation and agent lifecycle

AionUi maps each durable conversation to a runtime agent manager. `WorkerTaskManager` caches managers by conversation ID, kills idle CLI-backed agents, and prevents orphan child processes when replacing cached tasks.

Source: `src/process/task/WorkerTaskManager.ts:14`

```typescript
import { ProcessConfig } from '@process/utils/initStorage';

/** Default idle timeout: 5 minutes. Overridden by user config 'acp.agentIdleTimeout' (in minutes). */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
/** How often to scan for idle CLI-backed agents. */
const AGENT_IDLE_CHECK_INTERVAL_MS = 1 * 60 * 1000;

export class WorkerTaskManager implements IWorkerTaskManager {
  private taskList: Array<{ id: string; task: IAgentManager }> = [];
  private idleCheckTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly factory: IAgentFactory,
    private readonly repo: IConversationRepository
  ) {
    this.idleCheckTimer = setInterval(() => this.killIdleCliAgents(), AGENT_IDLE_CHECK_INTERVAL_MS);
  }

  private async getIdleTimeoutMs(): Promise<number> {
    try {
      const minutes = await ProcessConfig.get('acp.agentIdleTimeout');
      if (minutes && minutes > 0) return minutes * 60 * 1000;
    } catch {
      // Fallback to default
    }
    return DEFAULT_IDLE_TIMEOUT_MS;
  }

  private killIdleCliAgents(): void {
    void this.getIdleTimeoutMs().then((timeoutMs) => {
      const now = Date.now();
      const idleTasks = this.taskList.filter(
        (item) =>
          (item.task.type === 'acp' || item.task.type === 'aionrs') &&
          item.task.status === 'finished' &&
          !cronBusyGuard.isProcessing(item.id) &&
          now - item.task.lastActivityAt > timeoutMs
      );
      for (const item of idleTasks) {
        this.kill(item.id, 'idle_timeout');
      }
    });
  }

  getTask(id: string): IAgentManager | undefined {
    return this.taskList.find((item) => item.id === id)?.task;
  }

  async getOrBuildTask(id: string, options?: BuildConversationOptions): Promise<IAgentManager> {
    if (!options?.skipCache) {
      const existing = this.getTask(id);
      if (existing) return existing;
    }

    const conversation = await this.repo.getConversation(id);
    if (conversation) return this._buildAndCache(conversation, options);

    throw new Error(`Conversation not found: ${id}`);
  }

  private _buildAndCache(conversation: TChatConversation, options?: BuildConversationOptions): IAgentManager {
    const task = this.factory.create(conversation, options);
    this.addTask(conversation.id, task);
    return task;
  }

  addTask(id: string, task: IAgentManager): void {
    const existing = this.taskList.find((item) => item.id === id);
    if (existing) {
      // Kill the old process before replacing to prevent orphaned child processes.
      // Without this, getOrBuildTask(skipCache: true) leaves the old agent running.
      existing.task.kill();
      existing.task = task;
    } else {
      this.taskList.push({ id, task });
    }
```

Algorithm details:

- Idle timeout defaults to 5 minutes and is configurable by `ProcessConfig.get('acp.agentIdleTimeout')` in minutes.
- Idle scanner runs every 1 minute.
- Only `acp` and `aionrs` managers with `status === 'finished'` are reclaimed.
- Cron-busy conversations are exempt via `cronBusyGuard.isProcessing(id)`.
- `skipCache` creates a new manager and kills the old manager before replacement.

## Agent creation

Source: `src/process/task/AgentFactory.ts:1`

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { IAgentFactory, AgentCreator } from './IAgentFactory';
import { UnknownAgentTypeError } from './IAgentFactory';
import type { IAgentManager } from './IAgentManager';
import type { BuildConversationOptions, AgentType } from './agentTypes';

export class AgentFactory implements IAgentFactory {
  private creators = new Map<AgentType, AgentCreator>();

  register(type: AgentType, creator: AgentCreator): void {
    this.creators.set(type, creator);
  }

  create(conversation: TChatConversation, options?: BuildConversationOptions): IAgentManager {
    const creator = this.creators.get(conversation.type as AgentType);
    if (!creator) throw new UnknownAgentTypeError(conversation.type);
    return creator(conversation, options);
  }
}
```

The factory is intentionally minimal: all agent-specific logic lives in registered creator functions. Unknown conversation types throw `UnknownAgentTypeError`.

## Confirmation flow and YOLO mode

Source: `src/process/task/BaseAgentManager.ts:36`

```typescript
   */
  protected yoloMode: boolean = false;

  protected readonly emitter: IAgentEventEmitter;

  constructor(type: AgentType, data: Data, emitter: IAgentEventEmitter, enableFork = true) {
    super(
      path.resolve(__dirname, type + '.js'),
      {
        type: type,
        data: data,
      },
      enableFork
    );
    this.type = type;
    this.emitter = emitter;

    // Set yoloMode from data if present
    if (data && typeof data === 'object' && 'yoloMode' in data) {
      this.yoloMode = !!(data as any).yoloMode;
    }
  }
  protected init(): void {
    super.init();
  }
  protected addConfirmation(data: IConfirmation<ConfirmationOption>) {
    // If yoloMode is active, attempt to auto-confirm instead of adding
    if (this.yoloMode && data.options && data.options.length > 0) {
      // Select the first "allow" option (usually proceed_once or similar)
      // Most agents put the positive confirmation as the first option
      const autoOption = data.options[0];

      // Delay slightly to allow the agent to reach a stable state if needed
      setTimeout(() => {
        void this.confirm(data.id, data.callId, autoOption.value);
      }, 50);
      return;
    }

    const originIndex = this.confirmations.findIndex((p) => p.id === data.id);
    if (originIndex !== -1) {
      this.confirmations = this.confirmations.map((item, i) => (i === originIndex ? { ...item, ...data } : item));
      this.emitter.emitConfirmationUpdate(this.conversation_id, data);
      return;
    }
    this.confirmations = [...this.confirmations, data];
    this.emitter.emitConfirmationAdd(this.conversation_id, data);
  }
  confirm(_msg_id: string, callId: string, _data: ConfirmationOption) {
    // 查找要移除的确认项（根据 callId 匹配）
    // Find the confirmation to remove (match by callId)
    const confirmationToRemove = this.confirmations.find((p) => p.callId === callId);
```

Confirmations are cached in memory per manager and emitted to renderer. In YOLO mode, the first positive option is auto-confirmed after 50 ms. This enables scheduled jobs to run unattended but increases risk for destructive commands.

## ACP session state machine

Source: `src/process/acp/session/AcpSession.ts:31`

```typescript
  approvalCacheMaxSize?: number;
  /** User selections made before session creation (e.g., from the Guid page). */
  initialDesired?: InitialDesiredConfig;
};

const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  idle: ['starting'],
  starting: ['active', 'starting', 'error', 'idle'],
  active: ['prompting', 'suspended', 'idle'],
  prompting: ['active', 'resuming', 'error', 'idle'],
  suspended: ['resuming', 'idle'],
  resuming: ['active', 'resuming', 'error', 'idle'],
  error: ['starting', 'idle'],
};

/**
 * Wrap all SessionCallbacks methods with try/catch to prevent callback
```

Valid statuses: `idle`, `starting`, `active`, `prompting`, `suspended`, `resuming`, `error`. Invalid transitions are logged and ignored, preserving state integrity.

Source: `src/process/acp/session/AcpSession.ts:139`

```typescript
        lifecycle: this.lifecycle,
        messageTranslator: this.messageTranslator,
        authNegotiator: this.lifecycle.authNegotiator,
        callbacks: this.callbacks,
        metrics: this.metrics,
        agentConfig: agentConfig,
        setStatus: (s) => this.setStatus(s),
        enterError: (msg) => this.enterError(msg),
      },
      options?.promptTimeoutMs ?? 300_000
    );
  }

  // ─── State machine ────────────────────────────────────────────

  get status(): SessionStatus {
    return this._status;
  }

  get sessionId(): string | null {
    return this.lifecycle.sessionId;
  }

  setStatus(newStatus: SessionStatus): void {
    const allowed = VALID_TRANSITIONS[this._status];
    if (!allowed.includes(newStatus)) {
      console.warn(`[AcpSession] Invalid status transition: ${this._status} → ${newStatus}`);
      return;
    }
    this._status = newStatus;
    this.callbacks.onStatusChange(newStatus);
  }

  // ─── Public API ───────────────────────────────────────────────

  start(): void {
    if (this._status !== 'idle' && this._status !== 'error') return;
    console.log(`[AcpSession] Starting session with backend ${this.agentConfig.agentBackend}`);
    this.lifecycle.start();
  }

  async stop(): Promise<void> {
```

Sending a message is legal only in `active` or `suspended`. Suspended sessions queue the prompt and resume first.

## ACP runtime session management

Source: `src/process/acp/runtime/AcpRuntime.ts:48`

```typescript
  constructor(
    // TODO(ACP Discovery): Re-enable acp_session persistence.
    // private readonly acpSessionRepo: IAcpSessionRepository,
    private readonly clientFactory: ClientFactory,
    options?: RuntimeOptions
  ) {
    this.idleReclaimer = new IdleReclaimer(
      this.sessions,
      options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    );
    this.idleReclaimer.start();
  }

  async createConversation(convId: string, agentConfig: AgentConfig): Promise<void> {
    if (this.sessions.has(convId)) return;

    // Shallow-clone to avoid mutating the caller's object (e.g., MCP servers would
    // duplicate on retries if we pushed into the original arrays).
    const config = { ...agentConfig };

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

```

Important rules:

- One ACP runtime session per conversation ID.
- Team-guide MCP is injected for solo agents when supported.
- User-configured MCP servers are filtered through cached MCP capability data before injection.
- ACP session persistence exists as schema but writes are intentionally disabled until agent ID semantics are fixed.

## Process ACP client lifecycle

Source: `src/process/acp/infra/ProcessAcpClient.ts:1`

```typescript
// src/process/acp/infra/ProcessAcpClient.ts

/**
 * ProcessAcpClient — Single owner of a local agent subprocess + ACP protocol.
 *
 * Internally manages:
 *   - Child process (via spawnFn callback — allows legacy and direct spawn)
 *   - Stderr ring buffer (8KB, captured from spawn time)
 *   - 4-signal lifecycle detection (exit, close, stdout.close, connection.abort)
 *   - Startup failure watcher (Promise.race: init vs process exit)
 *   - Pending request tracking (runConnectionRequest wraps every SDK call)
 *   - SDK ClientSideConnection
 *   - NdjsonTransport
 *   - Graceful 3-phase shutdown
 *
 * See docs/specs/acp-rewrite/02-reference-implementation.md §6.1-6.2
 */

import type {
  Client,
  ForkSessionResponse,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  SetSessionConfigOptionRequest,
} from '@agentclientprotocol/sdk';
import { ClientSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { AgentDisconnectedError, AgentSpawnError, AgentStartupError } from '@process/acp/errors/AcpError';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CreateSessionParams, ForkSessionParams, LoadSessionParams } from '@process/acp/infra/AcpProtocol';
import type {
  AcpClient,
  AgentDisconnectReason,
  AgentExitInfo,
  AgentLifecycleSnapshot,
  DisconnectInfo,
} from '@process/acp/infra/IAcpClient';
import { NdjsonTransport } from '@process/acp/infra/NdjsonTransport';
import { gracefulShutdown, waitForExit, waitForSpawn } from '@process/acp/infra/processUtils';
import type { PromptContent, ProtocolHandlers } from '@process/acp/types';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';

const STARTUP_STDERR_MAX = 8192;

type PendingRequest = {
  settled: boolean;
  reject: (error: unknown) => void;
};

export type ProcessAcpClientOptions = {
  backend: string;
  handlers: ProtocolHandlers;
  gracePeriodMs?: number;
};

export class ProcessAcpClient implements AcpClient {
  private child: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private _connProxy: ClientSideConnection | null = null;
  private closing = false;

  // Stderr ring buffer
  private stderrBuffer = '';

  // Lifecycle state (first-write-wins)
  private _lastExit: AgentExitInfo | null = null;
  private disconnectHandler: ((info: DisconnectInfo) => void) | null = null;
  private hasActivePrompt = false;

  // Pending request tracking
  private readonly pendingRequests = new Set<PendingRequest>();

  constructor(
    private readonly spawnFn: () => Promise<ChildProcess>,
    private readonly options: ProcessAcpClientOptions
```

`ProcessAcpClient` owns child process spawn, NDJSON transport, stderr ring buffer, startup failure race, request wrapping, disconnect detection, and graceful shutdown. It initializes ACP with client name `AionUi`, version `2.0.0`, current `PROTOCOL_VERSION`, and file-system read/write capabilities.

## Cron scheduling

Source: `src/process/services/cron/CronService.ts:34`

```typescript
  conversationTitle?: string;
  agentType: import('@/common/types/acpTypes').AgentBackend;
  createdBy: 'user' | 'agent';
  executionMode?: 'existing' | 'new_conversation';
  agentConfig?: import('./CronStore').CronJob['metadata']['agentConfig'];
};

/**
 * CronService - Core scheduling service for AionUI
 *
 * Manages scheduled tasks that send messages to conversations at specified times.
 * Handles conflicts when conversation is busy.
 */
export class CronService {
  private timers: Map<string, Cron | NodeJS.Timeout> = new Map();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  private retryCounts: Map<string, number> = new Map();
  private initialized = false;
  private powerSaveBlockerId: number | null = null;

  constructor(
    private readonly repo: ICronRepository,
    private readonly emitter: ICronEventEmitter,
    private readonly executor: ICronJobExecutor,
    private readonly conversationRepo: IConversationRepository
  ) {}

  /**
   * Initialize the cron service
   * Load all enabled jobs from database and start their timers
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.cleanupOrphanJobs();
      await this.backfillCronJobIdOnConversations();

      const jobs = await this.repo.listEnabled();

      for (const job of jobs) {
        await this.startTimer(job);
      }

      this.initialized = true;
      await this.updatePowerBlocker();
    } catch (error) {
      console.error('[CronService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Remove cron jobs whose associated conversation no longer exists.
```

Cron jobs are loaded from SQLite on startup, orphan jobs are cleaned, existing conversations get cron metadata backfilled, and timers are started for enabled jobs. One existing-mode job per conversation is enforced.

Source: `src/process/services/cron/CronService.ts:170`

```typescript
    } catch (error) {
      console.warn('[CronService] Failed to backfill cron job data:', error);
    }
  }

  /**
   * Build ICronAgentConfig from conversation extra fields.
   */
  private buildAgentConfigFromConversation(
    conv: TChatConversation,
    job: CronJob
  ): CronJob['metadata']['agentConfig'] | null {
    const extra = (conv.extra ?? {}) as Record<string, unknown>;
    const backend = (extra.backend as string) || job.metadata.agentType;
    if (!backend) return null;

    return {
      backend: backend as import('@/common/types/acpTypes').AcpBackendAll,
      name: (extra.agentName as string) || job.name,
      cliPath: extra.cliPath as string | undefined,
      isPreset: !!extra.presetAssistantId,
      customAgentId: (extra.presetAssistantId as string) || (extra.customAgentId as string) || undefined,
    };
  }

  /**
   * Add a new cron job
   * @throws Error if conversation already has a cron job (one job per conversation limit)
   */
  async addJob(params: CreateCronJobParams): Promise<CronJob> {
    // Check if conversation already has a cron job (one job per conversation limit)
    // Skip for new_conversation mode since each execution creates a new conversation
    if (params.executionMode !== 'new_conversation' && params.conversationId) {
      const existingJobs = await this.repo.listByConversation(params.conversationId);
      if (existingJobs.length > 0) {
        const existingJob = existingJobs[0];
        throw new Error(
          i18n.t('cron:error.alreadyExists', {
            name: existingJob.name,
            id: existingJob.id,
          })
        );
      }
    }

    const now = Date.now();
    const jobId = `cron_${uuid()}`;

    const job: CronJob = {
      id: jobId,
      name: params.name,
      description: params.description?.trim() || undefined,
      enabled: true,
      schedule: params.schedule,
      target: {
        payload: { kind: 'message', text: params.prompt ?? params.message ?? '' },
        executionMode: params.executionMode ?? 'existing',
      },
      metadata: {
        conversationId: params.conversationId,
        conversationTitle: params.conversationTitle,
```

## Local model provider algorithm

Source: `src/common/utils/localModelProviders.ts:7`

```typescript
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

export const LOCAL_OPENAI_COMPATIBLE_API_KEY = 'aionui-local-no-api-key';

/**
 * Local model directories commonly used on Antman's workstations.
 * AionUi connects to local model servers; these paths are retained as
 * discovery hints for launchers and future file-backed model integrations.
 */
export const DEFAULT_LOCAL_MODEL_DIRECTORIES = [
  '/Volumes/MainStore/Development/AI_Models',
  '/Users/Antman/Desktop/AI_Models',
] as const;

export function getFirstApiKey(apiKeys?: string): string {
  return (
    apiKeys
      ?.split(/[,\n]/)
      .map((key) => key.trim())
      .find((key) => key.length > 0) ?? ''
  );
}

export function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;

  try {
    const url = new URL(baseUrl);
    return LOCAL_HOSTNAMES.has(url.hostname) || LOCAL_HOSTNAMES.has(url.host);
  } catch {
    return false;
  }
}

export function supportsNoApiKeyForOpenAICompatibleProvider(baseUrl?: string): boolean {
  return isLocalBaseUrl(baseUrl);
}

export function getApiKeyForModelList(apiKeys?: string, baseUrl?: string): string {
  const firstKey = getFirstApiKey(apiKeys);
  if (firstKey) return firstKey;
```

Rules:

- Hostnames `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, and `[::1]` are considered local.
- Empty API key is allowed only for local OpenAI-compatible base URLs.
- Placeholder key `aionui-local-no-api-key` satisfies OpenAI SDK non-empty key requirements without leaking credentials.
- Cloud providers still require real keys.

## Areas for Review

- Should YOLO auto-confirm require per-tool allowlists instead of first-option selection?
- Should ACP runtime persistence be completed or removed until ACP Discovery is ready?
- Should idle reclamation publish telemetry to explain why agents were killed?
