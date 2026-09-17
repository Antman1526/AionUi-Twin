/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  evaluateChannelPluginTrust,
  resolveChannelPlugins,
  type ChannelPluginTrustDeps,
} from '../../../../src/process/extensions/resolvers/ChannelPluginResolver';
import { computeDirectoryDigest } from '../../../../src/process/extensions/hub/directoryDigest';
import type { HubInstallRecord } from '../../../../src/process/extensions/hub/HubStateManager';
import type { LoadedExtension } from '../../../../src/process/extensions/types';

const PLUGIN_SOURCE = `
class FakeChannelPlugin {
  async start() {}
  async stop() {}
  async sendMessage() { return 'msg-1'; }
}
module.exports = FakeChannelPlugin;
`;

let extensionDir: string;

function loadedExtension(name = 'ext-channel'): LoadedExtension {
  return {
    directory: extensionDir,
    source: 'local',
    manifest: {
      name,
      version: '1.0.0',
      contributes: {
        channelPlugins: [{ type: 'fakechat', entryPoint: 'plugin.js', displayName: 'Fake Chat' }],
      },
    },
  } as unknown as LoadedExtension;
}

function record(verified: HubInstallRecord['verified'], directoryDigest = currentDigest()): HubInstallRecord {
  return {
    name: 'ext-channel',
    version: '1.0.0',
    integrity: 'sha512-AAAA',
    verified,
    directoryDigest,
    installedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Digest of the fixture extension directory as it currently is on disk. */
function currentDigest(): string {
  return computeDirectoryDigest(extensionDir);
}

function makeDeps(overrides: Partial<ChannelPluginTrustDeps> = {}) {
  const confirmTrust = vi.fn().mockReturnValue(false);
  const addConsent = vi.fn();
  const deps: ChannelPluginTrustDeps = {
    getInstallRecord: () => undefined,
    getConsented: () => [],
    addConsent,
    confirmTrust,
    computeDirectoryDigest: (directory: string) => computeDirectoryDigest(directory),
    ...overrides,
  };
  return { deps, confirmTrust: deps.confirmTrust as ReturnType<typeof vi.fn>, addConsent };
}

beforeAll(() => {
  extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-channel-trust-'));
  fs.writeFileSync(path.join(extensionDir, 'plugin.js'), PLUGIN_SOURCE, 'utf-8');
});

afterAll(() => {
  fs.rmSync(extensionDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extensions/resolvers evaluateChannelPluginTrust', () => {
  it('trusts an extension whose archive integrity was verified, without asking', () => {
    const { deps, confirmTrust } = makeDeps({ getInstallRecord: () => record('integrity') });

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(decision.trusted).toBe(true);
    expect(decision.reason).toContain('verified integrity');
    expect(confirmTrust).not.toHaveBeenCalled();
  });

  it('trusts a bundled extension without asking', () => {
    const { deps, confirmTrust } = makeDeps({ getInstallRecord: () => record('bundled') });

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(decision.trusted).toBe(true);
    expect(decision.reason).toContain('bundled');
    expect(confirmTrust).not.toHaveBeenCalled();
  });

  it('trusts an extension the user consented to previously, without asking again', () => {
    const { deps, confirmTrust } = makeDeps({
      getConsented: () => [{ name: 'ext-channel', directoryDigest: currentDigest() }],
    });

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(decision.trusted).toBe(true);
    expect(decision.reason).toContain('previously granted');
    expect(confirmTrust).not.toHaveBeenCalled();
  });

  it('asks the user when there is no record and no prior consent, and remembers a yes', () => {
    const { deps, confirmTrust, addConsent } = makeDeps({ confirmTrust: vi.fn().mockReturnValue(true) });

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(confirmTrust).toHaveBeenCalledWith(
      expect.objectContaining({ directory: extensionDir }),
      ['fakechat'],
      undefined
    );
    expect(addConsent).toHaveBeenCalledWith({ name: 'ext-channel', directoryDigest: currentDigest() });
    expect(decision.trusted).toBe(true);
  });

  it('refuses and records nothing when the user declines', () => {
    const { deps, confirmTrust, addConsent } = makeDeps();

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(addConsent).not.toHaveBeenCalled();
    expect(decision.trusted).toBe(false);
    expect(decision.reason).toContain('no verified install record');
  });

  it('does not inherit trust from a record whose directory digest does not match', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps, confirmTrust } = makeDeps({
      getInstallRecord: () => record('integrity', 'sha256-someotherextensionsdigest'),
    });

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(confirmTrust.mock.calls[0][2]).toContain('no longer match');
    expect(decision.trusted).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toContain('no longer matches the recorded digest');
  });

  it('does not trust a legacy record that carries no directory digest', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps, confirmTrust } = makeDeps({
      getInstallRecord: () => ({ ...record('integrity'), directoryDigest: undefined }),
    });

    expect(evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps).trusted).toBe(false);
    expect(confirmTrust).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a consent granted for different directory contents', () => {
    const { deps, confirmTrust } = makeDeps({
      getConsented: () => [{ name: 'ext-channel', directoryDigest: 'sha256-stale' }],
    });

    expect(evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps).trusted).toBe(false);
    expect(confirmTrust).toHaveBeenCalledTimes(1);
  });

  it('stops honouring a remembered consent once the directory changes', () => {
    const grantedDigest = currentDigest();
    const { deps, confirmTrust } = makeDeps({
      getConsented: () => [{ name: 'ext-channel', directoryDigest: grantedDigest }],
    });

    expect(evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps).trusted).toBe(true);

    const swapped = path.join(extensionDir, 'payload.js');
    fs.writeFileSync(swapped, 'module.exports = {};', 'utf-8');
    try {
      expect(evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps).trusted).toBe(false);
      expect(confirmTrust).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(swapped, { force: true });
    }
  });

  it('asks and does not persist consent when the directory digest cannot be taken', () => {
    const { deps, confirmTrust, addConsent } = makeDeps({
      computeDirectoryDigest: () => null,
      confirmTrust: vi.fn().mockReturnValue(true),
      getInstallRecord: () => record('integrity'),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(addConsent).not.toHaveBeenCalled();
    expect(decision.trusted).toBe(true);
  });

  it('does not treat an unrecognised record as trusted', () => {
    const { deps, confirmTrust } = makeDeps({
      getInstallRecord: () => ({ ...record('integrity'), verified: 'unknown' as HubInstallRecord['verified'] }),
    });

    const decision = evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps);

    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(decision.trusted).toBe(false);
  });

  it('consults consent by extension name, not by plugin type', () => {
    const { deps, confirmTrust } = makeDeps({
      getConsented: () => [{ name: 'fakechat', directoryDigest: currentDigest() }],
    });

    expect(evaluateChannelPluginTrust(loadedExtension(), ['fakechat'], deps).trusted).toBe(false);
    expect(confirmTrust).toHaveBeenCalledTimes(1);
  });
});

describe('extensions/resolvers resolveChannelPlugins — trust gate wiring', () => {
  it('does not load plugins from an untrusted extension and logs a security line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps } = makeDeps();

    const result = resolveChannelPlugins([loadedExtension()], deps);

    expect(result.size).toBe(0);
    expect(warn.mock.calls.flat().join(' ')).toContain('Blocked channel plugins');
  });

  it('loads plugins from an extension with a verified install record', () => {
    const { deps, confirmTrust } = makeDeps({ getInstallRecord: () => record('integrity') });

    const result = resolveChannelPlugins([loadedExtension()], deps);

    expect(confirmTrust).not.toHaveBeenCalled();
    expect(result.has('fakechat')).toBe(true);
  });

  it('asks only once for an extension contributing several plugins', () => {
    const { deps, confirmTrust } = makeDeps({ confirmTrust: vi.fn().mockReturnValue(true) });
    const ext = loadedExtension();
    ext.manifest.contributes.channelPlugins = [
      { type: 'fakechat', entryPoint: 'plugin.js', displayName: 'Fake Chat' },
      { type: 'fakechat2', entryPoint: 'plugin.js', displayName: 'Fake Chat 2' },
    ] as LoadedExtension['manifest']['contributes']['channelPlugins'];

    const result = resolveChannelPlugins([ext], deps);

    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(confirmTrust.mock.calls[0][1]).toEqual(['fakechat', 'fakechat2']);
    expect(result.size).toBe(2);
  });

  it('never consults the trust gate for extensions without channel plugins', () => {
    const { deps, confirmTrust } = makeDeps();
    const ext = loadedExtension();
    ext.manifest.contributes.channelPlugins = [];

    expect(resolveChannelPlugins([ext], deps).size).toBe(0);
    expect(confirmTrust).not.toHaveBeenCalled();
  });
});
