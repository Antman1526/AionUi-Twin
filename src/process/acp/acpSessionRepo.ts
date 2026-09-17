/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentConfig } from '@process/acp/types';
import type { IAcpSessionRepository } from '@process/services/database/IAcpSessionRepository';

/**
 * Serialize an AgentConfig for the `acp_session.session_config` column.
 * `authCredentials` is dropped — API keys must never be written to the DB.
 */
export function serializeSessionConfig(config: AgentConfig): string {
  const { authCredentials: _authCredentials, ...safe } = config;
  return JSON.stringify(safe);
}

let repoPromise: Promise<IAcpSessionRepository | null> | null = null;

/**
 * Lazily resolve the process-wide `acp_session` repository.
 *
 * The database modules are imported dynamically so the ACP runtime does not
 * pull better-sqlite3 / Electron into its module graph at import time.
 * Resolves to `null` instead of rejecting when the database is unavailable —
 * acp_session persistence must never break the conversation flow.
 */
export function getAcpSessionRepository(): Promise<IAcpSessionRepository | null> {
  if (!repoPromise) {
    repoPromise = (async (): Promise<IAcpSessionRepository | null> => {
      const { getDatabase } = await import('@process/services/database');
      const { SqliteAcpSessionRepository } = await import('@process/services/database/SqliteAcpSessionRepository');
      const db = await getDatabase();
      return new SqliteAcpSessionRepository(db.getDriver());
    })().catch((err): IAcpSessionRepository | null => {
      console.warn('[acpSessionRepo] acp_session persistence unavailable:', err);
      return null;
    });
  }
  return repoPromise;
}
