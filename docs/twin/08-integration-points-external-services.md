# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## AI and Agent Integrations

OpenAI-compatible providers use `openai`; Anthropic uses `@anthropic-ai/sdk`; Gemini/Vertex uses `@google/genai`; Bedrock uses `@aws-sdk/client-bedrock`; New API gateways use provider normalization. ACP uses `@agentclientprotocol/sdk`; MCP uses `@modelcontextprotocol/sdk`; Aion CLI uses `@office-ai/aioncli-core` and `@office-ai/platform`.

Local GGUF integration is implemented as a local OpenAI-compatible provider. The
managed process is llama.cpp `llama-server`; once healthy it is registered with
`platform: 'custom'`, empty `apiKey`, and `baseUrl:
http://127.0.0.1:<port>/v1`. Downstream code treats it like any other
OpenAI-compatible model, while `localModelProviders.ts` permits empty API keys
only for loopback/local URLs.

Confirmed local GGUF files in `/Users/Antman/Desktop/AI_Models/GGUF`:

| Model file | Status | Notes |
| ---------- | ------ | ----- |
| `Qwen3.5-4B-Q4_K_M.gguf` | confirmed | Recommended default; UI e2e answer verified. |
| `Phi-4-mini-instruct-Q4_K_M.gguf` | confirmed | Fast fallback. |
| `Llama-3.2-3B-Instruct-Q4_K_M.gguf` | confirmed | Small/fast option. |
| `gemma-4-E4B-it-Q4_K_M.gguf` | confirmed | Mid-size option. |
| `Qwen3.5-9B-Q4_K_M.gguf` | confirmed | Use `reasoning: off`. |
| `gemma-4-12b-it-Q4_K_M.gguf` | confirmed | Use `reasoning: off`. |
| `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` | confirmed | Use `reasoning: off`; heavier/verbose. |
| `Qwen2.5-14B-Instruct-Q4_K_M.gguf` | confirmed | Stronger but heavier. |

## Remote Channels

`src/process/channels` exports ChannelManager, SessionManager, TelegramPlugin, DingTalkPlugin, WeixinPlugin, WecomPlugin, PairingService, gateway action execution, and channel message service. Dependencies include `grammy`, `dingtalk-stream`, `@wecom/aibot-node-sdk`, and `@larksuiteoapi/node-sdk`.

## Web/Mobile

Express serves WebUI routes, static renderer assets, extension assets, and APIs. WebSocket traffic supports WebUI/mobile. Expo mobile uses services in `mobile/src/services` for API, bridge, websocket, and pending initial messages.

## Document/Media

`docx`, `mammoth`, `officeparser`, `pptx2json`, `xlsx-republish`, `sharp`, `mermaid`, `katex`, markdown plugins, Monaco, CodeMirror, and Tree-sitter support document generation, preview, parsing, and rich rendering.

## Areas for Review

- Standardize retries/rate limits across all channel plugins.
- Generate mobile/WebUI clients from shared API contracts.
- Verify encryption consistency for all provider/channel credentials.
- Add a local model benchmark screen for latency, tokens/sec, memory pressure, and answer validation.
