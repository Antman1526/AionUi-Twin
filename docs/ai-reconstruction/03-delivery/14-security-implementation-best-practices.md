# 14 - Security Implementation & Best Practices

## Security boundaries

- Renderer cannot access Node/Electron APIs directly; preload exposes a limited `electronAPI` via `contextBridge`.
- WebUI routes require JWT unless explicitly public or extension route config disables auth.
- File/path routes validate containment with `path.resolve`, `path.relative`, root allowlists, and basename sanitization.
- URL query tokens are not accepted for API/WebSocket auth.
- Local OpenAI-compatible no-key behavior is limited to loopback hostnames only.

## Preload exposure

Source: `src/preload/main.ts:8`

```typescript
import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/constant';

/**
 * @description 注入到renderer进程中, 用于与main进程通信
 * */
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: any) => {
    return ipcRenderer
      .invoke(
        ADAPTER_BRIDGE_EVENT_KEY,
        JSON.stringify({
          name: name,
          data: data,
        })
      )
      .catch((error) => {
        console.error('IPC invoke error:', error);
        throw error;
      });
  },
  on: (callback: any) => {
    const handler = (event: any, value: any) => {
      callback({ event, value });
    };
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => {
      ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
    };
  },
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // 直接 IPC 调用（绕过 bridge 库）/ Direct IPC calls (bypass bridge library)
  webuiResetPassword: () => ipcRenderer.invoke('webui-direct-reset-password'),
  webuiGetStatus: () => ipcRenderer.invoke('webui-direct-get-status'),
  // 修改密码不需要当前密码 / Change password without current password
  webuiChangePassword: (newPassword: string) => ipcRenderer.invoke('webui-direct-change-password', { newPassword }),
  webuiChangeUsername: (newUsername: string) => ipcRenderer.invoke('webui-direct-change-username', { newUsername }),
  // Feedback: collect and compress recent log files
  collectFeedbackLogs: () => ipcRenderer.invoke('feedback:collect-logs'),
  // 生��二维码 token / Generate QR token
  webuiGenerateQRToken: () => ipcRenderer.invoke('webui-direct-generate-qr-token'),
  // WeChat login IPC
  weixinLoginStart: () => ipcRenderer.invoke('weixin:login:start'),
  weixinLoginOnQR: (callback: (data: { qrcodeUrl: string }) => void) => {
    const h = (_event: unknown, data: { qrcodeUrl: string }) => callback(data);
```

The preload exposes:

- Generic bridge `emit/on` using `ADAPTER_BRIDGE_EVENT_KEY`.
- Dragged file absolute path via `webUtils.getPathForFile`.
- A small set of direct WebUI/reset/QR/weixin/feedback IPC helpers.
- Tray events translated into DOM `CustomEvent` objects.

## Upload path safety

Source: `src/process/webserver/routes/apiRoutes.ts:43`

```typescript
 * Multer v2 decodes Content-Disposition filename as Latin-1 (per HTTP spec),
 * but browsers encode non-ASCII filenames (CJK, etc.) as UTF-8 bytes.
 * Re-encode the Latin-1 string back to raw bytes and decode as UTF-8.
 */
function decodeMulterFileName(raw: string): string {
  try {
    const bytes = Buffer.from(raw, 'latin1');
    return bytes.toString('utf8');
  } catch {
    return raw;
  }
}

function sanitizeFileName(fileName: string): string {
  const decoded = decodeMulterFileName(fileName);
  const basename = path.basename(decoded);
  const safe = basename.replace(/[<>:"/\\|?*]/g, '_');
  if (!safe || safe === '.' || safe === '..') return `file_${Date.now()}`;
  return safe;
}

function normalizeMountPath(input: string): string {
  if (!input || input.trim() === '') return '/';
  return input.startsWith('/') ? input : `/${input}`;
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

export async function resolveUploadWorkspace(conversationId: string, requestedWorkspace?: string): Promise<string> {
  if (!conversationId) {
    throw new Error('Missing conversation id');
  }
```

File names are decoded from multer's Latin-1 interpretation into UTF-8, reduced to basename, forbidden characters are replaced, and empty/dot names are replaced with timestamp names. Target paths are verified to stay inside the selected upload directory.

## Extension route safety

Extension static assets and API route entry points must resolve inside the extension root. Unknown extension namespaces return 404 instead of falling through to the SPA.

## SSRF mitigation

Office/PPT proxy routes only connect to `127.0.0.1:<port>` after validating the port against active preview/watch session registries. Hop-by-hop and auth headers are stripped.

## Auth security

- bcrypt salt rounds: 12.
- JWT secret is 64 random bytes hex if not supplied by env/DB.
- Logout blacklist stores SHA-256 token hashes.
- Missing-user login path uses dummy bcrypt verification.
- Password and username validators limit length and strength.
- Security headers and CSP are applied by middleware.
- QR login page uses static HTML and `textContent` for dynamic error messages.

## Local LLM security

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
```

Only loopback hosts get the no-key placeholder. This prevents cloud OpenAI-compatible URLs from silently sending unauthenticated requests or masking missing credentials.

## Current risks

- Some confirmation auto-approval behavior in YOLO mode chooses the first option; destructive command policies need strong guardrails.
- Token blacklist is memory-only.
- Extension route modules are loaded dynamically from extension directories; route auth defaults help, but extension sandbox policy must remain strict.
- WebUI remote access must be explicitly configured and should be paired with strong random initial credentials.
- Ad-hoc signed macOS builds are not notarized.

## Areas for Review

- Should secrets move to OS keychain/Keychain/Credential Manager/libsecret?
- Should extension-contributed API routes run in a sandboxed worker instead of main-process require?
- Should YOLO mode use per-agent capability policy and deny destructive defaults?
