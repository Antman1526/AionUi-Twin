// tests/unit/process/team/mailboxCleanup.test.ts
//
// Covers docs/architecture/team-mode-performance.md #6: read mailbox messages
// were never deleted. Tests the new SqliteTeamRepository.deleteReadMessagesOlderThan,
// Mailbox's throttled opportunistic cleanup on write(), and TeamSessionService
// running cleanup when a team session stops.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CURRENT_DB_VERSION, initSchema } from '@process/services/database/schema';
import { runMigrations } from '@process/services/database/migrations';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import { SqliteTeamRepository } from '@process/team/repository/SqliteTeamRepository';
import { Mailbox, MAILBOX_READ_MESSAGE_TTL_MS } from '@process/team/Mailbox';
import { TeamSessionService } from '@process/team/TeamSessionService';
import type { ITeamRepository } from '@process/team/repository/ITeamRepository';
import type { MailboxMessage, TTeam } from '@process/team/types';

let nativeModuleAvailable = true;
try {
  const d = new BetterSqlite3Driver(':memory:');
  d.close();
} catch (e) {
  if (e instanceof Error && e.message.includes('NODE_MODULE_VERSION')) {
    nativeModuleAvailable = false;
  }
}

const describeOrSkip = nativeModuleAvailable ? describe : describe.skip;

function makeTeam(overrides: Partial<TTeam> = {}): TTeam {
  return {
    id: 'team-1',
    userId: 'user-1',
    name: 'Test Team',
    workspace: '/tmp/workspace',
    workspaceMode: 'shared',
    leaderAgentId: 'slot-1',
    agents: [
      {
        slotId: 'slot-1',
        conversationId: 'conv-1',
        role: 'leader',
        agentType: 'acp',
        agentName: 'Claude',
        conversationType: 'acp',
        status: 'idle',
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

const msg = (id: string, overrides: Partial<MailboxMessage> = {}): MailboxMessage => ({
  id,
  teamId: 'team-1',
  toAgentId: 'agent-a',
  fromAgentId: 'agent-b',
  type: 'message',
  content: `msg-${id}`,
  read: false,
  createdAt: Date.now(),
  ...overrides,
});

describeOrSkip('SqliteTeamRepository.deleteReadMessagesOlderThan', () => {
  let repo: SqliteTeamRepository;
  let driver: BetterSqlite3Driver;

  beforeEach(() => {
    driver = new BetterSqlite3Driver(':memory:');
    initSchema(driver);
    runMigrations(driver, 0, CURRENT_DB_VERSION);
    driver
      .prepare(`INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('user-1', 'testuser', 'hash', 1000, 1000);
    repo = new SqliteTeamRepository(driver);
  });

  afterEach(() => {
    driver.close();
  });

  it('deletes only read messages older than the cutoff for the given team', async () => {
    await repo.create(makeTeam());
    const cutoff = 10_000;
    await repo.writeMessage(msg('old-read', { read: true, createdAt: 1000 }));
    await repo.writeMessage(msg('new-read', { read: true, createdAt: 20_000 }));
    await repo.writeMessage(msg('old-unread', { read: false, createdAt: 1000 }));

    await repo.deleteReadMessagesOlderThan('team-1', cutoff);

    const remaining = await repo.getMailboxHistory('team-1', 'agent-a', 100);
    expect(remaining.map((m) => m.id).toSorted()).toEqual(['new-read', 'old-unread']);
  });

  it('deletes across all teams when teamId is undefined', async () => {
    await repo.create(makeTeam({ id: 'team-1' }));
    await repo.create(makeTeam({ id: 'team-2', name: 'Team 2' }));
    await repo.writeMessage(msg('t1-old-read', { teamId: 'team-1', read: true, createdAt: 1000 }));
    await repo.writeMessage({ ...msg('t2-old-read', { read: true, createdAt: 1000 }), teamId: 'team-2' });

    await repo.deleteReadMessagesOlderThan(undefined, 10_000);

    expect(await repo.getMailboxHistory('team-1', 'agent-a', 100)).toHaveLength(0);
    expect(await repo.getMailboxHistory('team-2', 'agent-a', 100)).toHaveLength(0);
  });
});

describe('Mailbox — throttled opportunistic cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleans up at most once per hour, scoped to the message team', async () => {
    const deleteReadMessagesOlderThan = vi.fn().mockResolvedValue(undefined);
    const repo = {
      writeMessage: vi.fn(async (m: MailboxMessage) => m),
      deleteReadMessagesOlderThan,
    } as unknown as ITeamRepository;
    const mailbox = new Mailbox(repo);

    await mailbox.write({ teamId: 'team-1', toAgentId: 'a', fromAgentId: 'b', content: 'hi' });
    await mailbox.write({ teamId: 'team-1', toAgentId: 'a', fromAgentId: 'b', content: 'hi again' });
    expect(deleteReadMessagesOlderThan).toHaveBeenCalledTimes(1);
    expect(deleteReadMessagesOlderThan).toHaveBeenCalledWith('team-1', 0 - MAILBOX_READ_MESSAGE_TTL_MS);

    // Advance less than an hour — still throttled.
    vi.setSystemTime(30 * 60 * 1000);
    await mailbox.write({ teamId: 'team-1', toAgentId: 'a', fromAgentId: 'b', content: 'still soon' });
    expect(deleteReadMessagesOlderThan).toHaveBeenCalledTimes(1);

    // Advance past an hour — cleanup runs again.
    vi.setSystemTime(61 * 60 * 1000);
    await mailbox.write({ teamId: 'team-1', toAgentId: 'a', fromAgentId: 'b', content: 'an hour later' });
    expect(deleteReadMessagesOlderThan).toHaveBeenCalledTimes(2);
  });

  it('does not fail the write when cleanup rejects', async () => {
    const repo = {
      writeMessage: vi.fn(async (m: MailboxMessage) => m),
      deleteReadMessagesOlderThan: vi.fn().mockRejectedValue(new Error('cleanup boom')),
    } as unknown as ITeamRepository;
    const mailbox = new Mailbox(repo);

    await expect(
      mailbox.write({ teamId: 'team-1', toAgentId: 'a', fromAgentId: 'b', content: 'hi' })
    ).resolves.toBeDefined();
  });

  it('is a no-op when the repository does not implement deleteReadMessagesOlderThan', async () => {
    const repo = {
      writeMessage: vi.fn(async (m: MailboxMessage) => m),
    } as unknown as ITeamRepository;
    const mailbox = new Mailbox(repo);

    await expect(
      mailbox.write({ teamId: 'team-1', toAgentId: 'a', fromAgentId: 'b', content: 'hi' })
    ).resolves.toBeDefined();
  });
});

describe('TeamSessionService.stopSession — mailbox cleanup on stop', () => {
  it('cleans up old read mailbox messages for the stopped team', async () => {
    const deleteReadMessagesOlderThan = vi.fn().mockResolvedValue(undefined);
    const repo = { deleteReadMessagesOlderThan } as unknown as ITeamRepository;
    const service = new TeamSessionService(repo, {} as any, {} as any);

    await service.stopSession('team-1');

    expect(deleteReadMessagesOlderThan).toHaveBeenCalledTimes(1);
    const [teamIdArg, cutoffArg] = deleteReadMessagesOlderThan.mock.calls[0];
    expect(teamIdArg).toBe('team-1');
    expect(typeof cutoffArg).toBe('number');
  });

  it('does not throw when the repository lacks deleteReadMessagesOlderThan', async () => {
    const repo = {} as unknown as ITeamRepository;
    const service = new TeamSessionService(repo, {} as any, {} as any);

    await expect(service.stopSession('team-1')).resolves.toBeUndefined();
  });
});
