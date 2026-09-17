import { describe, expect, it } from 'vitest';
import type { ISqliteDriver, IStatement } from '@process/services/database/drivers/ISqliteDriver';
import { ALL_MIGRATIONS, getMigrationsToRun } from '@process/services/database/migrations';
import { CURRENT_DB_VERSION } from '@process/services/database/schema';
import { EMBEDDINGS_TABLE, SemanticSearchRepository } from '@process/services/semanticSearch/SemanticSearchRepository';

const MIGRATION_VERSION = 27;

/** node:sqlite is used because the bundled better-sqlite3 binary is built for Electron's ABI. */
function createInMemoryDriver(): { driver: ISqliteDriver; close: () => void } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const driver: ISqliteDriver = {
      prepare: (sql: string): IStatement => {
        const statement = db.prepare(sql);
        return {
          get: (...args: unknown[]) => statement.get(...(args as never[])),
          all: (...args: unknown[]) => statement.all(...(args as never[])) as unknown[],
          run: (...args: unknown[]) => {
            const result = statement.run(...(args as never[]));
            return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
          },
        };
      },
      exec: (sql: string) => db.exec(sql),
      pragma: (sql: string, options?: { simple?: boolean }) => {
        if (sql.includes('=')) {
          db.exec(`PRAGMA ${sql}`);
          return undefined;
        }
        const rows = db.prepare(`PRAGMA ${sql}`).all() as Array<Record<string, unknown>>;
        if (!options?.simple) return rows;
        return rows.length > 0 ? Object.values(rows[0])[0] : undefined;
      },
      transaction:
        <T>(fn: (...args: unknown[]) => T) =>
        (...args: unknown[]): T => {
          db.exec('BEGIN');
          try {
            const result = fn(...args);
            db.exec('COMMIT');
            return result;
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
      close: () => db.close(),
    };
    return { driver, close: () => db.close() };
  } catch {
    return null;
  }
}

const harness = createInMemoryDriver();

describe('migration v27 — message_embeddings', () => {
  it('is registered and matches the schema version constant', () => {
    expect(ALL_MIGRATIONS.some((migration) => migration.version === MIGRATION_VERSION)).toBe(true);
    expect(CURRENT_DB_VERSION).toBe(MIGRATION_VERSION);
    expect(getMigrationsToRun(MIGRATION_VERSION - 1, MIGRATION_VERSION).map((m) => m.version)).toEqual([
      MIGRATION_VERSION,
    ]);
  });

  it.skipIf(!harness)('creates the table and its conversation index on a fresh database', () => {
    const db = harness!.driver;
    const migration = ALL_MIGRATIONS.find((entry) => entry.version === MIGRATION_VERSION)!;

    migration.up(db);

    const columns = (db.pragma(`table_info(${EMBEDDINGS_TABLE})`) as Array<{ name: string; notnull: number }>).map(
      (column) => column.name
    );
    expect(columns).toEqual(['message_id', 'conversation_id', 'model', 'dims', 'vector', 'updated_at']);

    const indexes = (db.pragma(`index_list(${EMBEDDINGS_TABLE})`) as Array<{ name: string }>).map(
      (index) => index.name
    );
    expect(indexes).toContain('idx_message_embeddings_conversation');

    // Re-running must be a no-op, since migrations can be retried after a crash.
    expect(() => migration.up(db)).not.toThrow();
  });

  it.skipIf(!harness)('stores, reads back and reports vectors through the repository', () => {
    const repo = new SemanticSearchRepository(harness!.driver);

    repo.upsertMany([
      { messageId: 'm1#0', conversationId: 'c1', model: 'embedding', vector: [0.5, -0.5], updatedAt: 10 },
      { messageId: 'm2#0', conversationId: 'c1', model: 'embedding', vector: [1, 0], updatedAt: 20 },
      { messageId: 'file:a.md#0', conversationId: 'workspace:/ws', model: 'embedding', vector: [0, 1], updatedAt: 30 },
    ]);

    expect(repo.getUpdatedAtMap('c1')).toEqual(
      new Map([
        ['m1#0', 10],
        ['m2#0', 20],
      ])
    );
    expect(repo.listVectors('c1').map((row) => row.messageId)).toEqual(['m1#0', 'm2#0']);
    expect(Array.from(repo.listVectors('c1')[0].vector)).toEqual([0.5, -0.5]);
    expect(repo.stats()).toMatchObject({ rows: 3, conversations: 2, lastIndexedAt: 30, dimensions: 2 });

    // A second write for the same row id replaces it instead of failing on the primary key.
    repo.upsertMany([
      { messageId: 'm1#0', conversationId: 'c1', model: 'embedding', vector: [0, 0.25], updatedAt: 40 },
    ]);
    expect(repo.stats().rows).toBe(3);
    expect(Array.from(repo.listVectors('c1')[0].vector)).toEqual([0, 0.25]);

    repo.deleteByConversation('workspace:/ws');
    expect(repo.stats().rows).toBe(2);

    repo.clear();
    expect(repo.stats()).toMatchObject({ rows: 0, conversations: 0, lastIndexedAt: null });
  });

  it.skipIf(!harness)('drops the table on rollback', () => {
    const db = harness!.driver;
    const migration = ALL_MIGRATIONS.find((entry) => entry.version === MIGRATION_VERSION)!;

    migration.down(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .all(EMBEDDINGS_TABLE) as unknown[];
    expect(tables).toEqual([]);
  });
});
