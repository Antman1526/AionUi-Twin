import { getPlatformServices } from '@/common/platform';
import { getDataPath } from '@process/utils';
import { agentRegistry } from '@process/agent/AgentRegistry';
import { isAgentKind } from '@/common/types/detectedAgent';
import { exec } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
  EXTENSION_MANIFEST_FILE,
  getHubResourcesDir,
  getInstallTargetDir,
  HUB_REMOTE_URLS,
} from '@process/extensions/constants';
import { ExtensionRegistry } from '@process/extensions/ExtensionRegistry';
import { markExtensionForReinstall } from '@process/extensions/lifecycle/statePersistence';
import { hubIndexManager } from '@process/extensions/hub/HubIndexManager';
import { hubStateManager } from '@process/extensions/hub/HubStateManager';
import { tryComputeDirectoryDigest } from '@process/extensions/hub/directoryDigest';
import { isPathWithinDirectory } from '@process/extensions/sandbox/pathSafety';
import { getPrivateModeEnabled } from '@process/services/privacy/privacyState';
import type { IHubExtension, HubContributes } from '@/common/types/hub';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Post-install verification
// ---------------------------------------------------------------------------

type VerifyResult = { ok: boolean; reason?: string };

/**
 * Per-contributes-type verification functions.
 * Each verifier checks whether the contributed capabilities are actually
 * available after onInstall has completed.
 *
 * Return { ok: true } to pass, or { ok: false, reason } to fail.
 * Types without a verifier are assumed to pass (installed == extracted + loaded).
 */
const contributeVerifiers: Partial<Record<keyof HubContributes, (ids: string[]) => VerifyResult>> = {
  acpAdapters(ids: string[]): VerifyResult {
    const agents = agentRegistry.getDetectedAgents();

    // Build a set of all identifiers that represent a detected adapter:
    // - backend ID for builtin agents (e.g. 'claude', 'qwen')
    // - adapter ID from customAgentId for extension agents (e.g. 'ext:name:adapterId' → 'adapterId')
    const detectedIds = new Set<string>();
    for (const a of agents) {
      if (a.backend !== 'custom') {
        detectedIds.add(a.backend);
      }
      if (isAgentKind(a, 'acp') && a.isExtension && a.customAgentId) {
        const adapterId = a.customAgentId.split(':').pop();
        if (adapterId) detectedIds.add(adapterId);
      }
    }

    const missing = ids.filter((id) => !detectedIds.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `ACP adapters not detected after install: [${missing.join(', ')}]. The onInstall hook may have failed to install the required CLI.`,
      };
    }
    return { ok: true };
  },
};

/**
 * Verify that all contributed capabilities declared by an extension
 * are actually available after installation.
 */
function verifyInstallation(extInfo: IHubExtension): VerifyResult {
  const contributes = extInfo.contributes;
  if (!contributes) return { ok: true };

  for (const [key, ids] of Object.entries(contributes)) {
    if (!ids || ids.length === 0) continue;

    const verifier = contributeVerifiers[key as keyof HubContributes];
    if (!verifier) continue; // No verifier for this type — assume OK

    const result = verifier(ids);
    if (!result.ok) return result;
  }

  return { ok: true };
}

export class HubInstallerImpl {
  private getCacheDir(): string {
    return path.join(getDataPath(), 'cache', 'hub');
  }

  private getTempDir(): string {
    return path.join(getInstallTargetDir(), '.tmp');
  }

  public async install(name: string): Promise<void> {
    try {
      hubStateManager.setTransientState(name, 'installing');

      const extInfo = hubIndexManager.getExtension(name);
      if (!extInfo) {
        throw new Error(`Extension ${name} not found in Hub Index`);
      }

      const tempDir = path.join(this.getTempDir(), name);
      const targetDir = path.join(getInstallTargetDir(), name);

      // Clean up previous temp dir if exists
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Ensure directories exist
      fs.mkdirSync(this.getCacheDir(), { recursive: true });
      fs.mkdirSync(this.getTempDir(), { recursive: true });

      // Step 1: Resolve zip path — try bundled resources first, fallback to remote download
      const zipPath = await this.resolveZipPath(name, extInfo.dist.tarball, extInfo.bundled);

      // Step 2: Verify integrity of the archive exactly as fetched, before extraction
      const trust = await this.enforceIntegrity(name, zipPath, extInfo);

      // Step 3: Extract (.zip)
      fs.mkdirSync(tempDir, { recursive: true });
      if (process.platform === 'win32') {
        await execAsync(`tar -xf "${zipPath}" -C "${tempDir}"`);
      } else {
        await execAsync(`unzip -o "${zipPath}" -d "${tempDir}"`);
      }

      // If the archive wraps contents in a "package" directory, move contents up
      const packageDir = path.join(tempDir, 'package');
      let finalExtractDir = tempDir;
      if (fs.existsSync(packageDir)) {
        finalExtractDir = packageDir;
      }

      // Verify aion-extension.json exists
      const manifestPath = path.join(finalExtractDir, EXTENSION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid extension package: aion-extension.json missing');
      }

      // Step 4: Move to target directory
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      if (finalExtractDir === packageDir) {
        fs.renameSync(packageDir, targetDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
      } else {
        fs.renameSync(tempDir, targetDir);
      }

      // Step 5: Reload extension registry and refresh AcpDetector
      // Clear persisted state so hotReload treats this as a fresh install
      // and re-runs onInstall (handles reinstall after CLI was uninstalled).
      await markExtensionForReinstall(name);

      // hotReload re-scans all extension directories, discovers this new extension,
      // and runs the full lifecycle (onInstall for first-time + onActivate) via
      // the extension system's lifecycle runner (forked process, timeout, sandboxing).
      await ExtensionRegistry.hotReload();

      // Re-detect all agents (builtin + extension + custom) since onInstall
      // may have installed new CLIs that weren't on PATH at startup.
      await agentRegistry.refreshAll();

      // Step 6: Verify contributed capabilities are actually available
      const verification = verifyInstallation(extInfo);
      if (!verification.ok) {
        throw new Error(verification.reason);
      }

      // Step 7: Record what was verified — drives update detection and the
      // channel-plugin trust gate.
      //
      // The directory digest is taken here, after the lifecycle ran, so it
      // describes the bytes every later load will see. It binds the record to
      // this directory: without it, any sideloaded directory reusing
      // `manifest.name` would inherit this extension's verified status.
      hubStateManager.recordInstall({
        name,
        version: extInfo.version,
        integrity: extInfo.dist.integrity?.trim() || undefined,
        verified: trust,
        directoryDigest: tryComputeDirectoryDigest(targetDir) ?? undefined,
        installedAt: new Date().toISOString(),
      });

      hubStateManager.setTransientState(name, 'installed');
    } catch (error) {
      console.error(`[HubInstaller] Failed to install ${name}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      hubStateManager.setTransientState(name, 'install_failed', errorMessage);
      throw error;
    }
  }

  public async retryInstall(name: string): Promise<void> {
    hubStateManager.setTransientState(name, 'installing');

    try {
      const targetDir = path.join(getInstallTargetDir(), name);

      // If target directory doesn't exist, we must run the full install process again
      if (!fs.existsSync(targetDir)) {
        await this.install(name);
        return;
      }

      // Target directory exists — verify manifest then let registry handle lifecycle
      const manifestPath = path.join(targetDir, EXTENSION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Extension manifest missing, please reinstall from scratch.');
      }

      // Reload registry — clear persisted state to force onInstall re-run
      await markExtensionForReinstall(name);
      await ExtensionRegistry.hotReload();
      await agentRegistry.refreshAll();

      // Verify contributed capabilities
      const extInfo = hubIndexManager.getExtension(name);
      if (extInfo) {
        const verification = verifyInstallation(extInfo);
        if (!verification.ok) {
          throw new Error(verification.reason);
        }
      }

      hubStateManager.setTransientState(name, 'installed');
    } catch (error) {
      console.error(`[HubInstaller] Failed to retry install ${name}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      hubStateManager.setTransientState(name, 'install_failed', errorMessage);
      throw error;
    }
  }

  /**
   * Resolve the zip file path for an extension.
   * Bundled extensions try local Resources first, then fall back to remote download.
   * Non-bundled extensions always download from remote.
   */
  private async resolveZipPath(name: string, distTarball: string, bundled?: boolean): Promise<string> {
    if (bundled) {
      const localPath = path.join(getHubResourcesDir(), path.basename(distTarball));
      if (fs.existsSync(localPath)) {
        return localPath;
      }
      console.warn(`[HubInstaller] Bundled zip not found at ${localPath}, falling back to remote download`);
    }

    // Private Mode: refuse remote downloads entirely (no network egress).
    // Bundled extensions with a local zip already returned above.
    if (getPrivateModeEnabled()) {
      throw new Error(`Cannot download ${name}: remote downloads are disabled in Private Mode`);
    }

    // Reject absolute URLs to prevent bypassing trusted base URLs
    if (/^https?:\/\//i.test(distTarball)) {
      throw new Error(`Untrusted absolute tarball URL in hub index: ${distTarball}`);
    }

    // Download from remote mirrors (try each in order)
    const cachePath = path.join(this.getCacheDir(), `${name}.zip`);
    for (const baseUrl of HUB_REMOTE_URLS) {
      const url = new URL(distTarball, baseUrl).toString();
      try {
        await this.downloadFile(url, cachePath);
        return cachePath;
      } catch (error) {
        console.warn(`[HubInstaller] Download failed from ${url} (${error})`);
      }
    }

    throw new Error(`Failed to download ${name} from all remote sources`);
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const response = await getPlatformServices().network.fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }

    // Convert array buffer to buffer and write to disk
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(arrayBuffer));
  }

  /**
   * Apply the install-time integrity policy to a resolved archive.
   *
   * - `dist.integrity` present → must match, otherwise the install fails and the
   *   downloaded archive is discarded.
   * - absent + not bundled → refuse; an unverifiable remote archive is never installed.
   * - absent + bundled → allowed (the archive ships inside the signed app bundle).
   *
   * Returns how the archive earned trust, for the install record.
   */
  private async enforceIntegrity(
    name: string,
    zipPath: string,
    extInfo: Pick<IHubExtension, 'dist' | 'bundled'>
  ): Promise<'integrity' | 'bundled'> {
    const expectedSri = extInfo.dist.integrity?.trim();

    if (!expectedSri) {
      if (!extInfo.bundled) {
        throw new Error(
          `Refusing to install "${name}": the hub index entry has no dist.integrity value, ` +
            `so the downloaded archive cannot be verified.`
        );
      }
      console.warn(`[HubInstaller] Bundled extension "${name}" has no dist.integrity value; installing unverified.`);
      return 'bundled';
    }

    try {
      await this.verifyIntegrity(zipPath, expectedSri);
    } catch (error) {
      this.discardUnverifiedArchive(zipPath);
      throw error;
    }

    return 'integrity';
  }

  /**
   * Delete an archive that failed verification.
   *
   * Only temp/cache copies are removed — a bundled archive inside the app's
   * Resources directory is left alone (it is not ours to delete, and removing
   * it would break the next launch).
   */
  private discardUnverifiedArchive(zipPath: string): void {
    const resolved = path.resolve(zipPath);
    try {
      const isDisposable =
        isPathWithinDirectory(resolved, this.getCacheDir()) || isPathWithinDirectory(resolved, this.getTempDir());
      if (!isDisposable) return;

      fs.rmSync(resolved, { force: true });
    } catch (error) {
      // Never let cleanup mask the integrity failure that triggered it.
      console.warn(`[HubInstaller] Failed to delete unverified archive ${resolved}:`, error);
    }
  }

  /**
   * Verify a file against a Subresource Integrity string.
   *
   * Supports `sha512-<base64>` and `sha256-<base64>`. The hash is computed with
   * node crypto over the file bytes exactly as fetched, which is identical on
   * every platform — archives are only ever compared byte-for-byte, never
   * re-packed locally.
   */
  public async verifyIntegrity(filePath: string, expectedSri: string): Promise<void> {
    const match = /^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(expectedSri.trim());
    if (!match) {
      throw new Error(
        `Integrity verification failed: unsupported or malformed integrity value "${expectedSri}". ` +
          `Expected "sha512-<base64>" or "sha256-<base64>".`
      );
    }

    const [, algorithm, expectedBase64] = match;
    const expectedDigest = Buffer.from(expectedBase64, 'base64');
    const actualDigest = await hashFile(filePath, algorithm);

    if (expectedDigest.length !== actualDigest.length || !crypto.timingSafeEqual(expectedDigest, actualDigest)) {
      throw new Error(
        `Integrity verification failed for ${path.basename(filePath)}: ` +
          `expected ${algorithm}-${expectedDigest.toString('base64')}, ` +
          `got ${algorithm}-${actualDigest.toString('base64')}.`
      );
    }
  }
}

/** Stream a file through a hash so large archives are not buffered in memory. */
function hashFile(filePath: string, algorithm: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest()));
  });
}

export const hubInstaller = new HubInstallerImpl();
