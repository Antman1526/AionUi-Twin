#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error('Usage: node scripts/clean-output.mjs <path> [path...]');
  process.exit(1);
}

for (const target of targets) {
  const resolved = path.resolve(process.cwd(), target);
  const cwd = process.cwd();

  if (resolved === cwd || !resolved.startsWith(cwd + path.sep)) {
    console.error(`Refusing to clean path outside project: ${target}`);
    process.exit(1);
  }

  fs.rmSync(resolved, { recursive: true, force: true });
}
