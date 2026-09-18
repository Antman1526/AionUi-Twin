/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import { ALL_MIGRATIONS, runMigrations } from '@process/services/database/migrations';
import { CURRENT_DB_VERSION, initSchema } from '@process/services/database/schema';
import { EmbeddingStore } from '@process/services/semanticSearch/EmbeddingStore';
import { workspaceConversationId } from '@process/services/semanticSearch/workspaceGuard';

let nativeModuleAvailable = true;
try {
  const probe = new BetterSqlite3Driver(':memory:');
  probe.close();
} catch (e) {
  if (e instanceof Error && e.message.includes('NODE_MODULE_VERSION')) {
    nativeModuleAvailable = false;
  }
}

const describeOrSkip = nativeModuleAvailable ? describe : describe.skip;

describe('migration registry', () => {
  it('registers migration v27 and keeps the schema version constant in step', () => {
    const versions = ALL_MIGRATIONS.map((migration) => migration.version);
    expect(versions).toContain(27);
    expect(Math.max(...versions)).toBe(CURRENT_DB_VERSION);
    expect(versions).toEqual([...versions].toSorted((a, b) => a - b));
  });
});

describeOrSkip('migration v27: message_embeddings table', () => {
  let driver: BetterSqlite3Driver;

  beforeEach(() => {
    driver = new BetterSqlite3Driver(':memory:');
    initSchema(driver);
    runMigrations(driver, 0, 26);
  });

  afterEach(() => {
    driver.close();
  });

  it('creates message_embeddings with the expected columns and index', () => {
    runMigrations(driver, 26, 27);

    const columns = (driver.pragma('table_info(message_embeddings)') as Array<{ name: string; type: string }>).map(
      (column) => `${column.name}:${column.type}`
    );
    expect(columns).toEqual([
      'row_id:TEXT',
      'conversation_id:TEXT',
      'model:TEXT',
      'dims:INTEGER',
      'vector:BLOB',
      'updated_at:INTEGER',
    ]);

    const indexes = (driver.pragma('index_list(message_embeddings)') as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toContain('idx_message_embeddings_conversation');
  });

  it('leaves the pre-existing tables untouched', () => {
    const before = (
      driver.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((row) => row.name);

    runMigrations(driver, 26, 27);

    const after = (
      driver.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toContain('message_embeddings');
  });

  it('round-trips vectors through the store and reports stats', () => {
    runMigrations(driver, 26, 27);
    const store = new EmbeddingStore(driver);

    store.upsert([
      {
        rowId: 'm1#0',
        conversationId: 'conv-1',
        model: 'bge',
        dims: 3,
        vector: Float32Array.from([0.25, -0.5, 1]),
        updatedAt: 111,
      },
      {
        rowId: 'file:a.md#0',
        conversationId: workspaceConversationId('/tmp/ws'),
        model: 'bge',
        dims: 3,
        vector: Float32Array.from([1, 0, 0]),
        updatedAt: 222,
      },
    ]);

    const rows = store.load();
    expect(rows).toHaveLength(2);
    expect(Array.from(rows.find((row) => row.rowId === 'm1#0')!.vector)).toEqual([0.25, -0.5, 1]);

    expect(store.getFreshness('conv-1', 'bge').get('m1#0')).toBe(111);
    expect(store.getFreshness('conv-1', 'other-model').size).toBe(0);

    expect(store.stats()).toMatchObject({ rows: 2, conversations: 2, workspaceRows: 1, model: 'bge', dims: 3 });

    store.deleteByConversation('conv-1');
    expect(store.load()).toHaveLength(1);
    store.clear();
    expect(store.load()).toHaveLength(0);
  });

  it('ensureSchema creates the same table on a database that never ran the migration', () => {
    const fresh = new BetterSqlite3Driver(':memory:');
    try {
      new EmbeddingStore(fresh).ensureSchema();
      const columns = (fresh.pragma('table_info(message_embeddings)') as Array<{ name: string }>).map((c) => c.name);
      expect(columns).toEqual(['row_id', 'conversation_id', 'model', 'dims', 'vector', 'updated_at']);
    } finally {
      fresh.close();
    }
  });
});
