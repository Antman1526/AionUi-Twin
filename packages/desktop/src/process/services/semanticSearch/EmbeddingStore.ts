/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { deserializeVector, serializeVector } from './vectorMath';

/**
 * DDL for the embedding table. Kept byte-identical to migration v27 in
 * `migrations.ts` so a database created here and one upgraded by the migration
 * runner end up with the same shape.
 */
export const MESSAGE_EMBEDDINGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS message_embeddings (
    row_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    model TEXT NOT NULL,
    dims INTEGER NOT NULL,
    vector BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )`;

export const MESSAGE_EMBEDDINGS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_message_embeddings_conversation ON message_embeddings(conversation_id)';

export type EmbeddingRow = {
  rowId: string;
  conversationId: string;
  model: string;
  dims: number;
  vector: Float32Array;
  updatedAt: number;
};

export type EmbeddingIndexStats = {
  rows: number;
  conversations: number;
  workspaceRows: number;
  model: string | null;
  dims: number | null;
  updatedAt: number | null;
};

type RawRow = {
  row_id: string;
  conversation_id: string;
  model: string;
  dims: number;
  vector: Uint8Array;
  updated_at: number;
};

/**
 * Persistence for chunk embeddings, plus an in-memory cache of the decoded
 * Float32Arrays. Brute-force cosine scan is fast enough at this scale; decoding
 * the BLOBs on every query is not, hence the cache.
 */
export class EmbeddingStore {
  private cache: EmbeddingRow[] | null = null;

  constructor(private readonly db: ISqliteDriver) {}

  /** Create the table/index if this database has not seen migration v27. */
  ensureSchema(): void {
    this.db.exec(MESSAGE_EMBEDDINGS_TABLE_SQL);
    this.db.exec(MESSAGE_EMBEDDINGS_INDEX_SQL);
  }

  /** Drop the cached vectors; called after every write. */
  invalidate(): void {
    this.cache = null;
  }

  upsert(rows: readonly EmbeddingRow[]): void {
    if (rows.length === 0) return;
    const statement = this.db.prepare(
      `INSERT INTO message_embeddings (row_id, conversation_id, model, dims, vector, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(row_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         model = excluded.model,
         dims = excluded.dims,
         vector = excluded.vector,
         updated_at = excluded.updated_at`
    );
    const writeAll = this.db.transaction(() => {
      for (const row of rows) {
        statement.run(row.rowId, row.conversationId, row.model, row.dims, serializeVector(row.vector), row.updatedAt);
      }
    });
    writeAll();
    this.invalidate();
  }

  /**
   * `row_id -> updated_at` for one conversation, restricted to rows written by
   * `model`. Rows from another model are omitted so switching models re-indexes.
   */
  getFreshness(conversationId: string, model: string): Map<string, number> {
    const rows = this.db
      .prepare('SELECT row_id, updated_at FROM message_embeddings WHERE conversation_id = ? AND model = ?')
      .all(conversationId, model) as Array<{ row_id: string; updated_at: number }>;
    return new Map(rows.map((row) => [row.row_id, row.updated_at]));
  }

  /** All rows, or only those of one conversation. Results are cached when unfiltered. */
  load(conversationId?: string): EmbeddingRow[] {
    if (conversationId !== undefined) {
      const raw = this.db
        .prepare('SELECT * FROM message_embeddings WHERE conversation_id = ?')
        .all(conversationId) as RawRow[];
      return raw.map(toEmbeddingRow);
    }
    if (!this.cache) {
      const raw = this.db.prepare('SELECT * FROM message_embeddings').all() as RawRow[];
      this.cache = raw.map(toEmbeddingRow);
    }
    return this.cache;
  }

  deleteByConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM message_embeddings WHERE conversation_id = ?').run(conversationId);
    this.invalidate();
  }

  clear(): void {
    this.db.exec('DELETE FROM message_embeddings');
    this.invalidate();
  }

  stats(): EmbeddingIndexStats {
    const summary = this.db
      .prepare(
        `SELECT COUNT(*) AS rows,
                COUNT(DISTINCT conversation_id) AS conversations,
                MAX(updated_at) AS updated_at
         FROM message_embeddings`
      )
      .get() as { rows: number; conversations: number; updated_at: number | null } | undefined;

    const workspace = this.db
      .prepare("SELECT COUNT(*) AS rows FROM message_embeddings WHERE conversation_id LIKE 'workspace:%'")
      .get() as { rows: number } | undefined;

    const latest = this.db
      .prepare('SELECT model, dims FROM message_embeddings ORDER BY updated_at DESC LIMIT 1')
      .get() as { model: string; dims: number } | undefined;

    return {
      rows: summary?.rows ?? 0,
      conversations: summary?.conversations ?? 0,
      workspaceRows: workspace?.rows ?? 0,
      model: latest?.model ?? null,
      dims: latest?.dims ?? null,
      updatedAt: summary?.updated_at ?? null,
    };
  }
}

function toEmbeddingRow(raw: RawRow): EmbeddingRow {
  return {
    rowId: raw.row_id,
    conversationId: raw.conversation_id,
    model: raw.model,
    dims: raw.dims,
    vector: deserializeVector(raw.vector),
    updatedAt: raw.updated_at,
  };
}
