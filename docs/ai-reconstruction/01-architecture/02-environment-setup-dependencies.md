# 02 - Environment Setup & Dependencies

## Required host tools

| Tool                       | Required role                               | Notes                                                                                              |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| macOS/Linux/Windows        | Desktop packaging targets                   | The recent verified build was macOS ARM64 DMG.                                                     |
| Bun                        | Install dependencies and run scripts        | Project scripts use `bun run ...` and `bunx ...`.                                                  |
| Node.js                    | Electron/Vite/scripts runtime               | Native modules such as `better-sqlite3` require ABI-compatible builds.                             |
| Git                        | Source control and GitHub push              | Remote: `https://github.com/Antman1526/AionUi-Twin.git`.                                           |
| Xcode command line tools   | macOS native module/package signing support | Needed for native dependencies and DMG packaging on macOS.                                         |
| Optional Apple credentials | Notarization                                | Build can ad-hoc sign with `CSC_IDENTITY_AUTO_DISCOVERY=false`; notarization requires credentials. |

## Install sequence

```bash
cd /Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main
bun install
bunx tsc --noEmit
bun run lint
bun run test
```

For local LLM testing, start one of these OpenAI-compatible servers before adding the provider in Settings:

| Provider preset                | Base URL                    | API key requirement                                                   |
| ------------------------------ | --------------------------- | --------------------------------------------------------------------- |
| Ollama                         | `http://localhost:11434/v1` | None; AionUi supplies internal placeholder `aionui-local-no-api-key`. |
| LM Studio                      | `http://localhost:1234/v1`  | None for loopback OpenAI-compatible mode.                             |
| Custom cloud OpenAI-compatible | User-entered URL            | Requires API key unless URL is loopback.                              |

## Package manifest identity

```json
{
  "name": "AionUi",
  "version": "1.9.22",
  "description": "Transform your command-line AI agent into a modern, efficient AI Chat interface.",
  "main": "./out/main/index.js"
}
```

## Runtime dependencies

| Package                            | Version specifier |
| ---------------------------------- | ----------------: |
| `@agentclientprotocol/sdk`         |         `^0.18.2` |
| `@anthropic-ai/sdk`                |         `^0.71.2` |
| `@arco-design/web-react`           |         `^2.66.1` |
| `@aws-sdk/client-bedrock`          |        `^3.987.0` |
| `@codemirror/lang-css`             |          `^6.3.1` |
| `@codemirror/lang-json`            |          `^6.0.2` |
| `@codemirror/lang-markdown`        |          `^6.5.0` |
| `@dnd-kit/core`                    |          `^6.3.1` |
| `@dnd-kit/sortable`                |         `^10.0.0` |
| `@dnd-kit/utilities`               |          `^3.2.2` |
| `@floating-ui/react`               |        `^0.27.16` |
| `@google/genai`                    |          `^2.8.0` |
| `@grammyjs/transformer-throttler`  |          `^1.2.1` |
| `@icon-park/react`                 |          `^1.4.2` |
| `@larksuiteoapi/node-sdk`          |         `^1.66.1` |
| `@modelcontextprotocol/sdk`        |         `^1.29.0` |
| `@monaco-editor/react`             |          `^4.7.0` |
| `@office-ai/aioncli-core`          |         `^0.30.6` |
| `@office-ai/platform`              |         `^0.3.16` |
| `@sentry/electron`                 |         `^7.10.0` |
| `@types/bcryptjs`                  |          `^2.4.6` |
| `@types/jsonwebtoken`              |         `^9.0.10` |
| `@uiw/codemirror-extensions-langs` |         `^4.25.1` |
| `@uiw/react-codemirror`            |         `^4.25.2` |
| `@wecom/aibot-node-sdk`            |          `^1.0.7` |
| `bcryptjs`                         |          `^2.4.3` |
| `better-sqlite3`                   |         `^12.4.1` |
| `buffer`                           |          `^6.0.3` |
| `classnames`                       |          `^2.5.1` |
| `cookie`                           |          `^1.0.2` |
| `cookie-parser`                    |          `^1.4.7` |
| `cors`                             |          `^2.8.5` |
| `croner`                           |          `^9.1.0` |
| `diff`                             |          `^8.0.3` |
| `diff2html`                        |         `^3.4.55` |
| `dingtalk-stream`                  |          `^2.1.4` |
| `docx`                             |          `^9.5.1` |
| `electron-log`                     |          `^5.4.3` |
| `electron-squirrel-startup`        |          `^1.0.1` |
| `electron-updater`                 |          `^6.6.2` |
| `eventemitter3`                    |          `^5.0.1` |
| `express`                          |          `^5.1.0` |
| `express-rate-limit`               |          `^7.5.1` |
| `fix-path`                         |          `^4.0.0` |
| `grammy`                           |         `^1.39.3` |
| `html-to-text`                     |          `^9.0.5` |
| `i18next`                          |        `^23.7.16` |
| `jsonrepair`                       |         `^3.13.0` |
| `jsonwebtoken`                     |          `^9.0.2` |
| `katex`                            |        `^0.16.22` |
| `mammoth`                          |         `^1.11.0` |
| `mermaid`                          |        `^11.15.0` |
| `multer`                           |          `^2.1.1` |
| `officeparser`                     |          `^5.2.2` |
| `openai`                           |         `^5.12.2` |
| `pptx2json`                        |         `^0.0.10` |
| `process`                          |        `^0.11.10` |
| `qrcode-terminal`                  |         `^0.12.0` |
| `qrcode.react`                     |          `^4.2.0` |
| `react`                            |         `^19.1.0` |
| `react-dom`                        |         `^19.1.0` |
| `react-i18next`                    |         `^14.0.5` |
| `react-markdown`                   |         `^10.1.0` |
| `react-router-dom`                 |         `^7.17.0` |
| `react-syntax-highlighter`         |         `^16.1.0` |
| `react-virtuoso`                   |         `^4.18.1` |
| `rehype-katex`                     |          `^7.0.1` |
| `rehype-raw`                       |          `^7.0.0` |
| `remark-breaks`                    |          `^4.0.0` |
| `remark-gfm`                       |          `^4.0.1` |
| `remark-math`                      |          `^6.0.0` |
| `semver`                           |          `^7.7.2` |
| `sharp`                            |         `^0.34.3` |
| `smol-toml`                        |          `^1.6.1` |
| `stream-browserify`                |          `^3.0.0` |
| `streamdown`                       |          `^1.5.1` |
| `strip-json-comments`              |          `^3.1.1` |
| `swr`                              |          `^2.3.6` |
| `tiny-csrf`                        |          `^1.1.6` |
| `turndown`                         |          `^7.2.2` |
| `turndown-plugin-gfm`              |          `^1.0.2` |
| `web-tree-sitter`                  |        `^0.25.10` |
| `ws`                               |         `^8.21.0` |
| `xlsx-republish`                   |         `^0.20.3` |
| `zod`                              |        `^3.25.76` |

## Development dependencies

| Package                           | Version specifier |
| --------------------------------- | ----------------: |
| `@electron/fuses`                 |          `^1.8.0` |
| `@electron/notarize`              |          `^3.1.0` |
| `@playwright/test`                |         `^1.58.2` |
| `@sentry/vite-plugin`             |          `^5.1.1` |
| `@testing-library/jest-dom`       |          `^6.9.1` |
| `@testing-library/react`          |         `^16.3.2` |
| `@testing-library/user-event`     |         `^14.6.1` |
| `@types/better-sqlite3`           |         `^7.6.13` |
| `@types/cookie`                   |          `^1.0.0` |
| `@types/cookie-parser`            |          `^1.4.9` |
| `@types/cors`                     |         `^2.8.19` |
| `@types/html-to-text`             |          `^9.0.4` |
| `@types/multer`                   |          `^2.1.0` |
| `@types/node`                     |         `^24.3.1` |
| `@types/qrcode-terminal`          |         `^0.12.0` |
| `@types/react-dom`                |         `^19.1.6` |
| `@types/react-syntax-highlighter` |        `^15.5.13` |
| `@types/semver`                   |          `^7.7.1` |
| `@types/turndown`                 |          `^5.0.6` |
| `@types/ws`                       |         `^8.18.1` |
| `@vitest/coverage-v8`             |         `^4.0.18` |
| `cross-env`                       |          `^7.0.3` |
| `dotenv`                          |         `^17.2.1` |
| `electron`                        |        `^39.8.10` |
| `electron-builder`                |        `^26.15.2` |
| `electron-devtools-installer`     |          `^4.0.0` |
| `electron-vite`                   |          `^5.0.0` |
| `esbuild`                         |        `^0.25.11` |
| `husky`                           |          `^9.1.7` |
| `jest`                            |         `^30.1.3` |
| `jest-diff`                       |         `^30.0.4` |
| `jsdom`                           |         `^28.1.0` |
| `lint-staged`                     |         `^16.2.7` |
| `oxfmt`                           |         `^0.41.0` |
| `oxlint`                          |         `^1.56.0` |
| `patch-package`                   |          `^8.0.0` |
| `ts-node`                         |         `^10.9.2` |
| `tsx`                             |         `^4.19.1` |
| `typescript`                      |          `^5.8.3` |
| `unocss`                          |         `^66.3.3` |
| `unocss-preset-extra`             |          `^1.0.0` |
| `vite`                            |          `^6.4.3` |
| `vite-plugin-static-copy`         |          `^4.1.1` |
| `vitest`                          |         `^4.0.18` |

## Scripts

| Script                     | Command                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `start`                    | `electron-vite dev`                                                                                         |
| `start:multi`              | `cross-env AIONUI_MULTI_INSTANCE=1 electron-vite dev`                                                       |
| `cli`                      | `electron-vite dev`                                                                                         |
| `webui`                    | `rm -rf out/renderer && electron-vite dev -- --webui`                                                       |
| `webui:remote`             | `rm -rf out/renderer && electron-vite dev -- --webui --remote`                                              |
| `webui:prod`               | `cross-env NODE_ENV=production electron-vite dev -- --webui`                                                |
| `webui:prod:remote`        | `cross-env NODE_ENV=production electron-vite dev -- --webui --remote`                                       |
| `resetpass`                | `electron-vite dev -- --resetpass`                                                                          |
| `package`                  | `electron-vite build`                                                                                       |
| `make`                     | `electron-vite build`                                                                                       |
| `dist`                     | `node scripts/build-with-builder.js`                                                                        |
| `dist:mac`                 | `node scripts/build-with-builder.js auto --mac`                                                             |
| `dist:win`                 | `node scripts/build-with-builder.js auto --win`                                                             |
| `dist:linux`               | `node scripts/build-with-builder.js auto --linux`                                                           |
| `build-mac`                | `node scripts/build-with-builder.js auto --mac --arm64 --x64`                                               |
| `build-win`                | `node scripts/build-with-builder.js auto --win`                                                             |
| `build-deb`                | `node scripts/build-with-builder.js auto --linux`                                                           |
| `build-mac:arm64`          | `node scripts/build-with-builder.js arm64 --mac --arm64`                                                    |
| `build-mac:x64`            | `node scripts/build-with-builder.js x64 --mac --x64`                                                        |
| `build-win:arm64`          | `node scripts/build-with-builder.js arm64 --win --arm64`                                                    |
| `build-win:x64`            | `node scripts/build-with-builder.js x64 --win --x64`                                                        |
| `build`                    | `node scripts/build-with-builder.js auto --mac --arm64 --x64`                                               |
| `lint`                     | `oxlint`                                                                                                    |
| `lint:fix`                 | `oxlint --fix`                                                                                              |
| `format`                   | `oxfmt`                                                                                                     |
| `format:check`             | `oxfmt --check`                                                                                             |
| `i18n:types`               | `node scripts/generate-i18n-types.js`                                                                       |
| `test`                     | `vitest run`                                                                                                |
| `test:watch`               | `vitest`                                                                                                    |
| `test:coverage`            | `vitest run --coverage`                                                                                     |
| `test:contract`            | `vitest run tests/contract --passWithNoTests`                                                               |
| `test:integration`         | `vitest run tests/integration`                                                                              |
| `test:packaged:i18n`       | `vitest run tests/integration/i18n-packaged.test.ts`                                                        |
| `bench`                    | `vitest bench`                                                                                              |
| `bench:db`                 | `bun test ./tests/bench/database.bench.bun.ts`                                                              |
| `bench:report`             | `bunx tsx scripts/run-benchmarks.ts`                                                                        |
| `bench:startup`            | `bunx tsx scripts/benchmark-startup.ts`                                                                     |
| `bench:full`               | `bunx tsx scripts/run-benchmarks.ts --startup`                                                              |
| `debug:perf`               | `cross-env ACP_PERF=1 PERF_MONITOR=1 bun start`                                                             |
| `debug:perf:report`        | `bunx tsx scripts/debug-performance.ts --report`                                                            |
| `debug:mcp`                | `bunx tsx scripts/debug-mcp.ts`                                                                             |
| `debug:mcp:list`           | `bunx tsx scripts/debug-mcp.ts list`                                                                        |
| `debug:mcp:validate`       | `bunx tsx scripts/debug-mcp.ts validate`                                                                    |
| `debug:custom-agent`       | `bunx tsx scripts/debug-custom-agent.ts`                                                                    |
| `test:e2e`                 | `playwright test --config playwright.config.ts`                                                             |
| `test:e2e:conv:acp`        | `playwright test --config playwright.config.ts tests/e2e/features/conversations/acp --reporter=list`        |
| `test:e2e:team`            | `playwright test --config playwright.config.ts tests/e2e/specs/team-*.e2e.ts --reporter=list`               |
| `test:e2e:team:create`     | `playwright test --config playwright.config.ts tests/e2e/specs/team-create.e2e.ts --reporter=list`          |
| `test:e2e:team:lifecycle`  | `playwright test --config playwright.config.ts tests/e2e/specs/team-agent-lifecycle.e2e.ts --reporter=list` |
| `test:e2e:team:whitelist`  | `playwright test --config playwright.config.ts tests/e2e/specs/team-whitelist.e2e.ts --reporter=list`       |
| `test:e2e:team:comm`       | `playwright test --config playwright.config.ts tests/e2e/specs/team-communication.e2e.ts --reporter=list`   |
| `prepare`                  | `husky`                                                                                                     |
| `postinstall`              | `node scripts/postinstall.js`                                                                               |
| `test:packaged:bun`        | `vitest run tests/integration/bundled-bun-packaged.test.ts`                                                 |
| `test:bun`                 | `bun test src/process/services/database/drivers/*.bun.test.ts`                                              |
| `server:start`             | `NODE_ENV=development bun dist-server/server.mjs`                                                           |
| `server:start:remote`      | `NODE_ENV=development ALLOW_REMOTE=true bun dist-server/server.mjs`                                         |
| `server:start:prod`        | `NODE_ENV=production bun dist-server/server.mjs`                                                            |
| `server:start:prod:remote` | `NODE_ENV=production ALLOW_REMOTE=true bun dist-server/server.mjs`                                          |
| `server:resetpass`         | `NODE_ENV=development bun dist-server/server.mjs --resetpass`                                               |
| `server:resetpass:prod`    | `NODE_ENV=production bun dist-server/server.mjs --resetpass`                                                |
| `build:renderer:web`       | `bunx vite build --config vite.renderer.config.ts`                                                          |
| `build:server`             | `node scripts/build-server.mjs`                                                                             |

## Build config interaction

Source: `electron.vite.config.ts:1`

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import UnoCSS from 'unocss/vite';
import unoConfig from './uno.config.ts';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Build builtin MCP servers after main process bundle so they survive out/main/ cleanup.
function buildMcpServersPlugin() {
  return {
    name: 'vite-plugin-build-mcp-servers',
    closeBundle() {
      execSync(`node "${resolve('scripts/build-mcp-servers.js')}"`, { stdio: 'inherit' });
    },
  };
}

// Icon Park transform plugin (replaces webpack icon-park-loader)
function iconParkPlugin() {
  return {
    name: 'vite-plugin-icon-park',
    enforce: 'pre' as const,
    transform(source: string, id: string) {
      if (!id.endsWith('.tsx') || id.includes('node_modules')) return null;
      if (!source.includes('@icon-park/react')) return null;
      const transformedSource = source.replace(
        /import\s+\{\s+([a-zA-Z, ]*)\s+\}\s+from\s+['"]@icon-park\/react['"](;?)/g,
        function (str, match) {
          if (!match) return str;
          const components = match.split(',');
          const importComponent = str.replace(
            match,
            components.map((key: string) => `${key} as _${key.trim()}`).join(', ')
          );
          const hoc = `import IconParkHOC from '@renderer/components/IconParkHOC';
          ${components.map((key: string) => `const ${key.trim()} = IconParkHOC(_${key.trim()})`).join(';\n')}`;
          return importComponent + ';' + hoc;
        }
      );
      if (transformedSource !== source) return { code: transformedSource, map: null } as { code: string; map: null };
      return null;
    },
  };
}

// Common path aliases for main process and workers
const mainAliases = {
  '@': resolve('src'),
  '@common': resolve('src/common'),
  '@renderer': resolve('src/renderer'),
  '@process': resolve('src/process'),
  '@worker': resolve('src/process/worker'),
  '@xterm/headless': resolve('src/common/utils/shims/xterm-headless.ts'),
};

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  const enableSentrySourceMaps = !isDevelopment && !!process.env.SENTRY_AUTH_TOKEN;

  const sentryPluginOptions = {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    sourcemaps: {
      filesToDeleteAfterUpload: ['./out/**/*.map'],
      rewriteSources: (source: string) => {
        // Normalize Windows backslashes and strip leading relative prefixes
        // so Sentry paths match the GitHub repo structure (e.g. src/process/...)
```

The main build externalizes dependencies except `fix-path`, copies built-in resources in production, optionally uploads Sentry sourcemaps, and builds MCP servers. Renderer builds include UnoCSS, Icon Park transformation, React/Arco/markdown/editor manual chunks, and MPA entries for main UI plus pet windows.

## Native module handling

The database driver selects `bun:sqlite` only when `process.versions.bun` exists; otherwise it imports `better-sqlite3`.

Source: `src/process/services/database/drivers/createDriver.ts:1`

```typescript
// src/process/services/database/drivers/createDriver.ts

import type { ISqliteDriver } from './ISqliteDriver';

export async function createDriver(dbPath: string): Promise<ISqliteDriver> {
  if (typeof process.versions['bun'] !== 'undefined') {
    // @ts-ignore -- BunSqliteDriver uses bun:sqlite which is not available in tsc's module resolution
    const { BunSqliteDriver } = await import('./BunSqliteDriver');
    return new BunSqliteDriver(dbPath);
  }
  const { BetterSqlite3Driver } = await import('./BetterSqlite3Driver');
  return new BetterSqlite3Driver(dbPath);
```

## Development modes

- `bun run start`: Electron desktop dev.
- `bun run start:multi`: multi-instance Electron dev with `AIONUI_MULTI_INSTANCE=1`.
- `bun run webui`: dev WebUI build after deleting `out/renderer`.
- `bun run server:start`: serve `dist-server/server.mjs` with `NODE_ENV=development`.
- `bun run build-mac:arm64`: package macOS ARM64.

## Areas for Review

- Should Bun and Node versions be pinned in `.tool-versions`, `.node-version`, or Volta metadata?
- Should native module rebuilds be scripted explicitly before packaging to avoid stale `out/` resources?
- Should the lockfile be audited for transitive package drift before release builds?
