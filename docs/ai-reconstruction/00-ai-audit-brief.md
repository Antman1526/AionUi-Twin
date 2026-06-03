# AionUi Twin AI Audit Brief

## Page 1 - Project Overview

AionUi Twin is an Electron desktop app with a standalone WebUI mode that presents CLI and API-based AI agents as a modern chat/workspace interface. Its core user workflows are: configure a model or agent, create a conversation bound to a workspace, stream agent output and tool calls, confirm or auto-approve actions, persist conversation history, schedule future prompts, collaborate with team agents, and interact through remote channels such as Telegram, Lark, DingTalk, Weixin, and WeCom. The app is not just a model chat UI; it is a process manager, bridge layer, SQLite state store, extension host, and packaged desktop product.

Architecture is split into Electron main (`src/process`), preload (`src/preload`), renderer (`src/renderer`), shared common code (`src/common`), and fork workers (`src/process/worker`). The main process owns SQLite, child processes, Express/WebSocket WebUI, extension loading, updates, channels, cron jobs, and window/tray behavior. The renderer owns React UI state and talks through typed bridge providers. The same bridge event names are used over Electron IPC and browser WebSocket, which is the key design decision enabling desktop and WebUI modes to share UI code.

Representative bridge pattern:

Source: `src/common/adapter/ipcBridge.ts:24`

```typescript
import type { SpeechToTextRequest, SpeechToTextResult } from '../types/speech';

export const shell = {
  openFile: bridge.buildProvider<void, string>('open-file'), // 使用系统默认程序打开文件
  showItemInFolder: bridge.buildProvider<void, string>('show-item-in-folder'), // 打开文件夹
  openExternal: bridge.buildProvider<void, string>('open-external'), // 使用系统默认程序打开外部链接
  checkToolInstalled: bridge.buildProvider<boolean, { tool: string }>('shell.check-tool-installed'), // 检查工具是否安装
  openFolderWith: bridge.buildProvider<void, { folderPath: string; tool: 'vscode' | 'terminal' | 'explorer' }>(
    'shell.open-folder-with'
  ), // 使用指定工具打开文件夹
};

//通用会话能力
export const conversation = {
  create: bridge.buildProvider<TChatConversation, ICreateConversationParams>('create-conversation'), // 创建对话
  createWithConversation: bridge.buildProvider<
    TChatConversation,
    { conversation: TChatConversation; sourceConversationId?: string; migrateCron?: boolean }
  >('create-conversation-with-conversation'), // Create new conversation from history (supports migration) / 通过历史会话创建新对话（支持迁移）
  get: bridge.buildProvider<TChatConversation, { id: string }>('get-conversation'), // 获取对话信息
  getAssociateConversation: bridge.buildProvider<TChatConversation[], { conversation_id: string }>(
    'get-associated-conversation'
  ),
  listByCronJob: bridge.buildProvider<TChatConversation[], { cronJobId: string }>('conversation.list-by-cron-job'), // 获取关联对话
  remove: bridge.buildProvider<boolean, { id: string }>('remove-conversation'), // 删除对话
  update: bridge.buildProvider<boolean, { id: string; updates: Partial<TChatConversation>; mergeExtra?: boolean }>(
    'update-conversation'
  ), // 更新对话信息
  reset: bridge.buildProvider<void, IResetConversationParams>('reset-conversation'), // 重置对话
  warmup: bridge.buildProvider<void, { conversation_id: string }>('conversation.warmup'), // 预热对话 bootstrap
  stop: bridge.buildProvider<IBridgeResponse<{}>, { conversation_id: string }>('chat.stop.stream'), // 停止会话
  sendMessage: bridge.buildProvider<IBridgeResponse<{}>, ISendMessageParams>('chat.send.message'), // 发送消息（统一接口）
  getSlashCommands: bridge.buildProvider<
    IBridgeResponse<{ commands: SlashCommandItem[] }>,
    { conversation_id: string }
  >('conversation.get-slash-commands'),
  askSideQuestion: bridge.buildProvider<
    IBridgeResponse<ConversationSideQuestionResult>,
    { conversation_id: string; question: string }
  >('conversation.ask-side-question'),
```

This pattern makes renderer code ergonomic but creates a large implicit API surface. Any future refactor should treat bridge names as public contracts and add contract tests or generated schemas.

## Page 2 - Key Code Walkthrough

Startup flows through `src/index.ts` into `initializeProcess()`, then `initBridge.ts`. Storage is initialized before extensions/channels, and repositories/services are injected into bridge initializers.

Source: `src/process/utils/initBridge.ts:18`

```typescript
const repo = new SqliteConversationRepository();
const conversationServiceImpl = new ConversationServiceImpl(repo);
const channelRepo = new SqliteChannelRepository();
const teamRepo = new SqliteTeamRepository();
const teamSessionService = new TeamSessionService(teamRepo, workerTaskManager, conversationServiceImpl);

// 初始化所有IPC桥接
initAllBridges({
  conversationService: conversationServiceImpl,
  conversationRepo: repo,
  workerTaskManager,
  channelRepo,
  teamSessionService,
});

// Initialize cron service (load jobs from database and start timers)
void cronService.init().catch((error) => {
  console.error('[initBridge] Failed to initialize CronService:', error);
});

// Start in-process Aion MCP server for team-guide tools (aion_create_team)
void initTeamGuideService(teamSessionService).catch((error) => {
  console.error('[initBridge] Failed to initialize TeamGuideMcpServer:', error);
});
```

Conversation runtime is managed by `WorkerTaskManager`, which caches agent managers per conversation and kills idle finished CLI agents.

Source: `src/process/task/WorkerTaskManager.ts:33`

```typescript
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
```

ACP sessions use a strict state machine and component composition: config tracking, message translation, input preprocessing, permission resolution, session lifecycle, and prompt execution.

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

The local LLM implementation is intentionally small and centralized. Loopback endpoints get a non-secret placeholder key because the OpenAI SDK requires a non-empty key. Cloud providers still require user credentials.

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

## Page 3 - Data Flow, Pain Points, Trade-offs

Data flow for a chat turn: renderer calls `ipcBridge.conversation.sendMessage.invoke`; the main conversation bridge loads or creates an agent manager via `WorkerTaskManager`; the manager talks to a fork worker or ACP process; streamed events are translated to `TMessage` records; messages are emitted over the bridge and persisted to SQLite. WebUI mode replaces Electron IPC transport with WebSocket but retains provider names and message payloads.

SQLite is simple and local-first. The trade-off is that many variable fields are JSON text, especially `conversations.extra`, `messages.content`, model config, and team/cron metadata. This keeps migrations flexible but makes indexing and validation inconsistent. Migration count is already 26, and FTS was removed/skipped, so large-history search may become a bottleneck.

Known limitations and suspected improvement areas: ACP session persistence exists but writes are disabled because `agent_id` semantics are wrong; YOLO mode auto-confirms the first option; token blacklist is memory-only; extension web routes dynamically require files from extension directories; several full-suite tests are flaky/time-sensitive; packaging can be affected by stale ignored `out/` resources; native module ABI mismatches are a known failure mode.

Design trade-offs: the app prioritizes one shared UI across desktop and WebUI, fast local iteration with Bun/electron-vite, and flexible extension/provider support. The cost is broad bridge coupling, significant main-process responsibilities, and a mixture of durable SQLite state with in-memory runtime state for agents, confirmations, token blacklist, and sessions.

## Areas for Review

- Should bridge providers be generated from a schema so IPC/WebSocket contracts are validated at runtime?
- Should `conversations.extra` be split into typed per-agent tables or generated columns for indexed fields?
- Should YOLO mode move from first-option auto-confirm to explicit tool/action policies?
- Should ACP session persistence be completed now or removed until ACP Discovery is ready?
- Should extension API routes run in isolated workers instead of main-process dynamic require?
- Should token blacklist and confirmation state be persisted for restart-safe semantics?
- Should local LLM provider support include health checks for Ollama/LM Studio before saving settings?
