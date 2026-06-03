# 03 - Database Schema & Data Models

## Database engine

AionUi uses SQLite with a driver abstraction. Electron/Node uses `better-sqlite3`; Bun uses `bun:sqlite`. Schema initialization enables foreign keys, a 5000 ms busy timeout, and WAL journaling.

Source: `src/process/services/database/schema.ts:20`

```typescript
  try {
    db.pragma('journal_mode = WAL');
  } catch (error) {
    console.warn('[Database] Failed to enable WAL mode, using default journal mode:', error);
    // Continue with default journal mode if WAL fails
  }

  // Users table (账户系统)
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_path TEXT,
    jwt_secret TEXT,
    created_at INTEGER NOT NULL,
```

## Current version

`CURRENT_DB_VERSION = 26`. Migrations are stored in `src/process/services/database/migrations.ts` and tracked with SQLite `PRAGMA user_version`.

## Core tables from initial schema

Source: `src/process/services/database/schema.ts:28`

```typescript
db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_path TEXT,
    jwt_secret TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login INTEGER
  )`);
db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

// Conversations table (会话表 - 存储TChatConversation)
db.exec(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    extra TEXT NOT NULL,
    model TEXT,
    status TEXT CHECK(status IN ('pending', 'running', 'finished')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type)');
db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC)');

// Messages table (消息表 - 存储TMessage)
db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    msg_id TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    position TEXT CHECK(position IN ('left', 'right', 'center', 'pop')),
    status TEXT CHECK(status IN ('finish', 'pending', 'error', 'work')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`);
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type)');
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_msg_id ON messages(msg_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)');

// Teams table (团队模式)
db.exec(`CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    workspace TEXT NOT NULL,
    workspace_mode TEXT NOT NULL DEFAULT 'shared',
    lead_agent_id TEXT NOT NULL DEFAULT '',
    agents TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
db.exec('CREATE INDEX IF NOT EXISTS idx_teams_user_id ON teams(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_teams_updated_at ON teams(updated_at)');

// Mailbox table (团队消息邮箱)
db.exec(`CREATE TABLE IF NOT EXISTS mailbox (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    from_agent_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'message',
    content TEXT NOT NULL,
    summary TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  )`);
db.exec('CREATE INDEX IF NOT EXISTS idx_mailbox_to ON mailbox(team_id, to_agent_id, read)');

// Team tasks table (团队任务)
db.exec(`CREATE TABLE IF NOT EXISTS team_tasks (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    owner TEXT,
    blocked_by TEXT NOT NULL DEFAULT '[]',
    blocks TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  )`);
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_team ON team_tasks(team_id, status)');
```

### Table summary

| Table           | Purpose                                 | Key fields and relationships                                                                                      |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `users`         | WebUI/auth user records and system user | `id` primary key, unique `username`, optional `email`, bcrypt `password_hash`, per-user `jwt_secret`.             |
| `conversations` | Chat/task session metadata              | Belongs to `users`, stores `type`, serialized `extra`, serialized model, status, timestamps.                      |
| `messages`      | Persisted chat/tool/status messages     | Belongs to `conversations`; stores `type`, JSON `content`, UI `position`, `status`, `hidden` after migration v22. |
| `teams`         | Team/multi-agent session definitions    | Belongs to users, stores workspace, mode, lead agent, and JSON agents.                                            |
| `mailbox`       | Team inter-agent messages               | Belongs to team; stores sender/recipient, type, content, read flag, optional files after v25.                     |
| `team_tasks`    | Team task DAG/status data               | Belongs to team; JSON arrays for dependencies and metadata.                                                       |

## Major migration additions

| Version | Change                                                                                                                    |
| ------: | ------------------------------------------------------------------------------------------------------------------------- |
|       6 | Adds `jwt_secret` to users.                                                                                               |
|       7 | Adds assistant plugin, user, session, and pairing-code tables.                                                            |
|    8-15 | Expands conversation source/channel support and assistant plugin constraints for Telegram, Lark, DingTalk, Weixin, WeCom. |
|       9 | Adds `cron_jobs` with schedule, target, runtime state, retry counters.                                                    |
|   16-18 | Adds `remote_agents` and device identity/security fields.                                                                 |
|   19-20 | Adds team, mailbox, and team task tables and lead agent ID.                                                               |
|   21-22 | Adds `channel_chat_id`, cron job indexing, cron execution mode/agent config, and hidden messages.                         |
|      23 | Adds `teams.session_mode`.                                                                                                |
|      24 | Adds `cron_jobs.description`.                                                                                             |
|      25 | Adds `mailbox.files`.                                                                                                     |
|      26 | Adds `acp_session` table and session-status indexes.                                                                      |

Source: `src/process/services/database/migrations.ts:1185`

```typescript
const migration_v26: IMigration = {
  version: 26,
  name: 'Add acp_session table',
  up: (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS acp_session (
      conversation_id TEXT PRIMARY KEY,
      agent_backend TEXT NOT NULL,
      agent_source TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT,
      session_status TEXT NOT NULL DEFAULT 'idle',
      session_config TEXT NOT NULL DEFAULT '{}',
      last_active_at INTEGER,
      suspended_at INTEGER
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_acp_session_status ON acp_session(session_status)');
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_acp_session_suspended ON acp_session(session_status, suspended_at) WHERE session_status = 'suspended'"
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_acp_session_agent_id ON acp_session(agent_id)');
    console.log('[Migration v26] Added acp_session table');
```

## Data model conversion rules

- Conversation `extra`, `model`, and message `content` are serialized JSON at the table boundary.
- Timestamps are milliseconds since epoch except SQLite default expressions in some migrations also use ms.
- Conversation source supports `aionui`, channel names such as `telegram`, `lark`, `dingtalk`, `weixin`, `wecom`, and extension strings.
- Message content type is discriminated by `type`; renderer must handle `text`, `tips`, `tool_group`, `agent_status`, `acp_permission`, `codex_permission`, `plan`, `thinking`, `skill_suggest`, and cron triggers.

Source: `src/common/chat/chatLib.ts:31`

```typescript
 * 安全的路径拼接函数，兼容Windows和Mac
 * @param basePath 基础路径
 * @param relativePath 相对路径
 * @returns 拼接后的绝对路径
 */
export const joinPath = (basePath: string, relativePath: string): string => {
  // 标准化路径分隔符为 /
  const normalizePath = (path: string) => path.replace(/\\/g, '/');

  const base = normalizePath(basePath);
  const relative = normalizePath(relativePath);

  // 去掉base路径末尾的斜杠
  const cleanBase = base.replace(/\/+$/, '');

  // 处理相对路径中的 ./ 和 ../
  const parts = relative.split('/');
  const resultParts = [];

  for (const part of parts) {
    if (part === '.' || part === '') {
      continue; // 跳过 . 和空字符串
    } else if (part === '..') {
      // 处理上级目录
      if (resultParts.length > 0) {
        resultParts.pop(); // 移除最后一个部分
      }
    } else {
      resultParts.push(part);
    }
  }

  // 拼接路径
  const result = cleanBase + '/' + resultParts.join('/');

  // 确保路径格式正确
  return result.replace(/\/+/g, '/'); // 将多个连续的斜杠替换为单个
};

/**
 * @description 跟对话相关的消息类型申明 及相关处理
 */

type TMessageType =
  | 'text'
  | 'tips'
  | 'tool_call'
  | 'tool_group'
  | 'agent_status'
  | 'acp_permission'
  | 'acp_tool_call'
  | 'codex_permission'
  | 'codex_tool_call'
  | 'plan'
  | 'thinking'
  | 'available_commands'
  | 'skill_suggest'
  | 'cron_trigger';

interface IMessage<T extends TMessageType, Content extends Record<string, any>> {
  /**
   * 唯一ID
   */
  id: string;
  /**
   * 消息来源ID，
   */
  msg_id?: string;

  //消息会话ID
```

## Corruption recovery

Database creation distinguishes native module load failures from corruption. Only clear corruption signals trigger backup/recreate; stale WAL sidecars are removed to avoid recovery loops.

Source: `src/process/services/database/index.ts:81`

```typescript
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectStrings(item, bucket));
      return;
    }

    if (value && typeof value === 'object') {
      Object.values(value).forEach((item) => collectStrings(item, bucket));
    }
  };

  try {
    const parsed = JSON.parse(rawContent);
    const bucket: string[] = [];
    collectStrings(parsed, bucket);
    const previewText = bucket.join(' ').replace(/\s+/g, ' ').trim();
    return previewText || rawContent;
  } catch {
    return rawContent.replace(/\s+/g, ' ').trim();
  }
};

/**
 * Main database class for AionUi
 * Uses a pluggable ISqliteDriver for SQLite operations
 */
export class AionUIDatabase {
  private db: ISqliteDriver;
  private readonly defaultUserId = 'system_default_user';
  private readonly systemPasswordPlaceholder = '';

  private constructor(db: ISqliteDriver) {
    this.db = db;
  }

  /**
   * Create a new AionUIDatabase instance with corruption recovery.
   * This is the only way to obtain an instance — the constructor is private.
   */
  static async create(dbPath: string): Promise<AionUIDatabase> {
    const dir = path.dirname(dbPath);
    ensureDirectory(dir);

    // Attempt normal initialization
    let failedDriver: ISqliteDriver | null = null;
    try {
      const driver = await createDriver(dbPath);
      failedDriver = driver;
      const instance = new AionUIDatabase(driver);
      instance.initialize();
      return instance;
    } catch (error) {
      // Close the driver opened during the failed attempt.
      // On Windows, leaving it open locks the file and prevents recovery (EPERM).
      if (failedDriver) {
        try {
          failedDriver.close();
        } catch {
          // ignore close errors during recovery
        }
        failedDriver = null;
      }

      // Distinguish driver-level errors (native module mismatch, missing .node file)
      // from actual database corruption. Driver errors must NOT trigger recovery —
      // replacing a healthy database because of a build tooling issue causes data loss.
      const msg = error instanceof Error ? error.message : String(error);
      if (isNativeModuleLoadError(msg)) {
        console.error(
          '[Database] Native module load error — will NOT attempt recovery (database is likely intact):',
          msg
        );
        throw error;
      }
```

## Repository contract example

Source: `src/process/services/database/SqliteConversationRepository.ts:1`

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@process/services/database';
import type { IConversationRepository, PaginatedResult } from './IConversationRepository';
import type { TChatConversation } from '@/common/config/storage';
import type { TMessage } from '@/common/chat/chatLib';
import type { IMessageSearchResponse } from '@/common/types/database';

/**
 * SQLite-backed implementation of IConversationRepository.
 * Delegates to the AionUIDatabase singleton via getDatabase().
 * Methods are async because getDatabase() returns a Promise.
 */
export class SqliteConversationRepository implements IConversationRepository {
  private getDb() {
    return getDatabase();
  }

  async getConversation(id: string): Promise<TChatConversation | undefined> {
    const db = await this.getDb();
    const result = db.getConversation(id);
    return result.success ? (result.data ?? undefined) : undefined;
  }

  async createConversation(conversation: TChatConversation): Promise<void> {
    const db = await this.getDb();
    db.createConversation(conversation);
  }

  async updateConversation(id: string, updates: Partial<TChatConversation>): Promise<void> {
    const db = await this.getDb();
    db.updateConversation(id, updates);
  }

  async deleteConversation(id: string): Promise<void> {
    const db = await this.getDb();
    db.deleteConversation(id);
  }

  async getMessages(
    id: string,
    page: number,
    pageSize: number,
    order?: 'ASC' | 'DESC'
  ): Promise<PaginatedResult<TMessage>> {
    const db = await this.getDb();
    const result = db.getConversationMessages(id, page, pageSize, order);
    return {
      data: result.data ?? [],
      total: result.total ?? 0,
      hasMore: result.hasMore ?? false,
    };
  }

  async insertMessage(message: TMessage): Promise<void> {
    const db = await this.getDb();
    db.insertMessage(message);
  }

  /**
   * The underlying DB getUserConversations accepts (userId?, page, pageSize).
   * The interface accepts (cursor?, offset?, limit?) for forward compatibility.
   * We map offset/limit → page/pageSize, ignoring cursor (not supported by SQLite impl).
   */
  async getUserConversations(
    _cursor?: string,
    offset?: number,
    limit?: number
  ): Promise<PaginatedResult<TChatConversation>> {
    const db = await this.getDb();
    const pageSize = limit ?? 50;
    const page = offset !== undefined && pageSize > 0 ? Math.floor(offset / pageSize) : 0;
    const result = db.getUserConversations(undefined, page, pageSize);
    return {
      data: result.data ?? [],
      total: result.total ?? 0,
      hasMore: result.hasMore ?? false,
    };
  }

  async listAllConversations(): Promise<TChatConversation[]> {
    const db = await this.getDb();
    const result = db.getUserConversations(undefined, 0, 10000);
    return result.data ?? [];
```

## Reconstruction instructions

1. Implement `ISqliteDriver` with `prepare().get/all/run`, `exec`, `pragma`, `transaction`, and `close`.
2. On database open, create core tables, then run migrations from `user_version + 1` through 26.
3. Insert system user `system_default_user` with blank password placeholder if absent.
4. Store all conversation/message variable payloads as JSON text and validate at repository boundaries.
5. Add indexes exactly as schema/migrations specify; conversation list performance depends on `idx_conversations_user_updated`.

## Areas for Review

- Should JSON columns be partially normalized for query-heavy fields such as pinned state and cron metadata?
- Should migration v26 ACP session persistence be re-enabled only after agent ID semantics are corrected?
- Should full-text search be restored with FTS5 for large message histories?
