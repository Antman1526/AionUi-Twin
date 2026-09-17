/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import fs from 'fs';
import { BasePlugin, type PluginConfirmHandler, type PluginMessageHandler } from '@process/channels/plugins/BasePlugin';
import type { LoadedExtension, ExtChannelPlugin } from '../types';
import { isPathWithinDirectory } from '../sandbox/pathSafety';
import { resolveRuntimeEntryPath } from './utils/entryPointResolver';
import { toAssetUrl } from '../protocol/assetProtocol';
import { getHubInstallRecord, type HubInstallRecord } from '../hub/HubStateManager';
import { tryComputeDirectoryDigest } from '../hub/directoryDigest';
import { getDataPath } from '@process/utils';

/**
 * `@/common/config/storage` binds the platform storage adapter at import time, which
 * standalone/WebUI builds and node tests do not always provide. Load it lazily so the
 * resolver itself stays importable everywhere; consent persistence is best-effort.
 */
const loadConfigStorage = () => import('@/common/config/storage').then((mod) => mod.ConfigStorage);

const DEBUG_ENABLED = process.env.AIONUI_EXTENSION_DEBUG === '1' || process.env.AIONUI_EXTENSION_DEBUG === 'true';

function logSecurity(message: string): void {
  if (DEBUG_ENABLED) {
    console.log(`[Extension Security] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Main-process trust gate
// ---------------------------------------------------------------------------

export type ChannelPluginTrustDecision = { trusted: boolean; reason: string };

/** A consent the user granted, bound to the directory contents they saw. */
export type ChannelPluginConsent = { name: string; directoryDigest: string };

/**
 * Everything the trust gate touches, injected so the decision logic can be
 * tested without Electron, the filesystem, or a real user.
 */
export type ChannelPluginTrustDeps = {
  /** Install record written by HubInstaller after integrity verification. */
  getInstallRecord: (name: string) => HubInstallRecord | undefined;
  /** Consents the user already granted. */
  getConsented: () => ChannelPluginConsent[];
  /** Persist a new consent. */
  addConsent: (consent: ChannelPluginConsent) => void;
  /** Ask the user. Returns true when the extension may be loaded. */
  confirmTrust: (ext: LoadedExtension, pluginTypes: string[], warning?: string) => boolean;
  /** Content fingerprint of an extension directory, or null when unreadable. */
  computeDirectoryDigest: (directory: string) => string | null;
};

const CHANGED_SINCE_INSTALL_WARNING =
  'This extension\u2019s files no longer match what was installed from the Agent Hub. ' +
  'It may have been replaced or modified since.';

/**
 * Decide whether an extension's channel plugins may be loaded into the main
 * process.
 *
 * Trust is bound to the *contents* of `ext.directory`, never to
 * `manifest.name` alone: a sideloaded directory reusing the name of a
 * hub-installed extension must not inherit its verified status. A hub install
 * record counts only when the recorded directory digest still matches, and a
 * remembered consent counts only for the exact directory it was granted for.
 * Anything else asks the user once.
 */
export function evaluateChannelPluginTrust(
  ext: LoadedExtension,
  pluginTypes: string[],
  deps: ChannelPluginTrustDeps
): ChannelPluginTrustDecision {
  const name = ext.manifest.name;
  const digest = deps.computeDirectoryDigest(ext.directory);

  const record = deps.getInstallRecord(name);
  const hasVerifiedRecord = record?.verified === 'integrity' || record?.verified === 'bundled';
  const recordMatchesDirectory = Boolean(digest && record?.directoryDigest && record.directoryDigest === digest);

  if (hasVerifiedRecord && recordMatchesDirectory) {
    return {
      trusted: true,
      reason:
        record?.verified === 'integrity'
          ? 'hub install record with verified integrity and matching directory digest'
          : 'bundled extension with matching directory digest',
    };
  }

  const warning = hasVerifiedRecord ? CHANGED_SINCE_INSTALL_WARNING : undefined;
  if (warning) {
    console.warn(
      `[Extension Security] "${name}" has a ${record?.verified} install record but its directory ` +
        `no longer matches the recorded digest; asking the user before loading its channel plugins.`
    );
  }

  if (digest && deps.getConsented().some((entry) => entry.name === name && entry.directoryDigest === digest)) {
    return { trusted: true, reason: 'previously granted user consent for these exact files' };
  }

  if (deps.confirmTrust(ext, pluginTypes, warning)) {
    // A consent that cannot be bound to a digest is honoured for this load only.
    if (digest) deps.addConsent({ name, directoryDigest: digest });
    return { trusted: true, reason: 'user consent' };
  }

  return { trusted: false, reason: 'no verified install record and the user declined to trust it' };
}

const TRUSTED_PLUGINS_CACHE_FILE = 'trusted-channel-plugins.json';

/**
 * Synchronously readable mirror of `extensions.trustedChannelPluginEntries`.
 *
 * `resolveChannelPlugins()` is synchronous (it is called from the synchronous
 * resolver group in ExtensionRegistry) but `ConfigStorage` is async-only, so the
 * consent list is also cached in a small JSON file next to the other extension
 * state. The config key stays the user-visible/manageable copy and is unioned
 * back into the cache in the background.
 *
 * Entries are `{ name, directoryDigest }`: the cache file itself is not a trust
 * anchor, so a tampered entry only matters if it also names the exact bytes the
 * user approved.
 */
let consentCache: Map<string, ChannelPluginConsent> | null = null;

function consentKey(entry: ChannelPluginConsent): string {
  return `${entry.name}\u0000${entry.directoryDigest}`;
}

function toConsent(value: unknown): ChannelPluginConsent | null {
  if (!value || typeof value !== 'object') return null;
  const { name, directoryDigest } = value as Partial<ChannelPluginConsent>;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof directoryDigest !== 'string' || directoryDigest.length === 0) return null;
  return { name, directoryDigest };
}

function consentCacheFile(): string {
  return path.join(getDataPath(), TRUSTED_PLUGINS_CACHE_FILE);
}

function loadConsentCache(): Map<string, ChannelPluginConsent> {
  if (consentCache) return consentCache;

  const cache = new Map<string, ChannelPluginConsent>();
  try {
    const raw = fs.readFileSync(consentCacheFile(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      // Pre-digest caches held plain names; those cannot be bound to a
      // directory, so they are dropped and the user is asked again.
      for (const entry of parsed) {
        const consent = toConsent(entry);
        if (consent) cache.set(consentKey(consent), consent);
      }
    }
  } catch {
    // Missing or unreadable cache means "nothing consented yet".
  }
  consentCache = cache;

  // Pick up entries added through the config key elsewhere; applies next resolve.
  void loadConfigStorage()
    .then((ConfigStorage) => ConfigStorage.get('extensions.trustedChannelPluginEntries'))
    .then((entries) => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        const consent = toConsent(entry);
        if (consent) cache.set(consentKey(consent), consent);
      }
    })
    .catch((): void => undefined);

  return cache;
}

function persistConsent(consent: ChannelPluginConsent): void {
  const cache = loadConsentCache();
  cache.set(consentKey(consent), consent);
  const entries = [...cache.values()];

  try {
    fs.mkdirSync(path.dirname(consentCacheFile()), { recursive: true });
    fs.writeFileSync(consentCacheFile(), JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[Extension Security] Failed to cache channel plugin consent:', error);
  }

  void loadConfigStorage()
    .then((ConfigStorage) => ConfigStorage.set('extensions.trustedChannelPluginEntries', entries))
    .catch((): void => undefined);
}

/**
 * English-only by necessity: `dialog.showMessageBoxSync` is synchronous, and
 * the main-process i18n lookup is async (it awaits app storage/config), so
 * translating this text would mean threading a promise through the whole
 * synchronous trust-evaluation chain (`evaluateChannelPluginTrust` →
 * `ChannelPluginTrustDeps.confirmTrust` → `resolveChannelPlugins`, which is
 * itself called from a synchronous resolver group — see the comment on
 * `loadConsentCache` above). That's a real restructuring, not a string swap,
 * so it's left as a known gap rather than done partially.
 */
function showTrustDialog(ext: LoadedExtension, pluginTypes: string[], warning?: string): boolean {
  try {
    // Required lazily: this module is also loaded in non-Electron contexts (tests, webserver).
    // eslint-disable-next-line no-eval
    const { dialog } = eval('require')('electron') as typeof import('electron');
    const response = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Cancel', 'Trust and load'],
      defaultId: 0,
      cancelId: 0,
      title: 'Untrusted extension',
      message: `Allow "${ext.manifest.name}" to run channel plugins?`,
      detail:
        (warning ? `${warning}\n\n` : '') +
        `This extension was not installed from the Agent Hub with a verified checksum, ` +
        `so AionUi cannot confirm where its code came from.\n\n` +
        `Channel plugins (${pluginTypes.join(', ')}) run with full main-process privileges: ` +
        `filesystem, network and system command access.\n\n` +
        `Location: ${ext.directory}`,
    });
    return response === 1;
  } catch (error) {
    // No Electron (headless/test) or the dialog failed — fail closed.
    console.warn('[Extension Security] Trust dialog unavailable, refusing channel plugin load:', error);
    return false;
  }
}

/** Production wiring for {@link evaluateChannelPluginTrust}. */
export function createDefaultChannelPluginTrustDeps(): ChannelPluginTrustDeps {
  return {
    getInstallRecord: getHubInstallRecord,
    getConsented: () => [...loadConsentCache().values()],
    addConsent: persistConsent,
    confirmTrust: showTrustDialog,
    computeDirectoryDigest: tryComputeDirectoryDigest,
  };
}

type ChannelPluginEntry = {
  constructor: typeof BasePlugin;
  meta: ExtChannelPlugin;
};

/**
 * Minimal interface that external channel plugins must satisfy.
 * External extensions cannot `import` the internal BasePlugin class, so we
 * use duck-typing to verify they implement the required contract instead of
 * relying on `instanceof BasePlugin`.
 */
const REQUIRED_METHODS = ['start', 'stop', 'sendMessage'] as const;

type LegacyExternalPlugin = {
  start: () => Promise<unknown> | unknown;
  stop: () => Promise<unknown> | unknown;
  sendMessage: (chatId: string, message: unknown) => Promise<string | unknown> | string | unknown;
  editMessage?: (chatId: string, messageId: string, message: unknown) => Promise<unknown> | unknown;
  getActiveUserCount?: () => number;
  getBotInfo?: () => { username?: string; displayName?: string } | null;
  onMessage?: (handler: PluginMessageHandler) => void;
  onConfirm?: (handler: PluginConfirmHandler) => void;
};

function isValidPluginClass(PluginClass: unknown): boolean {
  if (typeof PluginClass !== 'function') return false;
  const proto = (PluginClass as { prototype?: unknown }).prototype;
  if (!proto || typeof proto !== 'object') return false;
  return REQUIRED_METHODS.every((method) => typeof (proto as Record<string, unknown>)[method] === 'function');
}

function createDuckTypedWrapper(
  pluginType: string,
  PluginClass: new (config?: unknown) => LegacyExternalPlugin
): typeof BasePlugin {
  return class ExtensionDuckTypedWrapper extends BasePlugin {
    readonly type = pluginType as any;

    private impl: LegacyExternalPlugin | null = null;

    override onMessage(handler: PluginMessageHandler): void {
      super.onMessage(handler);
      this.impl?.onMessage?.(handler);
    }

    override onConfirm(handler: PluginConfirmHandler): void {
      super.onConfirm(handler);
      this.impl?.onConfirm?.(handler);
    }

    protected async onInitialize(config: import('@process/channels/types').IChannelPluginConfig): Promise<void> {
      this.impl = new PluginClass(config);
      if (this.messageHandler) {
        this.impl.onMessage?.(this.messageHandler);
      }
      if (this.confirmHandler) {
        this.impl.onConfirm?.(this.confirmHandler);
      }
    }

    protected async onStart(): Promise<void> {
      await this.impl?.start();
    }

    protected async onStop(): Promise<void> {
      await this.impl?.stop();
    }

    async sendMessage(
      chatId: string,
      message: import('@process/channels/types').IUnifiedOutgoingMessage
    ): Promise<string> {
      if (!this.impl) throw new Error('Extension plugin is not initialized');
      const result = await this.impl.sendMessage(chatId, message);
      return typeof result === 'string' ? result : `${pluginType}-msg-${Date.now()}`;
    }

    async editMessage(
      chatId: string,
      messageId: string,
      message: import('@process/channels/types').IUnifiedOutgoingMessage
    ): Promise<void> {
      if (!this.impl) throw new Error('Extension plugin is not initialized');
      if (typeof this.impl.editMessage === 'function') {
        await this.impl.editMessage(chatId, messageId, message);
        return;
      }
      await this.impl.sendMessage(chatId, message);
    }

    getActiveUserCount(): number {
      return this.impl?.getActiveUserCount?.() ?? 0;
    }

    getBotInfo(): { username?: string; displayName?: string } | null {
      return this.impl?.getBotInfo?.() ?? null;
    }
  };
}

export function resolveChannelPlugins(
  extensions: LoadedExtension[],
  trustDeps?: ChannelPluginTrustDeps
): Map<string, ChannelPluginEntry> {
  const result = new Map<string, ChannelPluginEntry>();
  let deps: ChannelPluginTrustDeps | undefined = trustDeps;

  for (const ext of extensions) {
    const plugins = ext.manifest.contributes.channelPlugins;
    if (!plugins || plugins.length === 0) continue;

    // Channel plugin code is loaded into the main process (see the note below),
    // so it has to be trusted before `require()` runs.
    deps ??= createDefaultChannelPluginTrustDeps();
    const decision = evaluateChannelPluginTrust(
      ext,
      plugins.map((p) => p.type),
      deps
    );
    if (!decision.trusted) {
      console.warn(
        `[Extension Security] Blocked channel plugins from "${ext.manifest.name}" ` +
          `(${plugins.map((p) => p.type).join(', ')}): ${decision.reason}`
      );
      continue;
    }
    logSecurity(`Channel plugin trust granted for "${ext.manifest.name}": ${decision.reason}`);

    for (const plugin of plugins) {
      const entryPath = resolveRuntimeEntryPath(ext.directory, plugin.entryPoint);
      if (!entryPath) {
        const fallbackPath = path.resolve(ext.directory, plugin.entryPoint);
        if (!isPathWithinDirectory(fallbackPath, ext.directory)) {
          console.warn(`[Extension] Path traversal detected in channel plugin: ${plugin.entryPoint}`);
          continue;
        }
        if (!fs.existsSync(fallbackPath)) {
          console.warn(
            `[Extension] Channel plugin entry not found (dist/source): ${plugin.entryPoint} (${ext.manifest.name})`
          );
          continue;
        }
        console.warn(
          `[Extension] Channel plugin runtime entry resolver failed unexpectedly: ${plugin.entryPoint} (${ext.manifest.name})`
        );
        continue;
      }
      if (result.has(plugin.type)) {
        console.warn(`[Extension] Duplicate channel plugin type "${plugin.type}", skipping`);
        continue;
      }

      logSecurity(
        `Loading channel plugin "${plugin.type}" from: ${entryPath}\n` +
          `  ⚠️  This code will run with FULL process privileges.\n` +
          `  ⚠️  Only load extensions from trusted sources.`
      );

      // Channel plugin code runs in the main process with full Node.js + Electron
      // privileges. Migration to SandboxHost is deferred, not forgotten: the
      // BasePlugin contract the channel gateway consumes cannot be proxied over
      // the SandboxHost message port as it stands —
      //   - `getActiveUserCount(): number` and `getBotInfo(): {...} | null` are
      //     synchronous and have synchronous callers, while the port is async;
      //   - `onMessage()` / `onConfirm()` hand the plugin function callbacks, and
      //     `onInitialize()` receives an IChannelPluginConfig — neither survives
      //     structured cloning.
      // Proxying would mean making those members async across the gateway, which
      // is a larger change than this workstream. Until then, loading is gated on
      // an install record whose archive integrity was verified (or a bundled
      // extension) AND whose recorded directory digest still matches, or on an
      // explicit user consent for those exact bytes, recorded in
      // `extensions.trustedChannelPluginEntries` — see evaluateChannelPluginTrust above.
      // See: docs/specs/extension-market/research/security-model.md
      try {
        // eslint-disable-next-line no-eval
        const nativeRequire = eval('require');
        const mod = nativeRequire(entryPath);

        let PluginClass = mod.default || mod.Plugin;
        // Support module.exports = Class (CommonJS)
        if (!PluginClass && typeof mod === 'function') {
          PluginClass = mod;
        }
        // Fallback: use first exported property
        if (!PluginClass && typeof mod === 'object') {
          const keys = Object.keys(mod);
          if (keys.length > 0) {
            PluginClass = mod[keys[0]];
          }
        }

        // Internal plugins that directly extend BasePlugin pass the instanceof check.
        // External extension plugins cannot import BasePlugin, so we fall back to
        // duck-type validation — they must expose start/stop/sendMessage on prototype.
        const isInternal = PluginClass && PluginClass.prototype instanceof BasePlugin;
        const isDuckValid = !isInternal && isValidPluginClass(PluginClass);

        if (!isInternal && !isDuckValid) {
          console.warn(
            `[Extension] Channel plugin "${plugin.type}": exported class must extend BasePlugin ` +
              `or implement the required methods (${REQUIRED_METHODS.join(', ')})`
          );

          continue;
        }

        const constructor = isInternal
          ? (PluginClass as typeof BasePlugin)
          : createDuckTypedWrapper(plugin.type, PluginClass as new (config?: unknown) => LegacyExternalPlugin);

        // Resolve icon path to absolute URL (aion-asset://) for frontend
        let iconUrl = plugin.icon;
        if (plugin.icon && !plugin.icon.match(/^(https?:|data:|aion-asset:|file:)/)) {
          const absPath = path.resolve(ext.directory, plugin.icon);
          iconUrl = toAssetUrl(absPath);
        }

        result.set(plugin.type, {
          constructor,
          meta: {
            ...plugin,
            icon: iconUrl,
          },
        });
        console.log(
          `[Extension] Loaded channel plugin: ${plugin.type} from ${ext.manifest.name}` +
            (isDuckValid ? ' [duck-typed-wrapped]' : '')
        );
        logSecurity(`Channel plugin "${plugin.type}" loaded successfully`);
      } catch (error) {
        console.error(`[Extension] Failed to load channel plugin "${plugin.type}":`, error);
      }
    }
  }
  return result;
}
