# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Renderer Architecture

The renderer is React 19 + Arco Design + UnoCSS + i18next + React Router. It can run inside Electron or through WebUI/PWA. Electron-only setup is guarded by `window.electronAPI`; Sentry Electron renderer is dynamically imported only when that object exists.

Provider hierarchy in `src/renderer/main.tsx`: `AuthProvider`, `ThemeProvider`, `PreviewProvider`, `ConversationTabsProvider`, Arco `ConfigProvider`, `ConversationHistoryProvider`, `Layout`, `Sider`, and `Router`.

```tsx
const Main = () => {
  const { ready } = useAuth();
  if (!ready) return null;
  return (
    <Router
      layout={
        <ConversationHistoryProvider>
          <Layout sider={<Sider />} />
        </ConversationHistoryProvider>
      }
    />
  );
};
```

Major UI directories: `components/layout`, `components/chat`, `pages/conversation`, `pages/settings`, `pages/team`, `pages/cron`, `pages/guid`, `pages/login`, `pet`, `hooks/context`, `services`, and `styles/themes`.

Build-time renderer chunks split React, Arco, markdown, syntax highlighter, Monaco/CodeMirror, KaTeX, icons, and diff2html. This supports WebUI caching and reduces monolithic vendor bundles.

## Local GGUF UI

`src/renderer/components/settings/SettingsModal/contents/LocalGgufModels.tsx`
is the control surface for model roots, scanning, runtime options, loading, and
unloading. It uses SWR keys for discovered models, runtime status, directories,
and saved runtime options. A successful load mutates status and model config so
chat pages can see the managed provider.

`src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx` watches
`localModel.getStatus` and compares the current selected model to the runtime
base URL/name. `useGuidModelSelection.ts` stores defaults per provider agent and
contains special handling for managed local provider ids:

```ts
if (typeof id === 'string' && id.startsWith(MANAGED_LOCAL_PROVIDER_PREFIX)) {
  const replacementLocal = modelList.find(
    (m) => m.id?.startsWith(MANAGED_LOCAL_PROVIDER_PREFIX) && m.model.includes(useModel)
  );
}
```

## Areas for Review

- Replace `ready ? UI : null` with explicit loading/error states.
- Add typed IPC hooks so pages do not depend on stringly bridge names.
- Reassess chunk boundaries with production bundle analysis.
- Add a persistent loading indicator while `llama-server` is starting large models.
