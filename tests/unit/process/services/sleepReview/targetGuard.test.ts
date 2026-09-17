import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleepReviewTarget } from '@/common/types/sleepReview';

const listTargetsMock = vi.fn<(params?: { workspace?: string }) => Promise<SleepReviewTarget[]>>();

vi.mock('@process/services/sleepReview/targets', () => ({
  listTargets: (params?: { workspace?: string }) => listTargetsMock(params),
}));

import { isKnownWorkspace, resolveAllowedTarget } from '@process/services/sleepReview/targetGuard';

let workspace: string;
let readmePath: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sleep-review-guard-'));
  readmePath = path.join(workspace, 'README.md');
  await fs.writeFile(readmePath, '# readme\n', 'utf8');
  listTargetsMock.mockReset();
  listTargetsMock.mockResolvedValue([{ path: readmePath, kind: 'memory', label: 'README.md' }]);
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('resolveAllowedTarget', () => {
  it('returns the listed target for an exact path', async () => {
    const target = await resolveAllowedTarget(readmePath, workspace);
    expect(target).toEqual({ path: readmePath, kind: 'memory', label: 'README.md' });
    expect(listTargetsMock).toHaveBeenCalledWith({ workspace });
  });

  it('matches a non-normalised path that resolves to a listed target', async () => {
    const noisy = path.join(workspace, 'sub', '..', 'README.md');
    const target = await resolveAllowedTarget(noisy, workspace);
    expect(target.path).toBe(readmePath);
  });

  it('rejects an absolute path outside the target list', async () => {
    await expect(resolveAllowedTarget('/etc/hosts', workspace)).rejects.toThrow('Not an allowed Sleep Review target');
  });

  it('rejects a traversal path that escapes the workspace', async () => {
    const escaped = path.join(workspace, '..', '..', 'etc', 'hosts');
    await expect(resolveAllowedTarget(escaped, workspace)).rejects.toThrow('Not an allowed Sleep Review target');
  });

  it('rejects a sibling file inside the workspace that is not a listed target', async () => {
    const secret = path.join(workspace, 'secrets.env');
    await fs.writeFile(secret, 'TOKEN=abc\n', 'utf8');
    await expect(resolveAllowedTarget(secret, workspace)).rejects.toThrow('Not an allowed Sleep Review target');
  });

  it('rejects an empty path without consulting the target list', async () => {
    await expect(resolveAllowedTarget('  ')).rejects.toThrow('target path is required');
    expect(listTargetsMock).not.toHaveBeenCalled();
  });
});

describe('isKnownWorkspace', () => {
  it('accepts a workspace that belongs to a conversation', () => {
    expect(isKnownWorkspace(workspace, [{ extra: { workspace } }])).toBe(true);
  });

  it('accepts a non-normalised spelling of a known workspace', () => {
    expect(isKnownWorkspace(path.join(workspace, 'sub', '..'), [{ extra: { workspace } }])).toBe(true);
  });

  it('rejects a workspace no conversation uses', () => {
    expect(isKnownWorkspace('/tmp/attacker-controlled', [{ extra: { workspace } }])).toBe(false);
  });

  it('rejects when no conversation carries a workspace', () => {
    expect(isKnownWorkspace(workspace, [{}, { extra: {} }])).toBe(false);
  });

  it('rejects an empty workspace path', () => {
    expect(isKnownWorkspace('   ', [{ extra: { workspace } }])).toBe(false);
  });
});
