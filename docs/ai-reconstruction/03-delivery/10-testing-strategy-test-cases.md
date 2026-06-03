# 10 - Testing Strategy & Test Cases

## Test framework

AionUi uses Vitest 4 with two projects: Node for process/common/integration tests and jsdom for renderer DOM tests. Playwright covers e2e flows.

Source: `vitest.config.ts:1`

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

const aliases = {
  '@/': path.resolve(__dirname, './src') + '/',
  '@process/': path.resolve(__dirname, './src/process') + '/',
  '@renderer/': path.resolve(__dirname, './src/renderer') + '/',
  '@worker/': path.resolve(__dirname, './src/process/worker') + '/',
  '@mcp/models/': path.resolve(__dirname, './src/common/models') + '/',
  '@mcp/types/': path.resolve(__dirname, './src/common') + '/',
  '@mcp/': path.resolve(__dirname, './src/common') + '/',
};

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    globals: true,
    testTimeout: 10000,
    // Use projects to run different environments (Vitest 4+)
    projects: [
      // Node environment tests (existing tests)
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/unit/**/*.test.ts',
            'tests/unit/**/test_*.ts',
            'tests/integration/**/*.test.ts',
            'tests/regression/**/*.test.ts',
          ],
          exclude: ['tests/unit/**/*.dom.test.ts', 'tests/unit/**/*.dom.test.tsx'],
          setupFiles: ['./tests/vitest.setup.ts'],
        },
      },
      // jsdom environment tests (React component/hook tests)
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/unit/**/*.dom.test.ts', 'tests/unit/**/*.dom.test.tsx'],
          setupFiles: ['./tests/vitest.dom.setup.ts'],
        },
      },
    ],
    benchmark: {
      include: ['tests/bench/**/*.bench.ts'],
      outputFile: './bench-results.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Cover ALL source code by default — new files are automatically included.
      // Only exclude files that genuinely cannot be unit-tested (entry points,
      // type-only files, static assets, etc.).
      include: ['src/**/*.{ts,tsx}', 'scripts/prepareBundledBun.js'],
      exclude: [
```

## Test commands

| Command                                                                                                                                                                                   | Purpose                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `bun run test`                                                                                                                                                                            | Full Vitest suite. Required before commits by repo policy. |
| `bunx vitest run tests/unit/localModelProviders.test.ts tests/unit/bridge/modelBridge.test.ts tests/unit/ClientFactory.localModels.test.ts tests/unit/modelPlatforms.localModels.test.ts` | Focused local-LLM regression suite.                        |
| `bunx tsc --noEmit`                                                                                                                                                                       | Type checking.                                             |
| `bun run lint`                                                                                                                                                                            | Oxlint check.                                              |
| `bun run format:check` or `bunx oxfmt --check <files>`                                                                                                                                    | Formatting check.                                          |
| `bun run test:e2e`                                                                                                                                                                        | Playwright e2e suite.                                      |
| `bun test src/process/services/database/drivers/*.bun.test.ts`                                                                                                                            | Bun SQLite driver tests.                                   |
| `bunx vitest run tests/integration/bundled-bun-packaged.test.ts`                                                                                                                          | Packaged Bun resource validation.                          |

## Setup files

- `tests/vitest.setup.ts`: Node test globals/mocks.
- `tests/vitest.dom.setup.ts`: jsdom test setup for renderer components.
- Coverage includes `src/**/*.{ts,tsx}` and excludes declarations, Electron entry points, shims, type-only files, renderer CSS/SVG/JSON, and i18n JSON.

## Existing local LLM tests

Current uncommitted tests added for local no-key support:

- `tests/unit/localModelProviders.test.ts`: loopback detection, first-key extraction, placeholder key behavior.
- `tests/unit/ClientFactory.localModels.test.ts`: OpenAI-compatible client receives placeholder key for local providers with empty key.
- `tests/unit/modelPlatforms.localModels.test.ts`: Ollama and LM Studio presets exist with correct base URLs.
- `tests/unit/bridge/modelBridge.test.ts`: model listing supports local Ollama endpoint without user API key.

## Representative test pattern

Source: `src/process/services/database/drivers/BunSqliteDriver.bun.test.ts:1`

```typescript
// src/process/services/database/drivers/BunSqliteDriver.bun.test.ts
// Run with: bun test src/process/services/database/drivers/BunSqliteDriver.bun.test.ts

import { describe, it, expect, afterEach } from 'bun:test';
import { BunSqliteDriver } from './BunSqliteDriver';

describe('BunSqliteDriver', () => {
  let driver: BunSqliteDriver;

  afterEach(() => {
    driver?.close();
  });

  it('exec and prepare().get() roundtrip', () => {
    driver = new BunSqliteDriver(':memory:');
    driver.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
    driver.prepare('INSERT INTO t (val) VALUES (?)').run('hello');
    const row = driver.prepare('SELECT val FROM t WHERE id = 1').get() as { val: string };
    expect(row.val).toBe('hello');
  });

  it('prepare().all() returns array', () => {
    driver = new BunSqliteDriver(':memory:');
    driver.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
    driver.prepare('INSERT INTO t (val) VALUES (?)').run('a');
    driver.prepare('INSERT INTO t (val) VALUES (?)').run('b');
    const rows = driver.prepare('SELECT val FROM t ORDER BY id').all() as Array<{ val: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].val).toBe('a');
    expect(rows[1].val).toBe('b');
  });

  it('prepare().run() returns changes and lastInsertRowid', () => {
    driver = new BunSqliteDriver(':memory:');
    driver.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
    const result = driver.prepare('INSERT INTO t (val) VALUES (?)').run('x');
    expect(result.changes).toBe(1);
    expect(Number(result.lastInsertRowid)).toBe(1);
  });

  it('pragma() getter with simple:true returns scalar', () => {
    driver = new BunSqliteDriver(':memory:');
    const mode = driver.pragma('journal_mode', { simple: true });
    expect(typeof mode).toBe('string');
  });

  it('pragma() setter does not throw', () => {
    driver = new BunSqliteDriver(':memory:');
    expect(() => driver.pragma('foreign_keys = ON')).not.toThrow();
  });

  it('pragma() getter without options returns array', () => {
    driver = new BunSqliteDriver(':memory:');
    const result = driver.pragma('foreign_key_check');
    expect(Array.isArray(result)).toBe(true);
  });

```

Tests use direct driver/unit construction for deterministic behavior. DOM tests use `*.dom.test.tsx` and are routed to the jsdom project.

## Integration test categories

| Directory                                        | Purpose                                               |
| ------------------------------------------------ | ----------------------------------------------------- |
| `tests/integration/process/acp/session`          | ACP session lifecycle and prompts.                    |
| `tests/integration/team-*`                       | Team real components, MCP server, concurrency/stress. |
| `tests/integration/i18n*`                        | i18n behavior and packaged i18n assets.               |
| `tests/integration/webui-*`                      | WebUI favicon/PWA build behavior.                     |
| `tests/integration/bundled-bun-packaged.test.ts` | Packaged Bun resource presence.                       |

## E2E support

`tests/e2e/helpers` contains bridge, navigation, selectors, screenshots, conversation, assistant settings, extensions, team config, and assertions helpers. Feature folders track remote channels, workspaces, settings, teams, previews, and conversations.

## Known verification status from handoff

Passed previously:

- Focused local LLM Vitest command.
- `bunx tsc --noEmit`.
- `bun run lint`.
- Changed-file `oxfmt --check`.
- Packaged Bun integration test after generated resources were prepared.

Known full-suite caveat: a later full `bun run test` failed on three unrelated timeout/flaky tests that passed when rerun directly: `ChannelModelSelectionRestore.dom.test.tsx`, `renderer/i18n.index.dom.test.ts`, and `acpBuiltinMcp.test.ts`.

## Reconstruction test matrix

1. Database: create in-memory DB, run schema/migrations, assert user/conversation/message CRUD and corruption guard classification.
2. Auth: test password validation, missing-user constant-time path, JWT issue/refresh/blacklist, cookie/header extraction.
3. Bridge: test provider name registration and Electron/WebSocket adapter parity.
4. Local providers: test loopback no-key and cloud requires key.
5. ACP: test valid/invalid state transitions, suspended prompt queue, permission resolver, process startup failure handling.
6. Cron: test one-job-per-conversation, orphan cleanup, backfill, retry and next-run calculation.
7. Renderer: test protected routing, settings validation, send box file handling, custom CSS injection.
8. Packaging: test built resources under `out/`, renderer assets, MCP server bundle, app version, DMG existence/checksum.

## Areas for Review

- Should flaky DOM tests be isolated with longer timeouts or fake timers?
- Should package build tests run in CI after every packaging script change?
- Should bridge contracts have generated runtime validators and contract tests?
