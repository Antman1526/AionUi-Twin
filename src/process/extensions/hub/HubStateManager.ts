import type { HubExtensionStatus, IHubAgentItem, IHubExtension } from '@/common/types/hub';
import { agentRegistry } from '@process/agent/AgentRegistry';
import { isAgentKind } from '@/common/types/detectedAgent';
import { ipcBridge } from '@/common';
import { ExtensionRegistry } from '@process/extensions/ExtensionRegistry';
import { loadPersistedStates, savePersistedStates } from '@process/extensions/lifecycle/statePersistence';
import { getDataPath } from '@process/utils';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Install records (supply-chain trust)
// ---------------------------------------------------------------------------

/**
 * What the installer recorded about an extension archive at install time.
 * Written by HubInstaller only after the archive passed integrity verification
 * (or was accepted as a bundled archive without an integrity value).
 */
export type HubInstallRecord = {
  name: string;
  version?: string;
  /** The SRI string that the downloaded archive was verified against. */
  integrity?: string;
  /** How the archive earned trust at install time. */
  verified: 'integrity' | 'bundled';
  /**
   * Content fingerprint of the installed directory (`computeDirectoryDigest`).
   *
   * Binds the record to the bytes on disk. A record without one predates this
   * field and is treated as unverifiable by the channel-plugin trust gate.
   */
  directoryDigest?: string;
  /** ISO timestamp. */
  installedAt: string;
};

type HubInstallRecordsFile = {
  version: 1;
  records: Record<string, HubInstallRecord>;
};

const HUB_INSTALL_RECORDS_FILE_ENV = 'AIONUI_HUB_INSTALL_RECORDS_FILE';
const DEFAULT_HUB_INSTALL_RECORDS_FILE = 'hub-install-records.json';

/** Record keys that would poison the records object when assigned. */
const FORBIDDEN_RECORD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * True only inside a test runner.
 *
 * The records file drives the channel-plugin trust gate, so an environment
 * variable must not be able to point it at an attacker-writable path in a
 * shipped build.
 */
function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

/**
 * Location of the install-record store.
 *
 * `AIONUI_HUB_INSTALL_RECORDS_FILE` overrides it **in tests only** — honouring
 * it in production would let anything that can set an environment variable
 * supply its own "verified" install records.
 */
export function getHubInstallRecordsFile(): string {
  if (isTestEnvironment()) {
    const override = process.env[HUB_INSTALL_RECORDS_FILE_ENV]?.trim();
    if (override) return path.resolve(override);
  }
  return path.join(getDataPath(), DEFAULT_HUB_INSTALL_RECORDS_FILE);
}

/**
 * Read every install record. Returns an empty map when the store is missing or
 * unreadable — a missing record means "not verified", never "trusted".
 */
export function readHubInstallRecords(): Record<string, HubInstallRecord> {
  try {
    const raw = fs.readFileSync(getHubInstallRecordsFile(), 'utf-8');
    const parsed = JSON.parse(raw) as HubInstallRecordsFile;
    if (parsed?.version !== 1 || typeof parsed.records !== 'object' || parsed.records === null) return {};
    return parsed.records;
  } catch {
    return {};
  }
}

/** Read the install record for a single extension, if one exists. */
export function getHubInstallRecord(name: string): HubInstallRecord | undefined {
  return readHubInstallRecords()[name];
}

/**
 * Persist (or replace) the install record for a single extension.
 *
 * @throws When the record name is one that would mutate the records object's
 *   prototype instead of adding an entry.
 */
export function writeHubInstallRecord(record: HubInstallRecord): void {
  if (FORBIDDEN_RECORD_NAMES.has(record.name)) {
    throw new Error(`[HubStateManager] Refusing to store an install record named "${record.name}"`);
  }

  // Spread, not mutation of the parsed object: a `__proto__` key coming from
  // the file stays an own property here instead of reaching the prototype.
  const records: Record<string, HubInstallRecord> = { ...readHubInstallRecords() };
  records[record.name] = record;

  const file = getHubInstallRecordsFile();
  const payload: HubInstallRecordsFile = { version: 1, records };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Unique temp name: two concurrent writers sharing `${file}.tmp` would
    // rename each other's half-written file into place.
    const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tmpFile, file);
  } catch (error) {
    console.error('[HubStateManager] Failed to persist install record:', error);
  }
}

/**
 * Compare a hub index entry against what was recorded at install time.
 *
 * Integrity is the primary fingerprint; the version is only consulted when the
 * index entry carries no integrity value (or the record predates one), because
 * a republished archive keeps its version but changes its hash.
 */
export function isUpdateAvailable(
  ext: Pick<IHubExtension, 'version' | 'dist'>,
  record: HubInstallRecord | undefined
): boolean {
  if (!record) return false;

  const indexIntegrity = ext.dist?.integrity?.trim();
  const recordedIntegrity = record.integrity?.trim();
  if (indexIntegrity && recordedIntegrity) {
    return indexIntegrity !== recordedIntegrity;
  }

  if (ext.version && record.version) {
    return ext.version !== record.version;
  }

  return false;
}

/**
 * HubStateManager
 *
 * Manages transient in-memory states (installing/uninstalling), persistent
 * error tracking, and derives runtime status for hub extensions.
 */
class HubStateManagerImpl {
  // Store transient statuses during active installation or uninstallation
  private transientStates = new Map<string, HubExtensionStatus>();

  // ---------------------------------------------------------------------------
  // Transient state
  // ---------------------------------------------------------------------------

  public getTransientState(name: string): HubExtensionStatus | undefined {
    return this.transientStates.get(name);
  }

  public setTransientState(name: string, status: HubExtensionStatus, error?: string) {
    if (status === 'installing' || status === 'uninstalling') {
      this.transientStates.set(name, status);
    } else {
      // Clear transient state when reaching a final state
      this.transientStates.delete(name);
    }

    // Sync to persistent store if it's an error state
    if (status === 'install_failed' && error) {
      this.setPersistentInstallError(name, error);
    } else if (status === 'installed' || status === 'installing') {
      this.clearPersistentInstallError(name);
    }

    // Broadcast state change to renderer
    ipcBridge.hub.onStateChanged.emit({ name, status, error });
  }

  // ---------------------------------------------------------------------------
  // Install records
  // ---------------------------------------------------------------------------

  /** Record a verified install so update detection and trust checks can use it. */
  public recordInstall(record: HubInstallRecord): void {
    writeHubInstallRecord(record);
  }

  /** Read the install record for an extension, if one exists. */
  public getInstallRecord(name: string): HubInstallRecord | undefined {
    return getHubInstallRecord(name);
  }

  // ---------------------------------------------------------------------------
  // Persistent error state
  // ---------------------------------------------------------------------------

  public async getPersistentInstallError(name: string): Promise<string | undefined> {
    const states = await loadPersistedStates();
    return states.get(name)?.installError;
  }

  private async setPersistentInstallError(name: string, error: string) {
    const states = await loadPersistedStates();
    const extState = states.get(name) || { enabled: true };

    states.set(name, { ...extState, installError: error });

    savePersistedStates(states);
  }

  private async clearPersistentInstallError(name: string) {
    const states = await loadPersistedStates();
    const extState = states.get(name);

    if (extState?.installError) {
      states.set(name, { ...extState, installError: undefined });
      savePersistedStates(states);
    }
  }

  // ---------------------------------------------------------------------------
  // Status derivation
  // ---------------------------------------------------------------------------

  /**
   * Returns the full extension list with runtime status derived from
   * ExtensionRegistry, AcpDetector, transient states, and persistent errors.
   *
   * Refreshes builtin agent detection before reading so that CLI changes
   * (install/uninstall) since last check are reflected immediately.
   */
  public async getExtensionListWithStatus(extensions: Record<string, IHubExtension>): Promise<IHubAgentItem[]> {
    // Refresh builtin CLI detection so status reflects current PATH
    const refreshStart = Date.now();
    await agentRegistry.refreshBuiltinAgents();
    console.log(`[HubStateManager] refreshBuiltinAgents completed in ${Date.now() - refreshStart}ms`);

    const loadedByName = new Map(
      ExtensionRegistry.getInstance()
        .getLoadedExtensions()
        .map((e) => [e.manifest.name, e])
    );

    const detectedAgents = agentRegistry.getDetectedAgents();
    const detectedBackends = new Set<string>(
      detectedAgents
        .map((a) => {
          if (isAgentKind(a, 'acp') && a.backend === 'custom' && a.isExtension) return a.customAgentId ?? a.name;
          if (a.backend !== 'custom') return a.backend;
          return null;
        })
        .filter((b): b is string => b !== null)
    );

    console.log(
      `[HubStateManager] Status context: ${loadedByName.size} loaded extension(s) [${[...loadedByName.keys()].join(', ')}], ` +
        `${detectedAgents.length} detected agent(s) [${[...detectedBackends].join(', ')}], ` +
        `${Object.keys(extensions).length} hub extension(s)`
    );

    const result: IHubAgentItem[] = [];

    for (const ext of Object.values(extensions)) {
      const status = await this.deriveStatus(ext, loadedByName, detectedBackends);

      result.push({
        ...ext,
        status,
        installError: await this.getPersistentInstallError(ext.name),
      });
    }

    return result;
  }

  /**
   * Derive the runtime status for a single hub extension.
   *
   * Priority:
   *   1. Transient state (installing / uninstalling)
   *   2. Persistent install error
   *   3. Loaded in ExtensionRegistry (check for update)
   *   4. AcpDetector already detected all contributed backends → installed
   *   5. not_installed
   */
  private async deriveStatus(
    ext: IHubExtension,
    loadedByName: Map<string, { directory: string }>,
    detectedBackends: Set<string>
  ): Promise<HubExtensionStatus> {
    // 1. Transient state (installing / uninstalling)
    const transient = this.transientStates.get(ext.name);
    if (transient) return transient;

    // 2. Persistent install error
    const hasError = await this.getPersistentInstallError(ext.name);
    if (hasError) return 'install_failed';

    // 3. Loaded in ExtensionRegistry — compare the index entry against the
    //    fingerprint recorded at install time (integrity first, version as fallback).
    if (loadedByName.has(ext.name)) {
      if (isUpdateAvailable(ext, getHubInstallRecord(ext.name))) {
        return 'update_available';
      }
    }

    // 4. All contributed acpAdapters are already detected on system
    const adapterIds = ext.contributes?.acpAdapters;
    if (adapterIds && adapterIds.length > 0) {
      if (adapterIds.every((id) => detectedBackends.has(id))) {
        return 'installed';
      }
    }

    return 'not_installed';
  }
}

export const hubStateManager = new HubStateManagerImpl();
