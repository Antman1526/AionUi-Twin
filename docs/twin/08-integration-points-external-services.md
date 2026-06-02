# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## AI and Agent Integrations

OpenAI-compatible providers use `openai`; Anthropic uses `@anthropic-ai/sdk`; Gemini/Vertex uses `@google/genai`; Bedrock uses `@aws-sdk/client-bedrock`; New API gateways use provider normalization. ACP uses `@agentclientprotocol/sdk`; MCP uses `@modelcontextprotocol/sdk`; Aion CLI uses `@office-ai/aioncli-core` and `@office-ai/platform`.

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
