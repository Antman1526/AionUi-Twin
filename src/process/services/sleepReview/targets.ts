/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SleepReviewTarget } from '@/common/types/sleepReview';
import { getBuiltinSkillsCopyDir, getSkillsDir } from '@process/utils/initStorage';

/** Memory artifacts reviewed in a workspace root, in preference order. */
const MEMORY_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md', path.join('.aionui', 'memory.md')];

async function listSkillTargets(dir: string): Promise<SleepReviewTarget[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }

  const targets: SleepReviewTarget[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    // `_builtin` skills are app-managed and re-synced on every startup.
    if (entry.name === '_builtin' || entry.name.startsWith('.')) continue;
    const skillFile = path.join(dir, entry.name, 'SKILL.md');
    try {
      await fs.access(skillFile);
    } catch {
      continue;
    }
    targets.push({ path: skillFile, kind: 'skill', label: entry.name });
  }
  return targets;
}

async function listMemoryTargets(workspace: string): Promise<SleepReviewTarget[]> {
  const targets: SleepReviewTarget[] = [];
  for (const relative of MEMORY_FILES) {
    const absolute = path.join(workspace, relative);
    try {
      await fs.access(absolute);
    } catch {
      continue;
    }
    targets.push({ path: absolute, kind: 'memory', label: relative });
  }
  return targets;
}

/**
 * List every instruction file a proposal may target: user + bundled skills
 * (excluding the app-managed `_builtin` set) plus workspace memory files.
 *
 * @param params.workspace Optional workspace root whose memory files to include.
 */
export async function listTargets(params: { workspace?: string } = {}): Promise<SleepReviewTarget[]> {
  const skillDirs = [getSkillsDir(), getBuiltinSkillsCopyDir()];
  const skillTargets = (await Promise.all(skillDirs.map(listSkillTargets))).flat();

  const seen = new Set<string>();
  const unique = skillTargets.filter((target) => {
    if (seen.has(target.path)) return false;
    seen.add(target.path);
    return true;
  });

  const memoryTargets = params.workspace ? await listMemoryTargets(params.workspace) : [];
  return [...unique, ...memoryTargets];
}
