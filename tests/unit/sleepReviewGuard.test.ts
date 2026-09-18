/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertLocalOnlyProvider,
  filterLocalOnlyProviders,
  isLocalOnlyProvider,
  isLoopbackHost,
} from '@process/services/sleepReview/localOnly';
import {
  acceptProposal,
  previewProposal,
  rollbackProposal,
  runHeldOut,
  runSleepReview,
  type SleepReviewDeps,
} from '@process/services/sleepReview/sleepReviewService';
import { isKnownWorkspace, listTargets, resolveAllowedTarget } from '@process/services/sleepReview/targetGuard';
import { upsertProposal } from '@process/services/sleepReview/proposalStore';
import { sha256 } from '@process/services/sleepReview/editApply';
import type { SleepReviewProposal } from '@/common/types/sleepReview';

let root: string;
let skillsDir: string;
let allowedTarget: string;
let outsideTarget: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sleep-guard-'));
  skillsDir = path.join(root, 'skills');
  allowedTarget = path.join(skillsDir, 'demo', 'SKILL.md');
  outsideTarget = path.join(root, 'secrets', 'id_rsa');

  await fs.mkdir(path.dirname(allowedTarget), { recursive: true });
  await fs.writeFile(allowedTarget, '# demo\n\n## Rules\n\n- one\n', 'utf8');
  await fs.mkdir(path.join(skillsDir, '_builtin', 'shipped'), { recursive: true });
  await fs.writeFile(path.join(skillsDir, '_builtin', 'shipped', 'SKILL.md'), '# builtin\n', 'utf8');
  await fs.mkdir(path.dirname(outsideTarget), { recursive: true });
  await fs.writeFile(outsideTarget, 'PRIVATE\n', 'utf8');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const deps = (): SleepReviewDeps => ({
  rootDir: path.join(root, 'store'),
  skillsDir,
  complete: () => Promise.resolve('{}'),
});

describe('listTargets', () => {
  it('lists user skills and excludes _builtin', async () => {
    const targets = await listTargets({ skillsDir });
    expect(targets.map((target) => target.label)).toEqual(['demo/SKILL.md']);
  });

  it('adds the memory files that exist in an authorized workspace', async () => {
    const workspace = path.join(root, 'ws');
    await fs.mkdir(path.join(workspace, '.aionui'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), 'a', 'utf8');
    await fs.writeFile(path.join(workspace, '.aionui', 'memory.md'), 'm', 'utf8');

    const labels = (await listTargets({ skillsDir, workspace })).map((target) => target.label);
    expect(labels).toContain('AGENTS.md');
    expect(labels).toContain('.aionui/memory.md');
    expect(labels).not.toContain('CLAUDE.md');
  });
});

describe('resolveAllowedTarget', () => {
  it('returns the matching target for a listed path', async () => {
    expect((await resolveAllowedTarget(allowedTarget, { skillsDir })).kind).toBe('skill');
  });

  it('rejects an unlisted path without reading the file', async () => {
    const readSpy = vi.spyOn(fs, 'readFile');
    await expect(resolveAllowedTarget(outsideTarget, { skillsDir })).rejects.toThrow(
      /not a listed sleep review target/
    );
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it('rejects a traversal path that escapes the skills root', async () => {
    const traversal = path.join(skillsDir, 'demo', '..', '..', 'secrets', 'id_rsa');
    await expect(resolveAllowedTarget(traversal, { skillsDir })).rejects.toThrow(/not a listed sleep review target/);
  });

  it('rejects a relative or empty path', async () => {
    await expect(resolveAllowedTarget('demo/SKILL.md', { skillsDir })).rejects.toThrow(/absolute path/);
    await expect(resolveAllowedTarget('', { skillsDir })).rejects.toThrow(/absolute path/);
  });

  it('rejects a _builtin skill path', async () => {
    const builtin = path.join(skillsDir, '_builtin', 'shipped', 'SKILL.md');
    await expect(resolveAllowedTarget(builtin, { skillsDir })).rejects.toThrow(/not a listed sleep review target/);
  });
});

describe('the guard runs on every entry point', () => {
  /** A stored proposal whose targetPath was tampered with to point outside. */
  async function stageTamperedProposal(): Promise<SleepReviewProposal> {
    const proposal: SleepReviewProposal = {
      id: 'tampered',
      createdAt: 1,
      targetPath: outsideTarget,
      targetKind: 'skill',
      baselineSha256: sha256('PRIVATE\n'),
      status: 'staged',
      rationale: 'r',
      edit: { type: 'replace', anchor: '', before: 'PRIVATE', after: 'PUBLIC' },
      heldOutChecks: [],
      risk: '',
      rollback: '',
      modelId: 'm',
      providerId: 'p',
      sourceConversationIds: [],
      backupPath: path.join(root, 'store', 'backups', 'tampered', 'id_rsa'),
    };
    await upsertProposal(path.join(root, 'store'), proposal);
    return proposal;
  }

  it('rejects an unlisted target at run', async () => {
    await expect(
      runSleepReview({ targetPath: outsideTarget, transcripts: [], providerId: 'p', modelId: 'm' }, deps())
    ).rejects.toThrow(/not a listed sleep review target/);
  });

  it('rejects the stored target at preview', async () => {
    await stageTamperedProposal();
    await expect(previewProposal('tampered', deps())).rejects.toThrow(/not a listed sleep review target/);
  });

  it('rejects the stored target at runHeldOut', async () => {
    await stageTamperedProposal();
    await expect(runHeldOut('tampered', deps())).rejects.toThrow(/not a listed sleep review target/);
  });

  it('rejects the stored target at accept and leaves the file untouched', async () => {
    await stageTamperedProposal();
    await expect(acceptProposal('tampered', deps())).rejects.toThrow(/not a listed sleep review target/);
    expect(await fs.readFile(outsideTarget, 'utf8')).toBe('PRIVATE\n');
  });

  it('rejects the stored target at rollback and leaves the file untouched', async () => {
    await stageTamperedProposal();
    await expect(rollbackProposal('tampered', deps())).rejects.toThrow(/not a listed sleep review target/);
    expect(await fs.readFile(outsideTarget, 'utf8')).toBe('PRIVATE\n');
  });
});

describe('isKnownWorkspace', () => {
  const conversations = [{ extra: { workspace: '/tmp/known-workspace' } }, { extra: {} }, {}];

  it('accepts the exact workspace of an existing conversation', () => {
    expect(isKnownWorkspace('/tmp/known-workspace', conversations)).toBe(true);
    expect(isKnownWorkspace('/tmp/known-workspace/', conversations)).toBe(true);
  });

  it('rejects an unknown directory, a relative path and a traversal', () => {
    expect(isKnownWorkspace('/tmp/other', conversations)).toBe(false);
    expect(isKnownWorkspace('known-workspace', conversations)).toBe(false);
    expect(isKnownWorkspace('/tmp/known-workspace/../other', conversations)).toBe(false);
  });

  it('rejects non-string input and an empty list', () => {
    expect(isKnownWorkspace(undefined, conversations)).toBe(false);
    expect(isKnownWorkspace('/tmp/known-workspace', [])).toBe(false);
  });
});

describe('local-only provider gate', () => {
  it('recognizes loopback hosts and rejects everything else', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.4.5.6')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('api.openai.com')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });

  it('accepts local runtimes and rejects hosted APIs', () => {
    expect(isLocalOnlyProvider({ base_url: 'http://localhost:11434/v1' })).toBe(true);
    expect(isLocalOnlyProvider({ base_url: 'http://127.0.0.1:1234/v1' })).toBe(true);
    expect(isLocalOnlyProvider({ base_url: 'https://api.anthropic.com' })).toBe(false);
    expect(isLocalOnlyProvider({ base_url: 'not a url' })).toBe(false);
    expect(isLocalOnlyProvider({})).toBe(false);
  });

  it('filters a provider list down to the local ones', () => {
    const providers = [
      { name: 'Ollama', base_url: 'http://localhost:11434/v1' },
      { name: 'OpenAI', base_url: 'https://api.openai.com/v1' },
    ];
    expect(filterLocalOnlyProviders(providers).map((provider) => provider.name)).toEqual(['Ollama']);
  });

  it('throws for a remote provider and names it', () => {
    expect(() => assertLocalOnlyProvider({ name: 'OpenAI', base_url: 'https://api.openai.com/v1' })).toThrow(/OpenAI/);
    expect(() => assertLocalOnlyProvider({ name: 'Ollama', base_url: 'http://localhost:11434/v1' })).not.toThrow();
  });
});
