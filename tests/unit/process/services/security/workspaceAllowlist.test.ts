import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectKnownWorkspaces, isKnownWorkspace } from '@process/services/security/workspaceAllowlist';

const conversations = [
  { extra: { workspace: '/Users/dev/projects/alpha' } },
  { extra: { workspace: '/Users/dev/projects/beta/' } },
  { extra: {} },
  { extra: { workspace: '   ' } },
  {},
];

describe('isKnownWorkspace', () => {
  it('accepts a workspace that an existing conversation owns', () => {
    expect(isKnownWorkspace('/Users/dev/projects/alpha', conversations)).toBe(true);
  });

  it('accepts a trailing-separator form of a known workspace', () => {
    expect(isKnownWorkspace('/Users/dev/projects/alpha/', conversations)).toBe(true);
    expect(isKnownWorkspace('/Users/dev/projects/beta', conversations)).toBe(true);
  });

  it('normalises ".." segments before comparing', () => {
    expect(isKnownWorkspace('/Users/dev/projects/beta/../alpha', conversations)).toBe(true);
    expect(isKnownWorkspace('/Users/dev/projects/alpha/..', conversations)).toBe(false);
  });

  it('rejects an unknown directory', () => {
    expect(isKnownWorkspace('/', conversations)).toBe(false);
    expect(isKnownWorkspace('/Users/dev/.ssh', conversations)).toBe(false);
    expect(isKnownWorkspace('/Users/dev/projects', conversations)).toBe(false);
  });

  it('rejects an empty path and any path when there are no conversations', () => {
    expect(isKnownWorkspace('', conversations)).toBe(false);
    expect(isKnownWorkspace('   ', conversations)).toBe(false);
    expect(isKnownWorkspace('/Users/dev/projects/alpha', [])).toBe(false);
  });
});

describe('collectKnownWorkspaces', () => {
  it('resolves and de-duplicates workspaces, skipping blank ones', () => {
    expect(collectKnownWorkspaces(conversations)).toEqual([
      path.resolve('/Users/dev/projects/alpha'),
      path.resolve('/Users/dev/projects/beta'),
    ]);
  });
});
