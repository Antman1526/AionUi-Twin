/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

/**
 * Tests that the mandatory built-in `skillopt-sleep` skill (a bundled SKILL.md
 * that must be auto-injected for every ACP agent) is actually discovered by
 * AcpSkillManager and shows up in the injected skill index text.
 */

const REAL_BUILTIN_DIR = path.resolve(__dirname, '../../../../src/process/resources/skills/_builtin');
const SKILL_MD_PATH = path.join(REAL_BUILTIN_DIR, 'skillopt-sleep', 'SKILL.md');

const TEST_ROOT = '/tmp/aionui-skillopt-sleep-test';
const AUTO_SKILLS_DIR = path.join(TEST_ROOT, 'skills', '_builtin');

// Inline literal paths (matching tests/unit/skillsMarket.test.ts) rather than
// referencing the outer consts, since vi.mock factories are hoisted above
// other top-level statements in the file.
vi.mock('electron', () => ({ app: { setName: vi.fn(), getPath: () => '/tmp/aionui-skillopt-sleep-test' } }));
vi.mock('../../../../src/process/utils/initStorage', () => ({
  getSkillsDir: () => '/tmp/aionui-skillopt-sleep-test/skills',
  getAutoSkillsDir: () => '/tmp/aionui-skillopt-sleep-test/skills/_builtin',
  getBuiltinSkillsCopyDir: () => '/tmp/aionui-skillopt-sleep-test/builtin-skills',
}));

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      return entry.isDirectory() ? copyDirRecursive(srcPath, destPath) : fs.copyFile(srcPath, destPath);
    })
  );
}

describe('AcpSkillManager — skillopt-sleep builtin skill discovery', () => {
  beforeEach(async () => {
    // Point getAutoSkillsDir() at a temp copy of the REAL _builtin directory
    // (not a hand-written fixture) so this test catches a real regression if
    // skillopt-sleep is ever removed, renamed, or fails to be discovered.
    await copyDirRecursive(REAL_BUILTIN_DIR, AUTO_SKILLS_DIR);
  });

  afterEach(async () => {
    const { AcpSkillManager } = await import('../../../../src/process/task/AcpSkillManager');
    AcpSkillManager.resetInstance();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('discoverAutoSkills() discovers skillopt-sleep', async () => {
    const { AcpSkillManager } = await import('../../../../src/process/task/AcpSkillManager');
    AcpSkillManager.resetInstance();
    const manager = AcpSkillManager.getInstance();
    await manager.discoverAutoSkills();

    const index = manager.getBuiltinSkillsIndex();
    const found = index.find((skill) => skill.name === 'skillopt-sleep');
    expect(found).toBeDefined();
    expect(found!.description.length).toBeGreaterThan(0);
  });

  it('injects skillopt-sleep into the built skill index text', async () => {
    const { AcpSkillManager, buildSkillsIndexText } = await import('../../../../src/process/task/AcpSkillManager');
    AcpSkillManager.resetInstance();
    const manager = AcpSkillManager.getInstance();
    await manager.discoverAutoSkills();

    const indexText = buildSkillsIndexText(manager.getSkillsIndex());
    expect(indexText).toContain('skillopt-sleep');
  });
});

describe('skillopt-sleep SKILL.md frontmatter', () => {
  it('declares name: skillopt-sleep and a non-empty description', async () => {
    const content = await fs.readFile(SKILL_MD_PATH, 'utf-8');
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).not.toBeNull();

    const frontmatter = frontmatterMatch![1];

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    expect(nameMatch).not.toBeNull();
    expect(nameMatch![1].trim()).toBe('skillopt-sleep');

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    expect(descMatch).not.toBeNull();
    expect(descMatch![1].trim().length).toBeGreaterThan(0);
  });
});
