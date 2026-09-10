# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Driver and Initialization

The database layer uses `ISqliteDriver` with a `better-sqlite3` implementation. `AionUIDatabase.create(dbPath)` ensures the directory, opens the driver, initializes schema, runs migrations, and creates a system user. It distinguishes native module load errors from real SQLite corruption so a healthy DB is not replaced because of an Electron ABI problem.

```ts
static async create(dbPath: string): Promise<AionUIDatabase> {
  const dir = path.dirname(dbPath);
  ensureDirectory(dir);
  let failedDriver: ISqliteDriver | null = null;
  try {
    const driver = await createDriver(dbPath);
    failedDriver = driver;
    const instance = new AionUIDatabase(driver);
    instance.initialize();
    return instance;
  } catch (error) {
    if (failedDriver) failedDriver.close();
    const msg = error instanceof Error ? error.message : String(error);
    if (isNativeModuleLoadError(msg)) throw error;
    if (!isDatabaseCorruptionError(msg)) throw error;
  }
  // corruption recovery backs up db and deletes stale -wal/-shm files
}
```

## Pragmas

```ts
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('journal_mode = WAL');
```

## Core Schema

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_path TEXT,
  jwt_secret TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login INTEGER
);

CREATE TABLE IF NOT EXISTS conversations (
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
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  msg_id TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  position TEXT CHECK(position IN ('left', 'right', 'center', 'pop')),
  status TEXT CHECK(status IN ('finish', 'pending', 'error', 'work')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

Team schema:

```sql
CREATE TABLE IF NOT EXISTS teams (
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
);

CREATE TABLE IF NOT EXISTS mailbox (
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
);
```

Important indexes include `idx_conversations_user_updated`, `idx_messages_conversation_created`, `idx_mailbox_to`, and `idx_tasks_team`. `CURRENT_DB_VERSION = 26` must be kept in sync with migrations.

## Areas for Review

- Should JSON text fields such as `extra`, `agents`, `blocked_by`, and `metadata` be validated with schemas at repository boundaries?
- Should message search use SQLite FTS5 instead of ad hoc preview extraction and LIKE scans?
- Are migration tests complete for every historical DB version?
