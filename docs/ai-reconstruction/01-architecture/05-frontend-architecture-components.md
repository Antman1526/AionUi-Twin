# 05 - Frontend Architecture & Components

## Renderer entry

The renderer initializes Sentry conditionally, applies runtime patches, registers the browser bridge adapter, initializes i18n/PWA support, then renders React providers and the protected route tree.

Source: `src/renderer/main.tsx:1`

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Sentry must be initialized first
// Use electron-specific renderer package only inside Electron; fall back to the
// browser SDK when running as a standalone web server (no window.electronAPI).
if ((window as { electronAPI?: unknown }).electronAPI) {
  // Dynamic import avoids bundling sentry-ipc:// protocol code into the web build
  import('@sentry/electron/renderer').then((Sentry) => Sentry.init()).catch(() => {});
}

// Runtime patches must be imported early
import './utils/ui/runtimePatches';

// Browser adapter setup
import '@/common/adapter/browser';

// React and core dependencies
import type { PropsWithChildren } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';

// Context providers
import { AuthProvider } from './hooks/context/AuthContext';
import { ThemeProvider } from './hooks/context/ThemeContext';
import { PreviewProvider } from './pages/conversation/Preview/context/PreviewContext';
import { ConversationTabsProvider } from './pages/conversation/hooks/ConversationTabsContext';

// Arco Design
import { ConfigProvider } from '@arco-design/web-react';
// Configure Arco Design to use React 18's createRoot, fixing Message component's CopyReactDOM.render error
import '@arco-design/web-react/es/_util/react-19-adapter';
import '@arco-design/web-react/dist/css/arco.css';
import enUS from '@arco-design/web-react/es/locale/en-US';
import jaJP from '@arco-design/web-react/es/locale/ja-JP';
import zhCN from '@arco-design/web-react/es/locale/zh-CN';
import zhTW from '@arco-design/web-react/es/locale/zh-TW';
import koKR from '@arco-design/web-react/es/locale/ko-KR';
import { useTranslation } from 'react-i18next';

// Styles
import 'uno.css';
import './styles/arco-override.css';
import './styles/themes/index.css';

// i18n
import './services/i18n';
import { registerPwa } from './services/registerPwa';

// Components and utilities
import Layout from './components/layout/Layout';
import Router from './components/layout/Router';
import Sider from './components/layout/Sider';
import { useAuth } from './hooks/context/AuthContext';
import { ConversationHistoryProvider } from './hooks/context/ConversationHistoryContext';
import HOC from './utils/ui/HOC';

// Patch Korean locale with missing properties from English locale
const koKRComplete = {
  ...koKR,
  Calendar: {
    ...koKR.Calendar,
    monthFormat: enUS.Calendar.monthFormat,
    yearFormat: enUS.Calendar.yearFormat,
  },
  DatePicker: {
    ...koKR.DatePicker,
    Calendar: {
      ...koKR.DatePicker.Calendar,
      monthFormat: enUS.Calendar.monthFormat,
      yearFormat: enUS.Calendar.yearFormat,
    },
  },
  Form: enUS.Form,
  ColorPicker: enUS.ColorPicker,
};

const arcoLocales: Record<string, typeof enUS> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKRComplete,
  'en-US': enUS,
};

const AppProviders: React.FC<PropsWithChildren> = ({ children }) =>
  React.createElement(
    AuthProvider,
    null,
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(PreviewProvider, null, React.createElement(ConversationTabsProvider, null, children))
    )
  );

const Config: React.FC<PropsWithChildren> = ({ children }) => {
  const {
    i18n: { language },
  } = useTranslation();
  const arcoLocale = arcoLocales[language] ?? enUS;

  return React.createElement(ConfigProvider, { theme: { primaryColor: '#4E5969' }, locale: arcoLocale }, children);
};

const Main = () => {
  const { ready } = useAuth();

  if (!ready) {
    return null;
  }

  return (
```

## Provider hierarchy

`AppProviders` wraps:

1. `AuthProvider` for WebUI/desktop auth readiness.
2. `ThemeProvider` for theme/color/custom CSS state.
3. `PreviewProvider` for conversation file preview state.
4. `ConversationTabsProvider` for multi-tab conversation UI state.

`ConfigProvider` from Arco supplies locale and primary color `#4E5969`. Korean locale is patched from English for missing Arco keys.

## Routing

Source: `src/renderer/components/layout/Router.tsx:1`

```typescript
import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const AssistantSettings = React.lazy(() => import('@renderer/pages/settings/AssistantSettings'));
const CapabilitiesSettings = React.lazy(() => import('@renderer/pages/settings/CapabilitiesSettings'));
const DisplaySettings = React.lazy(() => import('@renderer/pages/settings/DisplaySettings'));
const AionrsSettings = React.lazy(() => import('@renderer/pages/settings/AionrsSettings'));
const GeminiSettings = React.lazy(() => import('@renderer/pages/settings/GeminiSettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));
const PetSettings = React.lazy(() => import('@renderer/pages/settings/PetSettings'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const TeamIndex = React.lazy(() => import('@renderer/pages/team'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route path='/settings/aionrs' element={withRouteFallback(AionrsSettings)} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/gemini' element={withRouteFallback(GeminiSettings)} />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/settings/assistants' element={withRouteFallback(AssistantSettings)} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/capabilities' element={withRouteFallback(CapabilitiesSettings)} />
          {/* Legacy routes — redirect to the merged /settings/capabilities page */}
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/capabilities?tab=skills' replace />} />
          <Route path='/settings/tools' element={<Navigate to='/settings/capabilities?tab=tools' replace />} />
          <Route path='/settings/display' element={withRouteFallback(DisplaySettings)} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/pet' element={withRouteFallback(PetSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/gemini' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:jobId' element={withRouteFallback(TaskDetailPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
```

Routes are protected by `ProtectedLayout`; unauthenticated users are redirected to `/login`. Routes are lazy loaded with `Suspense` and `AppLoader`.

| Route                             | Page                                                |
| --------------------------------- | --------------------------------------------------- |
| `/guid`                           | Agent/assistant start page.                         |
| `/conversation/:id`               | Main chat workspace.                                |
| `/team/:id`                       | Team session page when `TEAM_MODE_ENABLED` is true. |
| `/settings/model`                 | Model provider settings.                            |
| `/settings/agent`                 | Agent settings.                                     |
| `/settings/capabilities`          | Skills/tools capability settings.                   |
| `/settings/display`               | Theme/font/zoom display settings.                   |
| `/settings/webui`                 | WebUI server settings.                              |
| `/scheduled`, `/scheduled/:jobId` | Cron job list/detail.                               |

## Layout behavior

The layout manages side navigation width, mobile detection, custom CSS injection, update modal mounting, deep-link handling, notification clicks, directory selection, multi-agent detection, and keyboard shortcuts.

Source: `src/renderer/components/layout/Layout.tsx:87`

```typescript
  onSessionClick?: () => void;
}> = ({ sider, onSessionClick: _onSessionClick }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 390 : window.innerWidth
  );
  const [customCss, setCustomCss] = useState<string>('');
  const [shouldMountUpdateModal, setShouldMountUpdateModal] = useState(false);
  const { onClick } = useDebug();
  const { contextHolder: multiAgentContextHolder } = useMultiAgentDetection();
  const { contextHolder: directorySelectionContextHolder } = useDirectorySelection();
  useDeepLink();
  useNotificationClick();
  const navigate = useNavigate();
  useConversationShortcuts({ navigate });
  const location = useLocation();
  const workspaceAvailable =
    location.pathname.startsWith('/conversation/') || (TEAM_MODE_ENABLED && location.pathname.startsWith('/team/'));
  const collapsedRef = useRef(collapsed);
  const lastCssRef = useRef('');
  const lastUiCssUpdateAtRef = useRef(0);
  const dragStateRef = useRef<{ active: boolean; startX: number; startWidth: number }>({
    active: false,
    startX: 0,
    startWidth: DEFAULT_SIDER_WIDTH,
  });

  const loadAndHealCustomCss = useCallback(async () => {
    try {
      const [savedCssRaw, activeThemeId, savedThemes] = await Promise.all([
        ConfigStorage.get('customCss'),
        ConfigStorage.get('css.activeThemeId'),
        ConfigStorage.get('css.themes'),
      ]);

      const decision = computeCssSyncDecision({
        savedCss: savedCssRaw || '',
        activeThemeId: activeThemeId || '',
        savedThemes: (savedThemes || []) as ICssTheme[],
        currentUiCss: customCss,
        lastUiCssUpdateAt: lastUiCssUpdateAtRef.current,
      });

      if (decision.shouldSkipApply) {
        return;
      }

      let effectiveCss = decision.effectiveCss;

      // If the active theme resolved to empty CSS and there IS a saved activeThemeId
      // (but it no longer matches any known theme), fall back to default and persist.
      if (!effectiveCss && activeThemeId && activeThemeId !== 'default-theme') {
        const defaultCss = resolveCssByActiveTheme('default-theme', (savedThemes || []) as ICssTheme[]);
        effectiveCss = defaultCss;
        // Persist the fallback so Layout doesn't keep retrying
        await Promise.all([
          ConfigStorage.set('css.activeThemeId', 'default-theme'),
          ConfigStorage.set('customCss', effectiveCss),
        ]).catch((error) => {
          console.warn('Failed to persist theme fallback:', error);
        });
      } else if (decision.shouldHealStorage) {
        await ConfigStorage.set('customCss', effectiveCss).catch((error) => {
          console.warn('Failed to heal custom CSS from active theme:', error);
        });
      }

      setCustomCss(effectiveCss);
      if (lastCssRef.current !== effectiveCss) {
        lastCssRef.current = effectiveCss;
        window.dispatchEvent(new CustomEvent('custom-css-updated', { detail: { customCss: effectiveCss } }));
      }
    } catch (error) {
      console.error('Failed to load or heal custom CSS:', error);
    }
  }, [customCss]);

  // 加载并监听自定义 CSS 配置 / Load & watch custom CSS configuration
  useEffect(() => {
    void loadAndHealCustomCss();

    const handleCssUpdate = (event: CustomEvent) => {
      if (event.detail?.customCss !== undefined) {
        const css = event.detail.customCss || '';
        lastCssRef.current = css;
        lastUiCssUpdateAtRef.current = Date.now();
        setCustomCss(css);
      }
    };
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key && (event.key.includes('customCss') || event.key.includes('css.activeThemeId'))) {
        void loadAndHealCustomCss();
      }
```

## Design system rules

- Interactive UI must use `@arco-design/web-react` components, not raw `button/input/select` in application surfaces.
- Icons are from `@icon-park/react` and transformed by Vite into `IconParkHOC` wrappers.
- Styles prefer UnoCSS semantic tokens; complex styles use CSS modules or global files under `src/renderer/styles`.
- Global themes live in `src/renderer/styles/themes`; custom CSS is persisted in `ConfigStorage` and injected as `#user-defined-custom-css`.

## Important component groups

| Directory             | Responsibility                                                               |
| --------------------- | ---------------------------------------------------------------------------- |
| `components/Markdown` | Markdown, code block, Mermaid, KaTeX, and streaming render support.          |
| `components/chat`     | Send box, slash command menu, speech button, command queue, thought display. |
| `components/media`    | File preview, diff viewer, webview host, file attach/upload UI.              |
| `components/settings` | Reusable settings controls and modals.                                       |
| `pages/conversation`  | Main chat/conversation workflow.                                             |
| `pages/settings`      | Agent/model/system/capabilities/settings pages.                              |
| `pages/team`          | Team/multi-agent UI.                                                         |
| `pages/cron`          | Scheduled task list and detail views.                                        |
| `pet`                 | Separate pet windows and confirmation UIs.                                   |

## Local LLM settings UI specifics

`MODEL_PLATFORMS` includes Ollama and LM Studio presets. Add/edit modal validation allows empty API keys when `supportsNoApiKeyForOpenAICompatibleProvider(baseUrl)` returns true.

Source: `src/renderer/utils/model/modelPlatforms.ts:48`

```typescript
 * 模型平台配置接口
 * Model Platform Configuration Interface
 */
export interface PlatformConfig {
  /** 平台名称 / Platform name */
  name: string;
  /** 平台值（用于表单） / Platform value (for form) */
  value: string;
  /** Logo 路径 / Logo path */
  logo: string | null;
  /** 平台标识 / Platform identifier */
  platform: PlatformType;
  /** Base URL（预设供应商使用） / Base URL (for preset providers) */
  baseUrl?: string;
  /** 国际化 key（可选，用于需要翻译的平台名称） / i18n key (optional, for platform names that need translation) */
  i18nKey?: string;
}

/**
 * 模型平台选项列表
 * Model Platform options list
 *
 * 顺序：
 * 1. Gemini (官方)
 * 2. Gemini Vertex AI
 * 3. 自定义（需要用户输入 base url）
 * 4+ 预设供应商
 */
export const MODEL_PLATFORMS: PlatformConfig[] = [
  // 自定义选项（需要用户输入 base url）/ Custom option (requires user to input base url)
  { name: 'Custom', value: 'custom', logo: null, platform: 'custom', i18nKey: 'settings.platformCustom' },

  // New API 多模型网关 / New API multi-model gateway
  { name: 'New API', value: 'new-api', logo: NewApiLogo, platform: 'new-api', i18nKey: 'settings.platformNewApi' },

  // 本地 OpenAI 兼容模型服务 / Local OpenAI-compatible model servers
  { name: 'Ollama', value: 'Ollama', logo: null, platform: 'custom', baseUrl: 'http://localhost:11434/v1' },
  { name: 'LM Studio', value: 'LM-Studio', logo: null, platform: 'custom', baseUrl: 'http://localhost:1234/v1' },

  // 官方 Gemini 平台
  {
```

## State and data access

- `ConfigStorage`, `ChatStorage`, and `ChatMessageStorage` from `@office-ai/platform/storage` persist settings and chat-related state.
- IPC bridge providers drive server state: conversations, models, MCP, settings, tasks, webui, extensions, updates, files.
- SWR is used for cached asynchronous lists where hooks need freshness.
- Custom contexts hold auth, conversation history, layout, navigation history, theme, preview, and tabs.

## Areas for Review

- Should settings pages be split further to reduce route/component size and improve lazy chunking?
- Should local LLM validation be represented as a shared form rule hook to avoid modal duplication?
- Should Arco locale patching be moved to a dedicated utility with tests?
