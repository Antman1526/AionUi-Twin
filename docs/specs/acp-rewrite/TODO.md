# ACP Rewrite — TODO

## ~~acp_session 表持久化暂停~~

**状态**: 已完成
**标记**: ~~`TODO(ACP Discovery)`~~（`grep -rn "TODO(ACP Discovery)" src` 返回 0 行）

### 完成内容

1. **agent_id 语义已修复** — `typeBridge.ts` 的 `toAgentConfig()` 现在使用
   `agentId: old.extra?.customAgentId ?? old.backend`。内建 backend 的 `agent_id`
   为 backend 名（如 `"claude"`），自定义 agent 为 `customAgentId`。
   `OldAcpAgentConfig.extra` 新增 `customAgentId?: string` 字段。

   > 注意：`AcpAgentManager.initAgent()` 目前尚未把 `customAgentId` 透传进 `extra`，
   > 因此当前所有会话都走 backend 名 fallback。等 Agent Hub 落地后补上透传即可生效。

2. **写入已全部恢复** — `AcpAgentV2`（upsert / updateSessionId / updateStatus）与
   `AcpRuntime`（upsert / deleteSession / touchLastActive / updateSessionId /
   updateSessionConfig / persistStatus）。仓储实例通过新的
   `src/process/acp/acpSessionRepo.ts` 惰性单例获取（动态 import 数据库模块，
   避免把 better-sqlite3 / Electron 拉进 ACP 模块图），构造函数可注入以便测试。
   仓储不可用或抛错时只记日志，永不打断会话流程。
   `session_config` 序列化时会剥离 `authCredentials`，密钥不落库。

3. **读取方已落地（表不再是只写）** — `AcpRuntime.createConversation()` 与
   `AcpAgentV2.ensureSession()` 在创建 `AcpSession` 之前调用
   `getSession(conversationId)`：当存储行的 `agent_id` 与当前 `agentId` 一致且存在
   ACP `session_id` 时，将其作为 `agentConfig.resumeSessionId`，由现有
   `SessionLifecycle` 恢复逻辑消费。`agent_id` 不匹配时忽略该行（不会串到别的 agent）。
   调用方显式传入的 `resumeSessionId`（旧链路的 `extra.acpSessionId`）优先级更高。

   **选择该 hook 的原因**：`SessionLifecycle` 在其构造函数里用
   `host.agentConfig.resumeSessionId` 初始化 `_sessionId`，所以持久化的 session id
   必须在 `new AcpSession(...)` 之前写入 config —— 这是改动最小的接入点，
   无需新增 resume API。

4. **测试** — `tests/unit/process/acp/runtime/AcpRuntime.test.ts`（新增，使用内存版
   `IAcpSessionRepository` fake）、`tests/unit/process/acp/compat/AcpAgentV2.test.ts`
   新增 `acp_session persistence` 块、`tests/unit/process/acp/compat/typeBridge.test.ts`
   新增 agentId 映射用例。

### 历史背景：问题 1 — agent_id 语义错误

`typeBridge.ts` 的 `toAgentConfig()` 中 `agentId` 被设为 `old.id`（即 `conversation_id`），
导致 `acp_session` 表中 `conversation_id` 和 `agent_id` 的值完全相同。

```
AcpAgentManager.initAgent():
  agentConfig.id = data.conversation_id     // e.g. "conv-abc-123"

toAgentConfig():
  agentId = old.id                          // = conversation_id = "conv-abc-123"

upsertSession():
  conversation_id = this.conversationId     // "conv-abc-123"
  agent_id = this.agentConfig.agentId       // "conv-abc-123"  ← 同一个值
```

`agent_id` 应该标识 **哪个 agent 实现**，而非哪个 conversation：

| 场景                                    | 期望的 agent_id                                                      |
| --------------------------------------- | -------------------------------------------------------------------- |
| 内建 backend (claude, codex, gemini...) | backend 名称，如 `"claude"`                                          |
| 自定义 agent                            | `customAgentId`，如 `"ext:my-extension:adapter-1"` 或用户配置的 UUID |
| 无 customAgentId 的 fallback            | backend 名称                                                         |

**修复方向**: `agentId: old.extra?.customAgentId ?? old.backend`

**涉及文件**:

- `src/process/acp/compat/typeBridge.ts` — `toAgentConfig()` 中 `agentId` 赋值
- `src/process/acp/types.ts` — `AgentConfig.agentId` 字段定义

### 历史背景：问题 2 — acp_session 表无读取方

`IAcpSessionRepository` 定义了 `getSession()` / `getSuspendedSessions()` 等读取方法，
但在 `AcpAgentV2` 和 `AcpRuntime` 中从未被调用，表只有写入、没有消费。
现已由上文第 3 点的 resume 读取路径消费。

### 遗留项

- `getSuspendedSessions()` 仍无消费方（idle reclaim 目前只看内存里的 `SessionEntry`）。
- `AcpAgentManager.initAgent()` 需要把 `customAgentId` 透传进 `extra` 才能让自定义 agent
  写入真正的 agent 标识。

---

## ~~清理 useAcpV2Enabled hook~~

**状态**: 已完成
**标记**: ~~`TODO`~~

已删除 `useAcpV2Enabled` hook 文件，6 个 SendBox 组件已内联 `enabled: true` / `allowSendWhileLoading`，
移除所有死代码 busy 守卫（`if (!isAcpV2Enabled && isBusy)`）。

**后续**: 考虑将 `useConversationCommandQueue` 的 `enabled` 参数去掉（始终为 `true`）。

---

## tool_call 增量更新合并策略

**状态**: 待处理（等 compat layer 移除后）
**标记**: `TODO(acp-rewrite)`
**文件**: `src/renderer/pages/conversation/Messages/hooks.ts:137`

目前 `acp_tool_call` 的增量更新（`tool_call_update`）由 `AcpAgentV2.mergeToolCall()` 在 process 层做 deep merge 后再发给 renderer，renderer 侧只做 shallow spread。

SDK 的 `tool_call_update` 是增量的（只包含变化的字段），shallow spread 会丢失初始 tool_call 中的 `title`/`kind`/`rawInput` 等字段。

**当 compat layer 移除后**，renderer 需要自行做 deep merge：

```ts
// hooks.ts — 替换当前的 shallow spread
const mergedUpdate = { ...existingMsg.content.update, ...message.content.update };
const merged = { ...existingMsg.content, ...message.content, update: mergedUpdate };
```

---

## 文件引用/上传应使用 SDK ContentBlock 而非纯文本

**状态**: 待调研
**标记**: 无（尚未添加代码标记）

当前会话中的文件引用（`@` 引用）和文件上传都是在发送前将文件内容读取出来，以纯文本拼接到消息中作为 `text` 类型发送给 Agent。这可能是为了兼容各 Agent 的能力差异，但导致：

- 丢失文件元信息（文件名、路径、类型）
- 大文件内容撑爆 prompt，浪费 context window
- 无法利用 Agent 自身的文件处理能力（如 Claude 的 PDF 解析、图片理解等）
- 二进制文件（图片等）被转为 unicode escape 序列后以纯文本发送，Agent 无法识别

**现象**：发送图片时，AcpClient 的 `claude:prompt` 日志显示 prompt 内容为
`[{"type":"text","text":"能看到这张图么"},{"type":"text","text":"[File: /path/to/image.jpeg]\n..."}]`
— 图片 JPEG 二进制被读取后以 `\u0000\u0002...` unicode escape 的纯文本形式塞入 `type: "text"` block，
Agent 实际收到的是一堆乱码而非图片数据。

**应改为**：使用 ACP SDK 中的不同 `ContentBlock` 类型（如 `file`、`image` 等）发送文件内容，让 Agent 根据自身能力处理。

**调研方向**：

1. 调研各 Agent backend（claude, codex, gemini, aionrs 等）对 SDK `ContentBlock` 类型的支持情况
2. ACP SDK 的 `initialize` 响应中有 `promptCapabilities` 声明（类似 model/mode），记录了 Agent 支持哪些 prompt 内容类型
3. 考虑像 model、mode 一样将 `promptCapabilities` 缓存到 `acp.cachedInitializeResult`，在发送消息时根据当前 Agent 的能力做不同处理：
   - 支持 `file` ContentBlock → 直接发 file block
   - 不支持 → fallback 到当前的纯文本方式
4. 涉及的发送链路需要梳理：renderer 侧文件收集 → IPC → AcpAgentManager.sendMessage → AcpSession.sendMessage

---

## 架构约束: session / infra 层禁止直接依赖 ProcessConfig

**状态**: 已遵守（已审查）

`src/process/acp/session/` 和 `src/process/acp/infra/` 是纯 session 逻辑层，不应直接
import 或调用 `ProcessConfig`。所有持久化需求必须通过 callback 通知外层（compat / runtime）处理。

**已审查结果**：session 和 infra 层当前没有直接调用 `ProcessConfig`（`McpConfig.ts`
仅在注释中提及参数来源，不是实际调用）。

**相关模式**：

- `persistSessionCapabilities` — `onModelUpdate` / `onConfigUpdate` / `onModeUpdate` callback → `AcpAgentV2` 写 disk
- `cacheInitializeResult` — `onInitialize` callback → `AcpAgentV2` 写 disk
- `promptTimeout` — `AcpAgentV2.ensureSession()` 从 `ProcessConfig` 读取后传入 `SessionOptions.promptTimeoutMs`

如果后续开发中需要在 session 层读写配置，必须通过 `SessionCallbacks` 或 `SessionOptions` 传递，
不得在 session / infra 层直接引入 `ProcessConfig`。

---

## AcpRuntime: SessionPlugin 机制

**状态**: 待设计
**关联**: V2-MIGRATION-AUDIT.md P3-13 (pendingModelSwitchNotice)

### 背景

不同 backend 有 session 级别的特殊逻辑：

- Claude: `setModel` 后需要在下次 prompt 注入 model identity notice（ACP `set_model` 是静默的，AI 不知道模型已切换）
- Claude: `ccSwitchModelSource` 合并模型信息
- 将来可能有其他 backend 特有的 pre/post-prompt 处理

V2 用 compat 层硬编码（`pendingModelSwitchNotice`），AcpRuntime 需要可扩展的方案。

### 推荐方案: SessionPlugin

```typescript
type SessionPlugin = {
  onModelChange?: (modelId: string) => void;
  beforePrompt?: (content: PromptContent) => PromptContent;
  onModeChange?: (modeId: string) => void;
  // 将来按需扩展更多 hook
};
```

- **有状态**：plugin 实例天然持有状态（如 pendingNotice），比纯函数 middleware 自然
- **多 hook 点**：`onModelChange` 设置状态 + `beforePrompt` 消费状态，middleware 只有一个点不够
- **可组合**：`SessionOptions.plugins: SessionPlugin[]`，session 内部依次调用
- **收敛**：一个 backend 的全部特殊逻辑收到一个 plugin 里

### 备选方案

| 方案                                              | 优点                 | 缺点                                       |
| ------------------------------------------------- | -------------------- | ------------------------------------------ |
| Middleware (`(content, ctx) => content`)          | 简单、纯函数、好测试 | 只有 prompt 一个 hook 点，有状态逻辑靠闭包 |
| Event emitter (`session.on('beforePrompt', ...)`) | 最灵活、解耦         | 返回值处理难、顺序不可控、过度设计         |
| 装饰器 (`withClaudeCompat(session)`)              | 不改 session 内部    | TS 装饰器生态不成熟，proxy 调试成本高      |

### 实现步骤

1. 在 `types.ts` 定义 `SessionPlugin` 类型
2. `SessionOptions` 加 `plugins?: SessionPlugin[]`
3. `AcpSession` 在 `setModel`/`setMode` 时调 `plugin.onModelChange`/`onModeChange`
4. `PromptExecutor.execute` 在 `client.prompt` 前调 `plugin.beforePrompt`
5. `AcpRuntime.createConversation` 根据 backend 注入对应 plugin
6. 实现 `ClaudeSessionPlugin`（model switch notice + ccSwitchModelSource）
