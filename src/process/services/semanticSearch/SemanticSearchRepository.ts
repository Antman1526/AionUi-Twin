/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { SemanticIndexStats } from './types';
import { deserializeVector, serializeVector } from './vectors';

/** Name of the table created by database migration v27. */
export const EMBEDDINGS_TABLE = 'message_embeddings';

const UPSERT_SQL = `INSERT INTO ${EMBEDDINGS_TABLE} (message_id, conversation_id, model, dims, vector, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(message_id) DO UPDATE SET
  conversation_id = excluded.conversation_id,
  model = excluded.model,
  dims = excluded.dims,
  vector = excluded.vector,
  updated_at = excluded.updated_at`;

/** A row about to be written to the index. */
export type EmbeddingRowInput = {
  messageId: string;
  conversationId: string;
  model: string;
  vector: readonly number[] | Float32Array;
  updatedAt: number;
};

/** A row read back from the index, with its vector decoded. */
export type EmbeddingRecord = {
  messageId: string;
  conversationId: string;
  model: string;
  dims: number;
  vector: Float32Array;
  updatedAt: number;
};

type RawRow = {
  message_id: string;
  conversation_id: string;
  model: string;
  dims: number;
  vector: Uint8Array;
  updated_at: number;
};

/**
 * SQLite access for the `message_embeddings` table.
 *
 * Standalone rather than folded into `AionUIDatabase` so it can be constructed
 * over any {@link ISqliteDriver} — including an in-memory one in tests.
 */
export class SemanticSearchRepository {
  constructor(private readonly db: ISqliteDriver) {}

  /** Insert or replace rows, in one transaction. */
  upsertMany(rows: readonly EmbeddingRowInput[]): void {
    if (rows.length === 0) return;
    const statement = this.db.prepare(UPSERT_SQL);
    const run = this.db.transaction(() => {
      for (const row of rows) {
        const vector = row.vector instanceof Float32Array ? row.vector : Float32Array.from(row.vector);
        statement.run(
          row.messageId,
          row.conversationId,
          row.model,
          vector.length,
          serializeVector(vector),
          row.updatedAt
        );
      }
    });
    run();
  }

  /** `messageId -> updated_at` for one conversation, used to skip up-to-date rows. */
  getUpdatedAtMap(conversationId: string): Map<string, number> {
    const rows = this.db
      .prepare(`SELECT message_id, updated_at FROM ${EMBEDDINGS_TABLE} WHERE conversation_id = ?`)
      .all(conversationId) as Array<{ message_id: string; updated_at: number }>;
    return new Map(rows.map((row) => [row.message_id, row.updated_at]));
  }

  /** Every stored row, optionally narrowed to one conversation. */
  listVectors(conversationId?: string): EmbeddingRecord[] {
    const rows = (
      conversationId
        ? this.db.prepare(`SELECT * FROM ${EMBEDDINGS_TABLE} WHERE conversation_id = ?`).all(conversationId)
        : this.db.prepare(`SELECT * FROM ${EMBEDDINGS_TABLE}`).all()
    ) as RawRow[];
    return rows.map((row) => ({
      messageId: row.message_id,
      conversationId: row.conversation_id,
      model: row.model,
      dims: row.dims,
      vector: deserializeVector(row.vector),
      updatedAt: row.updated_at,
    }));
  }

  /** Drop every row belonging to one conversation (or one workspace). */
  deleteByConversation(conversationId: string): void {
    this.db.prepare(`DELETE FROM ${EMBEDDINGS_TABLE} WHERE conversation_id = ?`).run(conversationId);
  }

  /** Drop the whole index. */
  clear(): void {
    this.db.exec(`DELETE FROM ${EMBEDDINGS_TABLE}`);
  }

  /** Counters shown in the settings panel. */
  stats(): SemanticIndexStats {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS rows_count,
                COUNT(DISTINCT conversation_id) AS conversations,
                MAX(updated_at) AS last_indexed_at,
                MAX(model) AS model,
                MAX(dims) AS dims
         FROM ${EMBEDDINGS_TABLE}`
      )
      .get() as
      | {
          rows_count: number;
          conversations: number;
          last_indexed_at: number | null;
          model: string | null;
          dims: number | null;
        }
      | undefined;
    return {
      rows: row?.rows_count ?? 0,
      conversations: row?.conversations ?? 0,
      lastIndexedAt: row?.last_indexed_at ?? null,
      model: row?.model ?? null,
      dimensions: row?.dims ?? null,
    };
  }
}
