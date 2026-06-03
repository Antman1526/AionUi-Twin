# 09 - Configuration & Environment Variables

## Configuration stores

AionUi uses `@office-ai/platform/storage` for logical stores:

Source: `src/common/config/storage.ts:10`

```typescript

/**
 * @description 聊天相关的存储
 */
export const ChatStorage = storage.buildStorage<IChatConversationRefer>('agent.chat');

// 聊天消息存储
export const ChatMessageStorage = storage.buildStorage('agent.chat.message');

// 系统配置存储
export const ConfigStorage = storage.buildStorage<IConfigStorageRefer>('agent.config');

// 系统环境变量存储
export const EnvStorage = storage.buildStorage<IEnvStorageRefer>('agent.env');

export interface IConfigStorageRefer {
  'gemini.config': {
    authType: string;
    proxy: string;
    GOOGLE_GEMINI_BASE_URL?: string;
    /** @deprecated Use accountProjects instead. Kept for backward compatibility migration. */
    GOOGLE_CLOUD_PROJECT?: string;
    /** 按 Google 账号存储的 GCP 项目 ID / GCP project IDs stored per Google account */
    accountProjects?: Record<string, string>;
    yoloMode?: boolean;
    /** Preferred session mode for new conversations / 新会话的默认模式 */
    preferredMode?: string;
    /** Preferred model ID for new conversations / 新会话的默认模型 */
    preferredModelId?: string;
  };
  'codex.config'?: {
```

| Store                | Prefix               | Purpose                                                        |
| -------------------- | -------------------- | -------------------------------------------------------------- |
| `ChatStorage`        | `agent.chat`         | Conversation metadata in platform storage.                     |
| `ChatMessageStorage` | `agent.chat.message` | Chat message storage compatibility.                            |
| `ConfigStorage`      | `agent.config`       | Model, MCP, language, theme, WebUI, ACP, pet, system settings. |
| `EnvStorage`         | `agent.env`          | Work/cache directory metadata.                                 |

## Key settings

`IConfigStorageRefer` defines the app config contract. Important keys:

| Key                                                                        | Type/purpose                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `gemini.config`                                                            | Gemini auth type, proxy, base URL, project/account map, preferred mode/model.      |
| `codex.config`                                                             | CLI path, YOLO mode, sandbox mode.                                                 |
| `acp.config`                                                               | Per-backend auth token, CLI path, YOLO mode, preferred mode/model, prompt timeout. |
| `acp.promptTimeout`                                                        | Global prompt timeout in seconds, default 300.                                     |
| `acp.agentIdleTimeout`                                                     | Idle timeout in minutes, default 5.                                                |
| `acp.customAgents`                                                         | User-defined custom ACP agents.                                                    |
| `assistants`                                                               | Preset assistant configurations.                                                   |
| `model.config`                                                             | Model provider records with base URLs and API keys.                                |
| `mcp.config`                                                               | MCP server definitions.                                                            |
| `language`, `theme`, `colorScheme`                                         | i18n and theme state.                                                              |
| `webui.desktop.enabled`, `webui.desktop.allowRemote`, `webui.desktop.port` | Desktop-managed WebUI behavior.                                                    |
| `tools.imageGenerationModel`, `tools.speechToText`                         | Tool model/service configuration.                                                  |
| `upload.saveToWorkspace`                                                   | Controls upload destination for WebUI file uploads.                                |
| `system.closeToTray`, `system.keepAwake`, notifications                    | Desktop runtime behavior.                                                          |
| `assistant.<channel>.defaultModel`, `assistant.<channel>.agent`            | Channel assistant defaults.                                                        |
| `pet.enabled`, `pet.size`, `pet.dnd`, `pet.confirmEnabled`                 | Desktop pet state.                                                                 |

## Environment variables

| Variable                                            | Used by                                 | Behavior                                                                    |
| --------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`                                          | Vite, Electron main, WebUI server       | `production` changes WebUI default port to 25808 and build/minify behavior. |
| `AIONUI_MULTI_INSTANCE`                             | Main process, Vite defines, port config | Allows multiple desktop dev instances; WebUI dev port becomes 25810.        |
| `AIONUI_E2E_TEST`                                   | Main process                            | Skips single-instance lock during e2e tests.                                |
| `SENTRY_DSN`                                        | Main and renderer                       | Enables Sentry DSN injection/init.                                          |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Vite Sentry plugin                      | Enables sourcemap upload and deletes uploaded maps.                         |
| `JWT_SECRET`                                        | AuthService                             | Overrides persisted DB JWT secret.                                          |
| `DISPLAY`                                           | WebUI server                            | Linux headless detection for public IP attempt.                             |
| `CSC_IDENTITY_AUTO_DISCOVERY`                       | electron-builder                        | Set false for ad-hoc/no identity macOS build.                               |
| `ALLOW_REMOTE`                                      | server scripts                          | Enables remote WebUI access in server mode.                                 |
| `PREBUILDS_ONLY`                                    | Packaged app                            | Forced to `1` in packaged app to avoid wrong-arch native builds.            |

## Constants

Source: `src/common/config/constants.ts:33`

```typescript
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

/** MIME类型到文件扩展名的映射 */
export const MIME_TO_EXT_MAP: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  bmp: '.bmp',
  tiff: '.tiff',
  'svg+xml': '.svg',
};

/** 默认图片文件扩展名 */
export const DEFAULT_IMAGE_EXTENSION = '.png';
```

WebUI default port rules:

- Production: 25808.
- Development multi-instance: 25810.
- Development normal: 25809.

## Vite defines

Main and renderer inject `process.env.NODE_ENV`, `process.env.env`, `process.env.SENTRY_DSN`, and renderer also injects `process.env.AIONUI_MULTI_INSTANCE` and `global: globalThis`.

## Sanitization guidance

- Never document real API keys from `model.config`, `acp.config.*.authToken`, channel configs, or `.env`.
- Use placeholder examples such as `sk-REDACTED`, `JWT_SECRET=<generated-random-hex>`, or `TELEGRAM_BOT_TOKEN=<redacted>`.
- The local LLM placeholder `aionui-local-no-api-key` is intentionally non-secret.

## Areas for Review

- Should config keys be versioned and migrated with a formal schema instead of ad hoc migration flags?
- Should secrets be stored in OS keychain instead of platform storage/SQLite fields?
- Should WebUI port and remote access be validated centrally with zod?
