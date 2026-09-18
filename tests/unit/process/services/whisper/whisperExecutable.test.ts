/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the pure parts of the whisper.cpp runtime: executable lookup
 * and the `whisper-server` argument builder. No real binary is involved.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  WHISPER_SERVER_BINARY,
  buildWhisperExecutableCandidates,
  buildWhisperServerArgs,
  resolveWhisperExecutable,
} from '@process/services/whisper/whisperExecutable';
import {
  WHISPER_MODEL_CATALOG,
  buildWhisperModelUrl,
  getWhisperCatalogEntry,
} from '@process/services/whisper/whisperCatalog';

describe('buildWhisperExecutableCandidates', () => {
  it('walks PATH first, then the usual unix install locations', () => {
    const candidates = buildWhisperExecutableCandidates({
      platform: 'darwin',
      home: '/Users/tester',
      pathEnv: '/usr/bin:/opt/homebrew/bin',
    });

    expect(candidates[0]).toBe('/usr/bin/whisper-server');
    expect(candidates[1]).toBe('/opt/homebrew/bin/whisper-server');
    expect(candidates).toContain('/usr/local/bin/whisper-server');
    expect(candidates).toContain('/Users/tester/.local/bin/whisper-server');
    // /opt/homebrew/bin came from PATH already — never listed twice.
    expect(candidates.filter((c) => c === '/opt/homebrew/bin/whisper-server')).toHaveLength(1);
  });

  it('looks for the .exe on win32 and splits PATH on ";"', () => {
    const candidates = buildWhisperExecutableCandidates({
      platform: 'win32',
      home: 'C:\\Users\\tester',
      pathEnv: 'C:\\tools;C:\\bin',
    });

    expect(candidates.every((c) => c.endsWith('whisper-server.exe'))).toBe(true);
    expect(candidates[0]).toContain('C:\\tools');
    expect(candidates[1]).toContain('C:\\bin');
  });

  it('exports the bare binary name used for the lookup', () => {
    expect(WHISPER_SERVER_BINARY).toBe('whisper-server');
  });
});

describe('resolveWhisperExecutable', () => {
  it('returns the first candidate the probe accepts', () => {
    const probe = (candidate: string) => candidate === '/usr/local/bin/whisper-server';
    expect(resolveWhisperExecutable(['/usr/bin/whisper-server', '/usr/local/bin/whisper-server'], probe)).toBe(
      '/usr/local/bin/whisper-server'
    );
  });

  it('never falls back to a bare command name when nothing is executable', () => {
    expect(resolveWhisperExecutable(['/usr/bin/whisper-server'], () => false)).toBeNull();
  });
});

describe('buildWhisperServerArgs', () => {
  it('binds to loopback and always passes a language', () => {
    expect(buildWhisperServerArgs({ modelPath: '/models/ggml-base-q5_1.bin', port: 51234 })).toEqual([
      '-m',
      '/models/ggml-base-q5_1.bin',
      '--host',
      '127.0.0.1',
      '--port',
      '51234',
      '-l',
      'auto',
    ]);
  });

  it('passes threads, language and the translate flag when requested', () => {
    expect(
      buildWhisperServerArgs({
        modelPath: '/m.bin',
        port: 1,
        threads: 4,
        language: 'de',
        translate: true,
      })
    ).toEqual(['-m', '/m.bin', '--host', '127.0.0.1', '--port', '1', '-t', '4', '-l', 'de', '-tr']);
  });

  it('falls back to auto detection for a blank language', () => {
    expect(buildWhisperServerArgs({ modelPath: '/m.bin', port: 1, language: '   ' })).toContain('auto');
  });
});

describe('WHISPER_MODEL_CATALOG', () => {
  it('has unique ids and file names', () => {
    expect(new Set(WHISPER_MODEL_CATALOG.map((e) => e.id)).size).toBe(WHISPER_MODEL_CATALOG.length);
    expect(new Set(WHISPER_MODEL_CATALOG.map((e) => e.fileName)).size).toBe(WHISPER_MODEL_CATALOG.length);
  });

  it('carries a real 64-hex sha256 and a positive size for every entry', () => {
    for (const entry of WHISPER_MODEL_CATALOG) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('resolves download URLs against the ggerganov/whisper.cpp repo', () => {
    const entry = getWhisperCatalogEntry('base-q5_1');
    expect(entry).toBeDefined();
    expect(buildWhisperModelUrl(entry!)).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin'
    );
  });

  it('returns undefined for an unknown id', () => {
    expect(getWhisperCatalogEntry('nope')).toBeUndefined();
  });
});
