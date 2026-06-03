# 08 - Integration Points & External Services

## LLM providers

AionUi supports multiple model-provider protocols through `ClientFactory` and renderer provider presets.

Source: `src/common/api/ClientFactory.ts:58`

```typescript
    default:
      return rootUrl;
  }
}

export class ClientFactory {
  static async createRotatingClient(
    provider: TProviderWithModel,
    options: ClientOptions = {}
  ): Promise<RotatingClient> {
    const authType = getProviderAuthType(provider);
    const rotatingOptions = options.rotatingOptions || { maxRetries: 3, retryDelay: 1000 };

    // 对 new-api 网关进行 URL 规范化 / Normalize URL for new-api gateway
    const isNewApi = isNewApiPlatform(provider.platform);
    const baseUrl = isNewApi ? normalizeNewApiBaseUrl(provider.baseUrl, authType) : provider.baseUrl;

    switch (authType) {
      case AuthType.USE_OPENAI: {
        const clientConfig: OpenAIClientConfig = {
          baseURL: baseUrl,
          timeout: options.timeout,
          defaultHeaders: {
            'HTTP-Referer': 'https://aionui.com',
            'X-Title': 'AionUi',
          },
          ...(options.baseConfig as OpenAIClientConfig),
        };

        // 添加代理配置（如果提供）
        if (options.proxy) {
          const { HttpsProxyAgent } = await import('https-proxy-agent');
          clientConfig.httpAgent = new HttpsProxyAgent(options.proxy);
        }

        return new OpenAIRotatingClient(
          getApiKeysForOpenAICompatibleClient(provider.apiKey, baseUrl),
          clientConfig,
          rotatingOptions
        );
      }

      case AuthType.USE_GEMINI: {
        const clientConfig: GeminiClientConfig = {
          model: provider.useModel,
          baseURL: baseUrl,
          ...(options.baseConfig as GeminiClientConfig),
        };

        return new GeminiRotatingClient(provider.apiKey, clientConfig, rotatingOptions, authType);
      }

      case AuthType.USE_VERTEX_AI: {
        const clientConfig: GeminiClientConfig = {
          model: provider.useModel,
          // Note: Don't set baseURL for Vertex AI - it uses Google's built-in endpoints
          ...(options.baseConfig as GeminiClientConfig),
        };

        return new GeminiRotatingClient(provider.apiKey, clientConfig, rotatingOptions, authType);
      }

      case AuthType.USE_ANTHROPIC: {
        const clientConfig: AnthropicClientConfig = {
          model: provider.useModel,
          baseURL: baseUrl,
```

| Provider/protocol | Package/client                             | Base URL behavior                                                              |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| OpenAI-compatible | `openai` via `OpenAIRotatingClient`        | Uses base URL as provided; local loopback may receive placeholder key.         |
| New API gateway   | OpenAI/Gemini/Anthropic compatible         | `normalizeNewApiBaseUrl` strips suffixes and applies protocol-specific suffix. |
| Gemini API        | `@google/genai` via `GeminiRotatingClient` | Uses model and optional base URL.                                              |
| Vertex AI         | `@google/genai`                            | Does not set custom base URL.                                                  |
| Anthropic         | `@anthropic-ai/sdk`                        | Uses Anthropic-compatible base URL and timeout.                                |
| Bedrock           | `@aws-sdk/client-bedrock`                  | Bridge-specific AWS Bedrock support.                                           |

## Provider presets

`MODEL_PLATFORMS` contains official and OpenAI-compatible providers including Gemini, Vertex AI, OpenAI, Anthropic, AWS Bedrock, DeepSeek, MiniMax, Novita, OpenRouter, Dashscope, SiliconFlow, Zhipu, Moonshot, xAI, Ark, Qianfan, Hunyuan, Lingyi, Poe, PPIO, ModelScope, InfiniAI, Ctyun, StepFun, Ollama, and LM Studio.

Local presets:

- Ollama: `http://localhost:11434/v1`.
- LM Studio: `http://localhost:1234/v1`.

## Agent protocol integrations

| Integration   | Code area                                                       | Purpose                                                                          |
| ------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ACP           | `src/process/acp`, `src/process/agent/acp`                      | Local CLI agent protocol sessions, auth negotiation, permissions, MCP injection. |
| AionRS        | `src/process/agent/aionrs`, `src/process/task/AionrsManager.ts` | Aion runtime/binary-backed agent path.                                           |
| Gemini        | `src/process/agent/gemini`, `src/process/worker/gemini.ts`      | Gemini CLI/API workflow.                                                         |
| Nanobot       | `src/process/agent/nanobot`                                     | Nanobot connection/manager support.                                              |
| OpenClaw      | `src/process/agent/openclaw`                                    | Remote gateway/device auth integration.                                          |
| Remote agents | `src/process/agent/remote`                                      | External remote agent configuration and status.                                  |

## MCP integrations

- Built-in MCP servers are under `src/process/resources/builtinMcp`.
- User MCP config is persisted under `ProcessConfig.get('mcp.config')`.
- ACP runtime injects user MCP servers filtered by cached agent MCP capabilities.
- Team-guide MCP can be injected automatically for solo agents.

## Remote assistant channels

| Channel  | Packages/files                                                                       | Data exchange                                                       |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Telegram | `grammy`, `@grammyjs/transformer-throttler`, `src/process/channels/plugins/telegram` | Bot messages, keyboard actions, authorized channel users, sessions. |
| Lark     | `@larksuiteoapi/node-sdk`, `src/process/channels/plugins/lark`                       | Lark cards/events mapped to assistant actions.                      |
| DingTalk | `dingtalk-stream`, `src/process/channels/plugins/dingtalk`                           | Stream events and cards.                                            |
| Weixin   | `src/process/channels/plugins/weixin`                                                | QR login/monitor/typing/action adapter.                             |
| WeCom    | `@wecom/aibot-node-sdk`, `src/process/channels/plugins/wecom`                        | Webhook/crypto stream state and AI bot replies.                     |

## Extension integrations

Extensions can contribute:

- API routes and static assets in WebUI.
- Assistants, skills, MCP servers, model providers, settings tabs, themes, and i18n.
- Lifecycle hooks run by `lifecycleRunner`.

Source: `src/process/webserver/routes/apiRoutes.ts:125`

```typescript
function runMiddlewareStack(req: Request, res: Response, next: NextFunction, stack: RequestHandler[]): void {
  let index = 0;
  const dispatch = (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    const current = stack[index++];
    if (!current) {
      return;
    }
    try {
      Promise.resolve(current(req, res, (middlewareErr?: unknown) => dispatch(middlewareErr))).catch(dispatch);
    } catch (error) {
      dispatch(error);
    }
  };
  dispatch();
}

type MatchedApiRoute = {
  extensionName: string;
  routePath: string;
  routeEntry: string;
  auth: boolean;
};

type MatchedStaticAsset = {
  extensionName: string;
  filePath: string;
};

function resolveMatchedApiRoute(requestPath: string): MatchedApiRoute | null {
  const registry = ExtensionRegistry.getInstance();
  const contributions = registry.getWebuiContributions();
  for (const contribution of contributions) {
    const extensionRoot = path.resolve(contribution.directory);
    for (const route of contribution.config.apiRoutes || []) {
      const routePath = normalizeMountPath(route.path);
      if (routePath !== requestPath) continue;
      const routeEntry = path.resolve(extensionRoot, route.entryPoint);
      if (!isPathInsideRoot(routeEntry, extensionRoot)) continue;
      return {
        extensionName: contribution.extensionName,
        routePath,
        routeEntry,
        auth: route.auth !== false,
      };
    }
  }
  return null;
}

function resolveMatchedStaticAsset(requestPath: string): MatchedStaticAsset | null {
  const registry = ExtensionRegistry.getInstance();
  const contributions = registry.getWebuiContributions();
  for (const contribution of contributions) {
    const extensionRoot = path.resolve(contribution.directory);
    for (const asset of contribution.config.staticAssets || []) {
      const urlPrefix = normalizeMountPath(asset.urlPrefix);
      if (!(requestPath === urlPrefix || requestPath.startsWith(`${urlPrefix}/`))) continue;
      const staticRoot = path.resolve(extensionRoot, asset.directory);
      if (!isPathInsideRoot(staticRoot, extensionRoot)) continue;

      const relativePart = requestPath.slice(urlPrefix.length);
      if (!relativePart || relativePart === '/') continue;
      const filePath = path.resolve(staticRoot, `.${relativePart}`);
      if (!isPathInsideRoot(filePath, staticRoot)) continue;
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      return { extensionName: contribution.extensionName, filePath };
    }
  }
  return null;
}

function registerExtensionWebuiRoutes(app: Express, validateApiAccess: RequestHandler): void {
  // eslint-disable-next-line no-eval
  const nativeRequire = eval('require') as NodeRequire;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestPath = normalizeMountPath(req.path || '/');

    const staticMatch = resolveMatchedStaticAsset(requestPath);
    if (staticMatch) {
      const stack: RequestHandler[] = [
        apiRateLimiter,
        (_req, response, middlewareNext) => {
          response.setHeader('Cache-Control', 'public, max-age=3600');
          middlewareNext();
        },
        (_req, response, middlewareNext) => {
          response.sendFile(staticMatch.filePath, (error) => {
            if (error) middlewareNext(error);
          });
        },
      ];
      runMiddlewareStack(req, res, next, stack);
      return;
    }

    const routeMatch = resolveMatchedApiRoute(requestPath);
    if (!routeMatch) {
      // Extension namespaces should not silently fall through to the SPA handler.
      // This prevents disabled/unknown extension routes from returning 200 HTML.
      if (/^\/ext-[a-z0-9-]+(?:\/|$)/i.test(requestPath)) {
        res.status(404).json({ message: 'Extension route not found' });
        return;
      }
      next();
      return;
    }

    let routeModule: unknown;
    try {
      routeModule = nativeRequire(routeMatch.routeEntry);
    } catch (error) {
      console.error(
        `[WebUI] Failed to load API route module: ${routeMatch.routeEntry} (${routeMatch.extensionName})`,
        error
      );
      res.status(500).json({ message: 'Failed to load extension API route' });
      return;
    }

    const handler = resolveRouteHandler(routeModule);
    if (!handler) {
      console.warn(`[WebUI] API route has no function export: ${routeMatch.routeEntry} (${routeMatch.extensionName})`);
      res.status(500).json({ message: 'Invalid extension API route handler' });
      return;
    }
```

## Update services

- Manual update bridge checks GitHub Releases and downloads selected assets.
- `electron-updater` supports auto-update status, check, download, and quit/install for packaged builds.
- Recent macOS ARM64 DMG artifact: `/Users/Antman/Downloads/AionUi-1.9.22-mac-arm64.dmg`, SHA-256 `c07600e622bdb1e3f40ffa619bd79c90fd9ff6643ddfc7ec2bafa602d91c6806`.

## Areas for Review

- Should model provider presets be moved to extension-contributed provider manifests?
- Should channel plugins share a stricter message normalization interface?
- Should GitHub release update checks be abstracted behind a provider interface for private mirrors?
