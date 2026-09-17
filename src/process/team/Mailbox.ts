// src/process/team/Mailbox.ts
import type { ITeamRepository } from './repository/ITeamRepository';
import type { MailboxMessage } from './types';

/** How long a read mailbox message is kept before it's eligible for cleanup. */
export const MAILBOX_READ_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
/** Minimum time between opportunistic cleanup runs (no dedicated timer). */
const MAILBOX_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Thin service layer over ITeamRepository's mailbox methods. */
export class Mailbox {
  // -Infinity so the very first write always runs the cleanup check.
  private lastCleanupAt = -Infinity;

  constructor(private readonly repo: ITeamRepository) {}

  /**
   * Write a message to an agent's mailbox.
   * @returns The persisted message.
   */
  async write(params: {
    teamId: string;
    toAgentId: string;
    fromAgentId: string;
    content: string;
    type?: MailboxMessage['type'];
    summary?: string;
    files?: string[];
  }): Promise<MailboxMessage> {
    const message: MailboxMessage = {
      id: crypto.randomUUID(),
      teamId: params.teamId,
      toAgentId: params.toAgentId,
      fromAgentId: params.fromAgentId,
      type: params.type ?? 'message',
      content: params.content,
      summary: params.summary,
      files: params.files,
      read: false,
      createdAt: Date.now(),
    };

    const persisted = await this.repo.writeMessage(message);
    this.maybeCleanupReadMessages(params.teamId);
    return persisted;
  }

  /**
   * Opportunistically deletes old read messages for this team, throttled to
   * run at most once per hour. Piggybacks on write() instead of a dedicated
   * timer, and is best-effort (a failure here must not affect message delivery).
   */
  private maybeCleanupReadMessages(teamId: string): void {
    const now = Date.now();
    if (now - this.lastCleanupAt < MAILBOX_CLEANUP_INTERVAL_MS) return;
    this.lastCleanupAt = now;
    void this.repo.deleteReadMessagesOlderThan?.(teamId, now - MAILBOX_READ_MESSAGE_TTL_MS)?.catch((error) => {
      console.warn('[Mailbox] Failed to clean up old read messages:', error);
    });
  }

  /**
   * Read all unread messages for an agent, atomically marking them as read.
   * Uses a single transaction to prevent concurrent double-reads.
   */
  async readUnread(teamId: string, agentId: string): Promise<MailboxMessage[]> {
    return this.repo.readUnreadAndMark(teamId, agentId);
  }

  /**
   * Get message history for an agent (newest first).
   */
  async getHistory(teamId: string, agentId: string, limit?: number): Promise<MailboxMessage[]> {
    return this.repo.getMailboxHistory(teamId, agentId, limit);
  }
}
