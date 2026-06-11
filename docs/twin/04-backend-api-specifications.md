# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Backend Surfaces

AionUi has two backend surfaces: Electron IPC for the desktop renderer and Express/WebSocket HTTP APIs for WebUI/mobile/remote access. Both eventually use the same process services, database repositories, worker task managers, and configuration storage.

## Electron IPC Contracts

The preload bridge exposes `window.electronAPI`; `src/common/adapter/ipcBridge.ts`
defines domain contracts and `src/process/bridge/*.ts` installs providers.
Important local-model endpoints:

| IPC provider | Input | Output | Notes |
| ------------ | ----- | ------ | ----- |
| `localModel.listModels` | none | `{ roots, models }` | Scans configured/default roots for `.gguf`. |
| `localModel.start` | `{ modelPath, options? }` | runtime status | Validates root, starts `llama-server`, registers provider. |
| `localModel.stop` | none | `{ running: false }` | Kills managed server and removes managed provider. |
| `localModel.getStatus` | none | runtime status | Returns current in-memory process handle only. |
| `localModel.getDirectories` | none | `string[]` | Returns configured roots or defaults. |
| `localModel.setDirectories` | `{ directories }` | `string[]` | Normalizes/persists scan roots. |
| `localModel.getRuntimeOptions` | none | map | Returns per-model options. |
| `localModel.setRuntimeOptions` | `{ modelPath, options }` | normalized options | Clamps numeric values and accepts `reasoning` `off/on`. |

Runtime status shape:

```ts
type LocalModelRuntimeStatus =
  | { running: false }
  | { running: true; modelPath: string; name: string; port: number; baseUrl: string };
```

## WebUI Server

`startWebServerWithInstance(port, allowRemote)` creates Express, an HTTP server, and a WebSocket server in `noServer` mode so Vite HMR can be forwarded during development instead of swallowed by the app WebSocket server.

```ts
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
```

## Auth Endpoints

- `POST /login`: rate-limited; validates username/password; constant-time missing-user path; sets JWT cookie.
- `POST /logout`: authenticated; blacklists token and clears cookie.
- `GET /api/auth/status`: setup/auth status.
- `GET /api/auth/user`: current authenticated user.
- `POST /api/auth/change-password`: current password + strength validation.
- `POST /api/auth/qr-login`: validates short-lived QR token and sets cookie.

Representative login code:

```ts
app.post('/login', authRateLimiter, AuthMiddleware.validateLoginInput, async (req, res) => {
  const { username, password } = req.body;
  const user = await UserRepository.findByUsername(username);
  if (!user) {
    await AuthService.constantTimeVerifyMissingUser();
    res.status(401).json({ success: false, message: 'Invalid username or password' });
    return;
  }
  const isValidPassword = await AuthService.constantTimeVerify(password, user.password_hash, true);
  if (!isValidPassword) {
    res.status(401).json({ success: false, message: 'Invalid username or password' });
    return;
  }
  const token = await AuthService.generateToken(user);
  res.cookie(AUTH_CONFIG.COOKIE.NAME, token, { ...getCookieOptions(req), maxAge: AUTH_CONFIG.TOKEN.COOKIE_MAX_AGE });
  res.json({ success: true, message: 'Login successful', user: { id: user.id, username: user.username }, token });
});
```

## Upload and Extension APIs

`registerApiRoutes` handles file upload, STT upload, directory APIs, WebUI app APIs, Weixin/WeCom routes, extension API routes, and static extension assets. Upload workspaces are resolved from the database conversation and client-supplied workspace paths must match exactly.

```ts
export async function resolveUploadWorkspace(conversationId: string, requestedWorkspace?: string): Promise<string> {
  const db = await getDatabase();
  const result = db.getConversation(conversationId);
  const conversationWorkspace = result.data?.extra?.workspace;
  if (!result.success || !conversationWorkspace) throw new Error('Conversation workspace not found');
  const resolvedConversationWorkspace = path.resolve(conversationWorkspace);
  if (requestedWorkspace && path.resolve(requestedWorkspace) !== resolvedConversationWorkspace) {
    throw new Error('Workspace mismatch');
  }
  return resolvedConversationWorkspace;
}
```

Extension API modules must resolve inside their extension root and export a route handler function or default function. Auth is enabled by default for extension API routes unless explicitly disabled.

## Areas for Review

- Generate OpenAPI/IPC schemas from one source to prevent drift.
- Sandbox extension route handlers rather than loading them with native `require`.
- Add upload quotas and file-content scanning for remote WebUI deployments.
- Add negative IPC tests for malformed local model paths/options and stale provider ids.
