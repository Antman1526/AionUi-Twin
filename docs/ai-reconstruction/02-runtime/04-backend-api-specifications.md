# 04 - Backend API Specifications

## Backend surfaces

AionUi has two backend surfaces:

1. Electron IPC bridge: typed providers/emitter names built in `src/common/adapter/ipcBridge.ts` and handled by `src/process/bridge/*.ts`.
2. WebUI HTTP/WebSocket backend: Express routes under `src/process/webserver/routes`, WebSocket bridge under `src/process/webserver/websocket`, and static SPA serving.

## IPC bridge registration

Source: `src/process/bridge/index.ts:47`

```typescript

export interface BridgeDependencies {
  conversationService: IConversationService;
  conversationRepo: IConversationRepository;
  workerTaskManager: IWorkerTaskManager;
  channelRepo: IChannelRepository;
  teamSessionService: TeamSessionService;
}

/**
 * 初始化所有IPC桥接模块
 */
export function initAllBridges(deps: BridgeDependencies): void {
  initDialogBridge();
  initShellBridge();
  initFsBridge();
  initFileWatchBridge();
  initConversationBridge(deps.conversationService, deps.workerTaskManager, deps.teamSessionService);
  initApplicationBridge(deps.workerTaskManager);
  initGeminiConversationBridge(deps.workerTaskManager);
  // 额外的 Gemini 辅助桥（订阅检测等）需要在对话桥初始化后可用 / extra helpers after core bridges
  initGeminiBridge();
  initBedrockBridge();
  initAcpConversationBridge(deps.workerTaskManager);
  initAuthBridge();
  initModelBridge();
  initMcpBridge();
  initPreviewHistoryBridge();
  initDocumentBridge();
  initPptPreviewBridge();
  initOfficeWatchBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initWebuiBridge();
  initChannelBridge(deps.channelRepo);
  initDatabaseBridge(deps.conversationRepo);
  initExtensionsBridge(deps.conversationRepo, deps.workerTaskManager);
  initCronBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
```

Every bridge module registers one or more provider names. The renderer imports `ipcBridge` from `@/common` and invokes providers. The same event names are transported over Electron IPC or WebSocket.

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
  confirmMessage: bridge.buildProvider<IBridgeResponse, IConfirmMessageParams>('conversation.confirm.message'), // 通用确认消息
  responseStream: bridge.buildEmitter<IResponseMessage>('chat.response.stream'), // 接收消息（统一接口）
  turnCompleted: bridge.buildEmitter<IConversationTurnCompletedEvent>('conversation.turn.completed'),
  listChanged: bridge.buildEmitter<IConversationListChangedEvent>('conversation.list-changed'),
  getWorkspace: bridge.buildProvider<
    IDirOrFile[],
    { conversation_id: string; workspace: string; path: string; search?: string }
  >('conversation.get-workspace'),
  responseSearchWorkSpace: bridge.buildProvider<void, { file: number; dir: number; match?: IDirOrFile }>(
    'conversation.response.search.workspace'
  ),
  reloadContext: bridge.buildProvider<IBridgeResponse, { conversation_id: string }>('conversation.reload-context'),
  setConfig: bridge.buildProvider<
    IBridgeResponse,
    {
      conversation_id: string;
      config: { model?: string; thinking?: string; thinking_budget?: number; effort?: string };
    }
  >('conversation.set-config'),
  confirmation: {
    add: bridge.buildEmitter<IConfirmation<any> & { conversation_id: string }>('confirmation.add'),
    update: bridge.buildEmitter<IConfirmation<any> & { conversation_id: string }>('confirmation.update'),
    confirm: bridge.buildProvider<
      IBridgeResponse,
      { conversation_id: string; msg_id: string; data: any; callId: string }
    >('confirmation.confirm'),
    list: bridge.buildProvider<IConfirmation<any>[], { conversation_id: string }>('confirmation.list'),
    remove: bridge.buildEmitter<{ conversation_id: string; id: string }>('confirmation.remove'),
  },
```

## WebUI server startup

The server creates an Express app, HTTP server, and a WebSocketServer in `noServer` mode so it can route app WebSocket upgrades while forwarding Vite HMR during development.

Source: `src/process/webserver/index.ts:217`

```typescript

  // 显示传统凭证作为备用 / Display traditional credentials as fallback
  console.log('\n🔐 Or Use Initial Admin Credentials / 或使用初始管理员凭证:');
  console.log(`   Username / 用户名: ${credentials.username}`);
  console.log(`   Password / 密码:   ${credentials.password}`);
  console.log('\n⚠️  Please change the password after first login!');
  console.log('⚠️  请在首次登录后修改密码！');

  console.log('='.repeat(70) + '\n');
}

/**
 * WebUI 服务器实例类型
 * WebUI server instance type
 */
export interface WebServerInstance {
  server: import('http').Server;
  wss: import('ws').WebSocketServer;
  port: number;
  allowRemote: boolean;
```

## Auth endpoints

| Method | Path                        | Auth                        | Request                            | Response                                                           |
| ------ | --------------------------- | --------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| POST   | `/login`                    | No                          | `{ username, password }` strings   | `{ success, message, user, token }`, sets `aionui-session` cookie. |
| POST   | `/logout`                   | JWT                         | none                               | Blacklists current token and clears cookie.                        |
| GET    | `/api/auth/status`          | No                          | none                               | `{ success, needsSetup, userCount, isAuthenticated:false }`.       |
| GET    | `/api/auth/user`            | JWT                         | none                               | `{ success, user }`.                                               |
| POST   | `/api/auth/change-password` | JWT                         | `{ currentPassword, newPassword }` | Validates password and rotates credentials.                        |
| POST   | `/api/auth/refresh`         | Token in body/cookie/header | Optional `{ token }`               | `{ success, token }`, may reset cookie.                            |
| GET    | `/api/ws-token`             | JWT                         | none                               | Returns current token as `wsToken` for compatibility.              |
| POST   | `/api/auth/qr-login`        | QR token                    | `{ qrToken }`                      | Verifies QR token, sets cookie, returns session token.             |
| GET    | `/qr-login`                 | No                          | URL token consumed by page JS      | Static QR login HTML.                                              |

Source: `src/process/webserver/routes/authRoutes.ts:100`

```typescript
app.post('/login', authRateLimiter, AuthMiddleware.validateLoginInput, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // Get user from database
    const user = await UserRepository.findByUsername(username);
    if (!user) {
      // Use constant time verification to prevent timing attacks
      await AuthService.constantTimeVerifyMissingUser();
      res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
      return;
    }

    // Verify password with constant time
    const isValidPassword = await AuthService.constantTimeVerify(password, user.password_hash, true);
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
      return;
    }

    // Generate JWT token
    const token = await AuthService.generateToken(user);

    // Update last login
    await UserRepository.updateLastLogin(user.id);

    // Set secure cookie（远程模式下启用 secure 标志）
    // Set secure cookie (enable secure flag in remote mode)
    res.cookie(AUTH_CONFIG.COOKIE.NAME, token, {
      ...getCookieOptions(req),
      maxAge: AUTH_CONFIG.TOKEN.COOKIE_MAX_AGE,
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
```

## File and utility endpoints

| Method   | Path                              | Auth                   | Behavior                                                                                                                                                       |
| -------- | --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/api/upload`                     | JWT                    | Multipart field `file`; optional `conversationId`, `workspace`; stores in workspace/uploads only when user setting permits and conversation workspace matches. |
| POST     | `/api/stt`                        | JWT                    | Multipart `audio` up to 30 MB; transcribes via `SpeechToTextService`.                                                                                          |
| GET      | `/api/ext-asset?path=...`         | JWT                    | Serves file only if resolved path is under a loaded extension directory.                                                                                       |
| any      | `/api/ppt-proxy/:port/*`          | JWT                    | Reverse-proxies active PPT preview server ports only.                                                                                                          |
| any      | `/api/office-watch-proxy/:port/*` | JWT                    | Reverse-proxies active Office watch preview ports only.                                                                                                        |
| use      | `/api/directory/*`                | JWT                    | Directory browse/validate/shortcuts router.                                                                                                                    |
| get/post | WeCom webhook path                | Webhook-specific       | Registered by `wecomChannelRoutes`.                                                                                                                            |
| GET      | `/api/channel/weixin/login`       | JWT                    | Weixin login route.                                                                                                                                            |
| any      | extension API routes              | Optional per extension | Loaded from extension webui contributions.                                                                                                                     |

Source: `src/process/webserver/routes/apiRoutes.ts:292`

```typescript
  app.post(
    '/api/upload',
    apiRateLimiter,
    validateApiAccess,
    (req: Request, res: Response, next: NextFunction) => {
      uploadDisk.single('file')(req, res, (err: unknown) => {
        if (err) {
          next(err);
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const file = req.file;
        const conversationId = typeof req.body.conversationId === 'string' ? req.body.conversationId : '';
        const requestedWorkspace = typeof req.body.workspace === 'string' ? req.body.workspace : '';

        if (!file) {
          res.status(400).json({ success: false, msg: 'Missing file' });
          return;
        }

        let uploadDir: string;
        // Check user preference: save to workspace or cache directory
        // Default to cache directory (false) to avoid cluttering workspace
        const saveToWorkspace = await ProcessConfig.get('upload.saveToWorkspace').catch(() => false);
        if (conversationId && saveToWorkspace) {
          let workspace: string;
          try {
            workspace = await resolveUploadWorkspace(conversationId, requestedWorkspace);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid upload workspace';
            const statusCode =
              message === 'Conversation workspace not found' || message === 'Missing conversation id' ? 400 : 403;
            res.status(statusCode).json({ success: false, msg: message });
            return;
          }
          uploadDir = path.join(workspace, 'uploads');
          await fsPromises.mkdir(uploadDir, { recursive: true });
        } else {
          if (requestedWorkspace) {
            res.status(403).json({
              success: false,
              msg: 'Workspace uploads require conversation id',
            });
            return;
          }
          uploadDir = await getTempUploadDir();
        }

        const safeFileName = sanitizeFileName(file.originalname);
        let targetPath = path.join(uploadDir, safeFileName);

        // Check for duplicate and append timestamp if needed
        try {
          await fsPromises.access(targetPath);
          // File exists, append timestamp
          const ext = path.extname(safeFileName);
          const name = path.basename(safeFileName, ext);
          targetPath = path.join(uploadDir, `${name}${AIONUI_TIMESTAMP_SEPARATOR}${Date.now()}${ext}`);
        } catch {
          // File doesn't exist, proceed with original name
        }

        // Verify path is still within uploadDir (defense in depth)
        const resolvedTarget = path.resolve(targetPath);
        const resolvedUploadDir = path.resolve(uploadDir);
        if (!resolvedTarget.startsWith(resolvedUploadDir + path.sep) && resolvedTarget !== resolvedUploadDir) {
          res.status(400).json({ success: false, msg: 'Invalid file name' });
          return;
        }

        // Reconstruct the source path from a trusted base + only the filename component of file.path.
        // This breaks the taint chain: path.basename() strips any directory traversal sequences,
        // and MULTER_TEMP_DIR is a constant set at startup, not user-provided.
        const safeTempPath = path.join(path.resolve(MULTER_TEMP_DIR), path.basename(file.path));
        await fsPromises.rename(safeTempPath, targetPath);

        res.json({
          success: true,
          data: {
            path: targetPath,
            name: path.basename(targetPath),
            size: file.size,
            type: file.mimetype || 'application/octet-stream',
          },
        });
      } catch (error) {
        console.error('[API] Upload file error:', error);
        res.status(500).json({
```

## Directory API endpoints

`src/process/webserver/directoryApi.ts` exposes:

- `GET /api/directory/browse?path=...` for safe directory listing.
- `POST /api/directory/validate` for workspace/path validation.
- `GET /api/directory/shortcuts` for platform-specific shortcut roots.

## WebSocket bridge contract

Browser WebUI mode opens a WebSocket to the current host. Payloads are JSON objects `{ name: string, data: unknown }`. Server sends `ping`; client replies `pong`. Server can send `auth-expired`, causing the browser to stop reconnecting and navigate to `#/login`.

Source: `src/common/adapter/browser.ts:30`

```typescript
      win.electronAPI?.on((event) => {
        try {
          const { value } = event;
          const { name, data } = JSON.parse(value);
          emitter.emit(name, data);
        } catch (e) {
          console.warn('JSON parsing error:', e);
        }
      });
    },
  });
} else {
  // Web 环境 - 使用 WebSocket 通信，并在登录后自动补上已获取 Cookie 的连接
  // Web runtime bridge: ensure the socket reconnects after login so session cookie can be sent
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultHost = `${window.location.hostname}:${WEBUI_DEFAULT_PORT}`;
  const socketUrl = `${protocol}//${window.location.host || defaultHost}`;

  type QueuedMessage = { name: string; data: unknown };

  let socket: WebSocket | null = null;
  let emitterRef: { emit: (name: string, data: unknown) => void } | null = null;
  let reconnectTimer: number | null = null;
  let reconnectDelay = 500;
  let shouldReconnect = true; // Flag to control reconnection

  const messageQueue: QueuedMessage[] = [];

  // 1.发送队列中积压的消息，确保在重新建立连接后不会丢事件
  const flushQueue = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (messageQueue.length > 0) {
      const queued = messageQueue.shift();
      if (queued) {
        socket.send(JSON.stringify(queued));
      }
    }
  };

  // 2.简单的指数退避重连，等待服务端在登录成功后接受新连接
  const scheduleReconnect = () => {
    if (reconnectTimer !== null || !shouldReconnect) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
      connect();
    }, reconnectDelay);
  };

  // 3.建立 WebSocket 连接（或复用已有的 OPEN/CONNECTING 状态）
  const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      socket = new WebSocket(socketUrl);
    } catch (error) {
      scheduleReconnect();
      return;
    }

    // Capture the socket created in this call so the close handler only
    // nulls the outer reference when it still points at THIS socket.
    // Without this guard, a late-firing close event from the OLD socket
    // could wipe the reference to a NEWLY created replacement socket.
```

## Error cases

- Upload returns 400 for missing file, 403 for workspace mismatch or missing conversation when workspace upload requested, 500 for filesystem failures.
- STT returns 413 for audio larger than 30 MB.
- Extension asset route returns 403 if path is outside extension roots and 404 if absent.
- Proxies return 404 for inactive/unregistered preview ports, 502 for proxy errors, 504 for timeouts.
- Auth returns 401 for invalid credentials/token refresh/QR token and 403 for missing protected-route token.

## Areas for Review

- Should route schemas be centralized in zod and reused by renderer clients?
- Should extension API route loading avoid `eval('require')` by using a safer dynamic import boundary?
- Should WebSocket messages include protocol version and request IDs for better observability?
