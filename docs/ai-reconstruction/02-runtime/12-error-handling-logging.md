# 12 - Error Handling & Logging

## Logging layers

| Layer                | Mechanism                                                | Purpose                                                              |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| Main process startup | `console.log/warn/error`, `electron-log`, Sentry         | Startup diagnostics, environment, crashes.                           |
| Renderer             | browser console, Sentry renderer init, bridge log stream | UI errors and main log mirroring.                                    |
| WebUI server         | Express request logging middleware                       | API request/response timing.                                         |
| Database             | console diagnostics and guarded recovery                 | Initialization, migrations, corruption/native-module discrimination. |
| Agent runtime        | stderr ring buffer, lifecycle snapshots, error classes   | ACP/CLI startup, disconnect, prompt failure analysis.                |

## Global error handling

Source: `src/index.ts:139`

```typescript
  app.quit();
}

// ============ Custom Asset Protocol ============
// Register aion-asset:// as a privileged scheme BEFORE app.whenReady().
// This protocol serves local extension assets (icons, covers) bypassing
// the browser security policy that blocks file:// URLs from http://localhost.
protocol.registerSchemesAsPrivileged([
  {
```

Sentry captures uncaught exceptions/unhandled rejections; handlers prevent Electron default error dialogs from taking over UX.

## Request logging

Source: `src/process/webserver/auth/middleware/AuthMiddleware.ts:68`

```typescript
    // 内容安全策略（开发环境放宽限制以支持 webpack-dev-server）
    // Content Security Policy (relaxed in development for webpack-dev-server)
    const isDevelopment = process.env.NODE_ENV === 'development';
    const cspPolicy = isDevelopment ? SECURITY_CONFIG.HEADERS.CSP_DEV : SECURITY_CONFIG.HEADERS.CSP_PROD;

    res.header('Content-Security-Policy', cspPolicy);

    next();
  }

  /**
   * 请求日志中间件
   * Request logging middleware
   */
  public static requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Only log API requests; skip Vite module / static asset requests to reduce noise
    const url = req.url;
    if (!url.startsWith('/api/') && !url.startsWith('/login')) {
      next();
      return;
    }

    const start = Date.now();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
```

Only `/api/` and `/login` requests are logged to reduce noise from Vite/static assets. Logs include ISO timestamp, method, URL, IP, status code, and duration.

## Express error handling

`src/process/webserver/setup.ts` registers JSON/body parsers, cookies, CSRF, security headers, request logging, and final `errorHandler`. Route handlers wrap async errors with `next(error)` where needed.

## Database error classification

Source: `src/process/services/database/index.ts:39`

```typescript
import {
  encryptCredentials,
  decryptCredentials,
  encryptString,
  decryptString,
} from '@process/channels/utils/credentialCrypto';

type IConversationMessageSearchRow = IConversationRow & {
  message_id: string;
  message_type: TMessage['type'];
  message_content: string;
  message_created_at: number;
};

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`);

const NATIVE_MODULE_LOAD_ERROR_PATTERNS = ['NODE_MODULE_VERSION', 'was compiled against', 'dlopen'];

const DATABASE_CORRUPTION_PATTERNS = [
  'SQLITE_CORRUPT',
  'SQLITE_NOTADB',
  'database disk image is malformed',
  'file is not a database',
  'malformed database schema',
  'unsupported file format',
];

const isNativeModuleLoadError = (message: string): boolean => {
  return NATIVE_MODULE_LOAD_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

const isDatabaseCorruptionError = (message: string): boolean => {
  const normalizedMessage = message.toLowerCase();
  return DATABASE_CORRUPTION_PATTERNS.some((pattern) => normalizedMessage.includes(pattern.toLowerCase()));
};

const extractSearchPreviewText = (rawContent: string): string => {
  const collectStrings = (value: unknown, bucket: string[]): void => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) {
```

Native module load errors such as `NODE_MODULE_VERSION`, `was compiled against`, or `dlopen` are not treated as corruption. Corruption signals such as `SQLITE_CORRUPT`, `SQLITE_NOTADB`, `database disk image is malformed`, and `file is not a database` trigger backup/recreate.

## Bridge payload guard

Source: `src/common/adapter/main.ts:36`

```typescript
/** Maximum IPC payload size (50 MB). Messages exceeding this are dropped with an error notification. */
const MAX_IPC_PAYLOAD_SIZE = 50 * 1024 * 1024;

bridge.adapter({
  emit(name, data) {
    // Notify pet (if hook is set)
    if (petNotifyHook) {
      try {
        petNotifyHook(name, data);
      } catch {
        /* never crash */
      }
    }

    // 1. Send to all Electron BrowserWindows (skip destroyed ones)
    let serialized: string;
    try {
      serialized = JSON.stringify({ name, data });
    } catch (error) {
      // RangeError: Invalid string length — data too large to serialize
      console.error('[adapter] Failed to serialize bridge event:', name, error);
      return;
    }

    // Guard: reject oversized payloads to prevent main-process blocking
    if (serialized.length > MAX_IPC_PAYLOAD_SIZE) {
      console.error(
        `[adapter] Bridge event "${name}" too large (${(serialized.length / 1024 / 1024).toFixed(1)}MB), skipped`
      );
      const errorPayload = JSON.stringify({
        name: 'bridge:error',
        data: { originalEvent: name, reason: 'payload_too_large', size: serialized.length },
      });
      for (let i = adapterWindowList.length - 1; i >= 0; i--) {
        const win = adapterWindowList[i];
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(ADAPTER_BRIDGE_EVENT_KEY, errorPayload);
        }
      }
      return;
    }

    for (let i = adapterWindowList.length - 1; i >= 0; i--) {
      const win = adapterWindowList[i];
      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        adapterWindowList.splice(i, 1);
        continue;
```

Main-to-renderer bridge events are JSON serialized and capped at 50 MB. Oversized events are skipped and a `bridge:error` event is emitted to live windows. This protects the main process from blocking on massive IPC payloads.

## WebSocket error behavior

- Browser adapter queues messages until socket is open.
- Reconnect delay starts at 500 ms and caps at 8000 ms.
- `auth-expired` and close code 1008 stop reconnection and redirect to login.
- Malformed JSON messages are ignored.

## ACP lifecycle errors

`ProcessAcpClient` captures stderr from spawn time, observes exit/close/stdout close/connection abort, races initialize against startup failure, wraps every SDK request, and normalizes startup failures.

## User-facing error examples

- Login returns `Invalid username or password` for missing and wrong users.
- Upload returns `Workspace mismatch`, `Conversation workspace not found`, or `Invalid file name`.
- STT returns `Audio file too large (max 30MB)`.
- Extension API returns `Failed to load extension API route` or `Invalid extension API route handler`.

## Areas for Review

- Should logs use structured JSON with correlation IDs across HTTP, bridge, and agent events?
- Should Sentry be gated by explicit user opt-in for privacy?
- Should bridge oversize errors include remediation guidance in the renderer UI?
