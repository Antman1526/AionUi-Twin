# 13 - Performance Optimization & Caching

## Startup performance

- `configureChromium` is imported before modules that call `app.getPath('userData')` because Electron caches paths on first use.
- Single-instance lock is acquired early to avoid unnecessary initialization in duplicate launches.
- Shell environment diagnostics run fire-and-forget so startup is not blocked.
- `appReadyDone` prevents macOS activate events from creating windows before storage initialization finishes.

## SQLite performance

Schema initialization enables:

- `PRAGMA foreign_keys = ON`.
- `PRAGMA busy_timeout = 5000`.
- `PRAGMA journal_mode = WAL` when available.

Indexes cover user lookup, conversation lists by user/update/type/source/channel, message lookup by conversation/time/type/msg_id, cron scheduling, team lookup, mailbox unread lookup, and ACP session status/suspension/agent ID.

## Query and search behavior

Message search parses JSON content recursively into plain text preview, escapes LIKE wildcards, and paginates. FTS support was removed/skipped and is documented as a future reimplementation when search UI requires it.

## Renderer chunking

Source: `electron.vite.config.ts:171`

```typescript
        // not to the WebUI proxy server (which would reject the WebSocket and cause infinite reload).
        // Port is omitted so it automatically matches the server port.
        hmr: {
          host: 'localhost',
        },
      },
      resolve: {
        alias: {
          '@': resolve('src'),
          '@common': resolve('src/common'),
          '@renderer': resolve('src/renderer'),
          '@process': resolve('src/process'),
          '@worker': resolve('src/process/worker'),
          // Force ESM version of streamdown
          streamdown: resolve('node_modules/streamdown/dist/index.js'),
        },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
        dedupe: ['react', 'react-dom', 'react-router-dom'],
      },
      plugins: [
        UnoCSS(unoConfig),
        iconParkPlugin(),
        ...(enableSentrySourceMaps ? [sentryVitePlugin(sentryPluginOptions)] : []),
      ],
      build: {
        target: 'es2022',
        sourcemap: enableSentrySourceMaps ? 'hidden' : isDevelopment,
        minify: !isDevelopment,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 1500,
        cssCodeSplit: true,
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html'),
            pet: resolve('src/renderer/pet/pet.html'),
            'pet-hit': resolve('src/renderer/pet/pet-hit.html'),
            'pet-confirm': resolve('src/renderer/pet/pet-confirm.html'),
```

Heavy dependencies are split into stable vendor chunks: React, Arco, Markdown, syntax highlighting, Monaco/CodeMirror, KaTeX, icons, and diff renderer.

## Virtualized rendering

`react-virtuoso` is included for large chat/list rendering. Long conversation histories should use virtualization and incremental streaming rather than rendering all messages synchronously.

## IPC/WebSocket backpressure

- Main bridge rejects serialized payloads > 50 MB.
- Browser WebSocket adapter queues outbound messages until connected.
- Bridge events are broadcast to all Electron windows and WebSocket clients; avoid high-frequency large events.

## Agent idle reclamation

`WorkerTaskManager` kills finished ACP/AionRS agents after 5 minutes idle by default, checking every 1 minute. `AcpRuntime` has its own `IdleReclaimer` defaulting to 5 minutes idle and 30 second checks.

## Cron performance

Cron jobs use indexed `next_run_at` for enabled jobs, keep retry timers separately from primary timers, and optionally use a power-save blocker when configured to keep scheduled work reliable.

## WebUI proxy performance

Office/PPT preview proxies stream non-HTML responses and buffer only HTML so they can inject a navigation guard. Proxy request timeout is 30 seconds.

## Areas for Review

- Should message streaming use chunk coalescing to reduce renderer event pressure?
- Should search restore FTS5 once message counts grow beyond LIKE performance limits?
- Should Electron builder analyze bundle sizes in CI and enforce chunk budgets?
