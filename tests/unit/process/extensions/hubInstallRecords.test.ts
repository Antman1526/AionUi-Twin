/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getHubInstallRecord,
  getHubInstallRecordsFile,
  hubStateManager,
  isUpdateAvailable,
  readHubInstallRecords,
  writeHubInstallRecord,
  type HubInstallRecord,
} from '../../../../src/process/extensions/hub/HubStateManager';
import type { HubExtensionStatus, IHubExtension } from '../../../../src/common/types/hub';

const ENV_KEY = 'AIONUI_HUB_INSTALL_RECORDS_FILE';

let tmpRoot: string;
let recordsFile: string;
let previousEnv: string | undefined;

function record(overrides: Partial<HubInstallRecord> = {}): HubInstallRecord {
  return {
    name: 'ext-demo',
    version: '1.0.0',
    integrity: 'sha512-AAAA',
    verified: 'integrity',
    installedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function hubExtension(overrides: Partial<IHubExtension> = {}): IHubExtension {
  return {
    name: 'ext-demo',
    displayName: 'Demo',
    description: 'demo',
    author: 'test',
    version: '1.0.0',
    dist: { tarball: 'extensions/demo.zip', integrity: 'sha512-AAAA', unpackedSize: 10 },
    engines: { aionui: '1.0.0' },
    hubs: ['acpAdapters'],
    ...overrides,
  };
}

describe('extensions/hub install records', () => {
  beforeAll(() => {
    previousEnv = process.env[ENV_KEY];
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-hub-records-'));
    recordsFile = path.join(tmpRoot, 'nested', 'hub-install-records.json');
    process.env[ENV_KEY] = recordsFile;
  });

  afterAll(() => {
    if (previousEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previousEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(recordsFile, { force: true });
  });

  it('resolves the records file from the environment override', () => {
    expect(getHubInstallRecordsFile()).toBe(recordsFile);
  });

  it('returns an empty map when the store does not exist', () => {
    expect(readHubInstallRecords()).toEqual({});
    expect(getHubInstallRecord('ext-demo')).toBeUndefined();
  });

  it('returns an empty map when the store is corrupt', () => {
    fs.mkdirSync(path.dirname(recordsFile), { recursive: true });
    fs.writeFileSync(recordsFile, 'not json at all', 'utf-8');
    expect(readHubInstallRecords()).toEqual({});
  });

  it('ignores a store written by a future schema version', () => {
    fs.mkdirSync(path.dirname(recordsFile), { recursive: true });
    fs.writeFileSync(recordsFile, JSON.stringify({ version: 2, records: { 'ext-demo': record() } }), 'utf-8');
    expect(readHubInstallRecords()).toEqual({});
  });

  it('writes and reads back a record, creating the directory', () => {
    writeHubInstallRecord(record());
    expect(fs.existsSync(recordsFile)).toBe(true);
    expect(getHubInstallRecord('ext-demo')).toEqual(record());
  });

  it('keeps other records when a new one is written', () => {
    writeHubInstallRecord(record());
    writeHubInstallRecord(record({ name: 'ext-other', integrity: 'sha512-BBBB' }));

    expect(Object.keys(readHubInstallRecords()).sort()).toEqual(['ext-demo', 'ext-other']);
  });

  it('replaces an existing record on reinstall', () => {
    writeHubInstallRecord(record());
    writeHubInstallRecord(record({ version: '2.0.0', integrity: 'sha512-CCCC' }));

    expect(getHubInstallRecord('ext-demo')).toMatchObject({ version: '2.0.0', integrity: 'sha512-CCCC' });
  });

  it('ignores the environment override outside a test runner', () => {
    const previousVitest = process.env.VITEST;
    const previousNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    try {
      expect(getHubInstallRecordsFile()).not.toBe(recordsFile);
      expect(path.basename(getHubInstallRecordsFile())).toBe('hub-install-records.json');
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('honours the environment override when only NODE_ENV marks a test run', () => {
    const previousVitest = process.env.VITEST;
    const previousNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'test';
    try {
      expect(getHubInstallRecordsFile()).toBe(recordsFile);
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses to store a record named "%s"', (name) => {
    expect(() => writeHubInstallRecord(record({ name }))).toThrow('Refusing to store an install record');
    expect(fs.existsSync(recordsFile)).toBe(false);
    expect(({} as Record<string, unknown>).verified).toBeUndefined();
  });

  it('keeps a poisoned key in the file as an ordinary entry', () => {
    fs.mkdirSync(path.dirname(recordsFile), { recursive: true });
    fs.writeFileSync(
      recordsFile,
      JSON.stringify({ version: 1, records: { __proto__: { polluted: true }, 'ext-demo': record() } }),
      'utf-8'
    );

    writeHubInstallRecord(record({ name: 'ext-other' }));

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(getHubInstallRecord('ext-other')).toMatchObject({ name: 'ext-other' });
  });

  it('does not write through the fixed `<file>.tmp` name', () => {
    // A directory squatting on the old fixed temp name makes the write fail
    // (EISDIR) for any implementation still using it; a unique name is unaffected.
    fs.mkdirSync(`${recordsFile}.tmp`, { recursive: true });
    try {
      writeHubInstallRecord(record());
      expect(getHubInstallRecord('ext-demo')).toMatchObject({ name: 'ext-demo' });
      expect(fs.readdirSync(path.dirname(recordsFile)).filter((f) => f.endsWith('.tmp'))).toEqual([
        `${path.basename(recordsFile)}.tmp`,
      ]);
    } finally {
      fs.rmSync(`${recordsFile}.tmp`, { recursive: true, force: true });
    }
  });

  it('exposes the same store through hubStateManager', () => {
    hubStateManager.recordInstall(record({ name: 'ext-manager' }));
    expect(hubStateManager.getInstallRecord('ext-manager')).toMatchObject({ name: 'ext-manager' });
    expect(getHubInstallRecord('ext-manager')).toMatchObject({ name: 'ext-manager' });
  });
});

describe('extensions/hub isUpdateAvailable', () => {
  it('is false without a record', () => {
    expect(isUpdateAvailable(hubExtension(), undefined)).toBe(false);
  });

  it('is false when the index integrity matches the recorded integrity', () => {
    expect(isUpdateAvailable(hubExtension(), record())).toBe(false);
  });

  it('is true when the index integrity differs from the recorded integrity', () => {
    const ext = hubExtension({ dist: { tarball: 'x.zip', integrity: 'sha512-ZZZZ', unpackedSize: 10 } });
    expect(isUpdateAvailable(ext, record())).toBe(true);
  });

  it('ignores surrounding whitespace when comparing integrity', () => {
    const ext = hubExtension({ dist: { tarball: 'x.zip', integrity: ' sha512-AAAA ', unpackedSize: 10 } });
    expect(isUpdateAvailable(ext, record())).toBe(false);
  });

  it('is true when the integrity matches but a republished version differs and no integrity is recorded', () => {
    const ext = hubExtension({
      version: '2.0.0',
      dist: { tarball: 'x.zip', integrity: '', unpackedSize: 10 },
    });
    expect(isUpdateAvailable(ext, record({ integrity: undefined }))).toBe(true);
  });

  it('falls back to the version when the index entry carries no integrity', () => {
    const ext = hubExtension({ version: '1.0.0', dist: { tarball: 'x.zip', integrity: '', unpackedSize: 10 } });
    expect(isUpdateAvailable(ext, record())).toBe(false);
  });

  it('falls back to the version when the record predates integrity tracking', () => {
    expect(isUpdateAvailable(hubExtension({ version: '3.0.0' }), record({ integrity: undefined }))).toBe(true);
  });

  it('is false when neither integrity nor version can be compared', () => {
    const ext = hubExtension({ version: undefined, dist: { tarball: 'x.zip', integrity: '', unpackedSize: 10 } });
    expect(isUpdateAvailable(ext, record({ integrity: undefined, version: undefined }))).toBe(false);
  });
});

describe('extensions/hub HubStateManager.deriveStatus — update detection', () => {
  let derive: (
    ext: IHubExtension,
    loaded: Map<string, { directory: string }>,
    detected: Set<string>
  ) => Promise<HubExtensionStatus>;

  beforeAll(() => {
    previousEnv = process.env[ENV_KEY];
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-hub-derive-'));
    recordsFile = path.join(tmpRoot, 'hub-install-records.json');
    process.env[ENV_KEY] = recordsFile;

    const internals = hubStateManager as unknown as {
      deriveStatus: typeof derive;
    };
    derive = internals.deriveStatus.bind(hubStateManager);
  });

  afterAll(() => {
    if (previousEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previousEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(recordsFile, { force: true });
  });

  const loadedMap = new Map([['ext-demo', { directory: '/tmp/ext-demo' }]]);

  it('reports update_available when the index integrity moved on', async () => {
    writeHubInstallRecord(record());
    const ext = hubExtension({ dist: { tarball: 'x.zip', integrity: 'sha512-NEW', unpackedSize: 10 } });

    await expect(derive(ext, loadedMap, new Set())).resolves.toBe('update_available');
  });

  it('does not report update_available when the integrity is unchanged', async () => {
    writeHubInstallRecord(record());
    await expect(derive(hubExtension(), loadedMap, new Set())).resolves.toBe('not_installed');
  });

  it('does not report update_available when the extension is not loaded', async () => {
    writeHubInstallRecord(record());
    const ext = hubExtension({ dist: { tarball: 'x.zip', integrity: 'sha512-NEW', unpackedSize: 10 } });

    await expect(derive(ext, new Map(), new Set())).resolves.toBe('not_installed');
  });

  it('does not report update_available without an install record', async () => {
    const ext = hubExtension({ dist: { tarball: 'x.zip', integrity: 'sha512-NEW', unpackedSize: 10 } });
    await expect(derive(ext, loadedMap, new Set())).resolves.toBe('not_installed');
  });

  it('still reports installed when contributed adapters are detected and nothing changed', async () => {
    writeHubInstallRecord(record());
    const ext = hubExtension({ contributes: { acpAdapters: ['demo-cli'] } });

    await expect(derive(ext, loadedMap, new Set(['demo-cli']))).resolves.toBe('installed');
  });

  it('prefers update_available over installed when the index moved on', async () => {
    writeHubInstallRecord(record());
    const ext = hubExtension({
      contributes: { acpAdapters: ['demo-cli'] },
      dist: { tarball: 'x.zip', integrity: 'sha512-NEW', unpackedSize: 10 },
    });

    await expect(derive(ext, loadedMap, new Set(['demo-cli']))).resolves.toBe('update_available');
  });
});
