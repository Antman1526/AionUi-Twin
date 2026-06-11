# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Layout

```text
src/common      shared types, config, API clients, adapters, utilities
src/preload     Electron contextBridge entry points
src/process     main process services, database, webserver, bridges, agents, channels, teams
src/renderer    React UI, hooks, pages, components, styles, PWA support
mobile          Expo Router mobile app
scripts         build, release, benchmark, i18n, automation
docs            architecture, guides, PRDs, specs, generated twin docs
resources       icons, bundled runtimes, installer resources, README media
public          public renderer/PWA/pet assets
tests           unit, integration, regression, e2e, benchmark tests
```

Local rules: keep process/preload/renderer boundaries; use Arco for UI controls; use Icon Park for icons; prefer UnoCSS; all user text uses i18n; path aliases include `@`, `@process`, `@renderer`, `@worker`; strict TypeScript; no `any`; prefer `type` over `interface`.

Rebuild order: configs, shared types, database, Electron process, preload bridge, IPC domains, agent managers, WebUI auth/routes, renderer shell/pages, extensions/channels/team mode, mobile, tests, packaging.

## Feature Ownership Map

| Feature | Main files |
| ------- | ---------- |
| Local GGUF discovery | `src/process/services/localModels/LocalModelDiscoveryService.ts`, `defaultModelDirectories.ts` |
| Local GGUF runtime | `src/process/services/localModels/LocalModelRuntimeService.ts` |
| Local GGUF IPC | `src/process/bridge/localModelBridge.ts`, `src/common/adapter/ipcBridge.ts` |
| Local GGUF UI | `src/renderer/components/settings/SettingsModal/contents/LocalGgufModels.tsx` |
| Model selection | `src/renderer/pages/guid/hooks/useGuidModelSelection.ts` |
| Provider config | `src/common/config/storage.ts`, `src/common/utils/localModelProviders.ts` |
| AionRS env | `src/process/agent/aionrs/envBuilder.ts`, `src/process/task/AionrsManager.ts` |
| Database | `src/process/services/database/schema.ts`, `migrations.ts`, repositories |
| WebUI auth/API | `src/process/webserver/routes`, `src/process/webserver/auth` |
| Packaging | `electron.vite.config.ts`, `electron-builder.yml`, `scripts/build-with-builder.js` |

## Areas for Review

- Reconcile 10-child directory rule with current large directories.
- Co-locate bridge/service/tests by feature to reduce central bridge sprawl.
- Decide whether generated docs stay in repo or separate audit repo.
- Consider feature folders for local models and providers to reduce cross-tree edits.
