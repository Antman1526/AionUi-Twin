# AI Review Page 2: Key Code Walkthrough and Data Flow

Desktop data flow: renderer calls `window.electronAPI.emit(name, data)`, preload serializes `{ name, data }` onto the adapter bridge IPC channel, process bridge handlers call services/repositories/task managers, SQLite persists domain state, and agent managers stream results back through IPC/events.

WebUI data flow: browser/mobile hits Express routes, auth middleware validates JWT cookies, route handlers call the same process services/database, and WebSocket routes handle live updates. Upload routes resolve destination workspace from the conversation record, not from user input.

Representative preload pattern:

```ts
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: any) => ipcRenderer.invoke(ADAPTER_BRIDGE_EVENT_KEY, JSON.stringify({ name, data })),
  on: (callback: any) => {
    const handler = (event: any, value: any) => callback({ event, value });
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
  },
});
```

Representative persistence pattern:

```ts
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('journal_mode = WAL');
```

Representative agent lifecycle pattern:

```ts
const existing = this.getTask(id);
if (existing) return existing;
const conversation = await this.repo.getConversation(id);
if (conversation) return this._buildAndCache(conversation, options);
```

## Areas for Review

- Replace bridge `any` payloads with schema-validated request/response contracts.
- Convert worker task cache from array to Map and add task metrics.
- Add FTS5-backed message search and benchmark against current JSON preview extraction.
