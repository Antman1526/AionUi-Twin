import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildEmbeddingServerArgs } from '@process/services/semanticSearch/EmbeddingRuntime';
import { indexWorkspace } from '@process/services/semanticSearch/Indexer';
import type { EmbeddingRowInput } from '@process/services/semanticSearch/SemanticSearchRepository';
import {
  collectWorkspaceFiles,
  isIndexableFile,
  looksBinary,
  MAX_INDEXABLE_FILE_BYTES,
  readTextFile,
} from '@process/services/semanticSearch/workspaceFiles';

let workspace = '';

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-ws-'));
  await fs.mkdir(path.join(workspace, 'src'));
  await fs.mkdir(path.join(workspace, 'node_modules'));
  await fs.mkdir(path.join(workspace, 'dist'));
  await fs.writeFile(path.join(workspace, 'README.md'), 'project readme');
  await fs.writeFile(path.join(workspace, 'src', 'index.ts'), 'export const a = 1;');
  await fs.writeFile(path.join(workspace, 'logo.png'), Buffer.from([0x89, 0x50, 0, 0]));
  await fs.writeFile(path.join(workspace, 'node_modules', 'dep.ts'), 'ignored');
  await fs.writeFile(path.join(workspace, 'dist', 'bundle.js'), 'ignored');
  await fs.writeFile(path.join(workspace, 'huge.txt'), 'x'.repeat(MAX_INDEXABLE_FILE_BYTES + 1));
  await fs.writeFile(path.join(workspace, 'binary.txt'), Buffer.from([0x41, 0x00, 0x42]));
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('workspace file selection', () => {
  it('accepts only the indexable extensions', () => {
    expect(isIndexableFile('a.md')).toBe(true);
    expect(isIndexableFile('a.TSX')).toBe(true);
    expect(isIndexableFile('a.png')).toBe(false);
  });

  it('detects a NUL byte as binary', () => {
    expect(looksBinary(Buffer.from('plain text'))).toBe(false);
    expect(looksBinary(Buffer.from([0x41, 0x00]))).toBe(true);
  });

  it('skips vendored directories, unsupported extensions and oversized files', async () => {
    const files = await collectWorkspaceFiles(workspace);
    expect(files.map((file) => file.relativePath).toSorted()).toEqual(['README.md', 'binary.txt', 'src/index.ts']);
  });

  it('returns null for a binary file that has a text extension', async () => {
    expect(await readTextFile(path.join(workspace, 'binary.txt'))).toBeNull();
    expect(await readTextFile(path.join(workspace, 'README.md'))).toBe('project readme');
  });
});

describe('indexWorkspace', () => {
  it('writes file chunks under the workspace conversation id', async () => {
    const written: EmbeddingRowInput[] = [];
    const embed = vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0]));

    const result = await indexWorkspace(workspace, {
      store: {
        getUpdatedAtMap: () => new Map(),
        upsertMany: (rows) => written.push(...rows),
      },
      embed,
      model: 'embedding',
    });

    expect(result.cancelled).toBe(false);
    expect(written.map((row) => row.messageId).toSorted()).toEqual(['file:README.md#0', 'file:src/index.ts#0']);
    expect(written.every((row) => row.conversationId === `workspace:${workspace}`)).toBe(true);
    expect(embed.mock.calls[0][0].toSorted()).toEqual(['export const a = 1;', 'project readme']);
  });

  it('skips files whose stored vector is newer than the file', async () => {
    const embed = vi.fn(async (inputs: string[]) => inputs.map(() => [1, 0]));
    const future = Date.now() + 60_000;

    await indexWorkspace(workspace, {
      store: {
        getUpdatedAtMap: () =>
          new Map([
            ['file:README.md#0', future],
            ['file:src/index.ts#0', future],
          ]),
        upsertMany: () => {},
      },
      embed,
      model: 'embedding',
    });

    expect(embed).not.toHaveBeenCalled();
  });
});

describe('buildEmbeddingServerArgs', () => {
  it('requests a dedicated embedding server on loopback', () => {
    expect(buildEmbeddingServerArgs({ modelPath: '/models/nomic.gguf', port: 8123 })).toEqual([
      '-m',
      '/models/nomic.gguf',
      '--embedding',
      '--host',
      '127.0.0.1',
      '--port',
      '8123',
      '-c',
      '2048',
      '-ngl',
      '99',
    ]);
  });
});
