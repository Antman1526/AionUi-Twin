// tests/unit/process/team/getOrStartSessionLock.test.ts
//
// Covers docs/architecture/team-mode-performance.md #5: getOrStartSession had
// no in-flight lock, so two concurrent callers for the same team could each
// create their own TeamSession + MCP server. TeamSessionService now serializes
// concurrent starts per team via an in-flight promise map.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ITeamRepository } from '@process/team/repository/ITeamRepository';
import type { TTeam } from '@process/team/types';

const startMcpServer = vi.fn();
const teamSessionCtor = vi.fn();

vi.mock('@process/team/TeamSession', () => ({
  TeamSession: vi.fn().mockImplementation(function (this: Record<string, unknown>, team: TTeam) {
    teamSessionCtor(team.id);
    this.startMcpServer = startMcpServer;
    this.getStdioConfig = vi.fn(() => null);
    this.dispose = vi.fn();
  }),
}));

import { TeamSessionService } from '@process/team/TeamSessionService';

function makeTeam(): TTeam {
  return {
    id: 'team-1',
    userId: 'user-1',
    name: 'Test Team',
    workspace: '',
    workspaceMode: 'shared',
    leaderAgentId: 'slot-1',
    agents: [
      {
        slotId: 'slot-1',
        // No conversationId — skips the post-start per-agent MCP config write,
        // keeping this test focused purely on the in-flight start lock.
        conversationId: '',
        role: 'leader',
        agentType: 'claude',
        agentName: 'Leader',
        conversationType: 'acp',
        status: 'idle',
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeRepo(team: TTeam): ITeamRepository {
  return {
    findById: vi.fn().mockResolvedValue(team),
  } as unknown as ITeamRepository;
}

describe('TeamSessionService.getOrStartSession — in-flight lock', () => {
  beforeEach(() => {
    startMcpServer.mockReset();
    teamSessionCtor.mockClear();
  });

  it('starts the session once for concurrent callers, both resolving to the same instance', async () => {
    const team = makeTeam();
    const repo = makeRepo(team);
    let resolveStart!: () => void;
    startMcpServer.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        })
    );

    const service = new TeamSessionService(repo, {} as any, {} as any);

    const p1 = service.getOrStartSession('team-1');
    const p2 = service.getOrStartSession('team-1');

    // Let the pending microtasks (repo.findById, getTeam) settle before the
    // second call would otherwise race ahead and start its own session.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both calls should share the single in-flight start — only one TeamSession
    // and one startMcpServer() call, even though neither has resolved yet.
    expect(teamSessionCtor).toHaveBeenCalledTimes(1);
    expect(startMcpServer).toHaveBeenCalledTimes(1);

    resolveStart();
    const [session1, session2] = await Promise.all([p1, p2]);
    expect(session1).toBe(session2);
  });

  it('clears the lock on a failed start so a retry starts a fresh session', async () => {
    const team = makeTeam();
    const repo = makeRepo(team);
    startMcpServer.mockRejectedValueOnce(new Error('mcp boom'));

    const service = new TeamSessionService(repo, {} as any, {} as any);

    await expect(service.getOrStartSession('team-1')).rejects.toThrow('mcp boom');
    expect(teamSessionCtor).toHaveBeenCalledTimes(1);

    startMcpServer.mockResolvedValueOnce(undefined);
    const session = await service.getOrStartSession('team-1');
    expect(session).toBeDefined();
    expect(teamSessionCtor).toHaveBeenCalledTimes(2);
  });
});
