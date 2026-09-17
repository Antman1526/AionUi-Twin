/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';

/**
 * Integration test for the sandbox worker's runtime permission enforcement.
 *
 * `SandboxHost` loads `sandboxWorker.js` from its own output directory, which
 * only exists after an app build. Here the worker is compiled on the fly with
 * esbuild and driven directly, so the real `Module.prototype.require` hook and
 * the real global replacements are exercised.
 */

const WORKER_SOURCE = fileURLToPath(
  new URL('../../../../src/process/extensions/sandbox/sandboxWorker.ts', import.meta.url)
);

let tmpRoot: string;
let workerScript: string;

type WorkerRun = {
  logs: { level: string; args: string[] }[];
  ready: boolean;
  exitCode: number;
  error?: Error;
};

function writeExtension(name: string, entrySource: string): string {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.js'), entrySource, 'utf-8');
  fs.writeFileSync(path.join(dir, 'inside.txt'), 'inside', 'utf-8');
  return dir;
}

function runWorker(extensionDir: string, permissions: Record<string, unknown>): Promise<WorkerRun> {
  return new Promise<WorkerRun>((resolve, reject) => {
    const result: WorkerRun = { logs: [], ready: false, exitCode: -1 };

    const worker = new Worker(workerScript, {
      workerData: {
        extensionName: path.basename(extensionDir),
        extensionDir,
        entryPoint: 'main.js',
        permissions,
      },
      execArgv: [],
    });

    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('worker did not finish in time'));
    }, 15000);

    worker.on('message', (msg: { type: string; level?: string; args?: unknown[] }) => {
      if (msg.type === 'log') {
        result.logs.push({ level: msg.level ?? 'log', args: (msg.args ?? []).map(String) });
      } else if (msg.type === 'ready') {
        result.ready = true;
        // Nothing else to do once the extension loaded — shut the worker down.
        worker.postMessage({ type: 'shutdown' });
      }
    });

    worker.on('error', (err) => {
      result.error = err;
    });

    worker.on('exit', (code) => {
      clearTimeout(timer);
      result.exitCode = code;
      resolve(result);
    });
  });
}

function joinedLogs(run: WorkerRun): string {
  return run.logs.map((l) => `${l.level}: ${l.args.join(' ')}`).join('\n');
}

describe('extensions/sandbox sandboxWorker — runtime permission enforcement', () => {
  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-sandbox-worker-'));
    workerScript = path.join(tmpRoot, 'sandboxWorker.js');
    await build({
      entryPoints: [WORKER_SOURCE],
      outfile: workerScript,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
      logLevel: 'silent',
    });
  }, 60000);

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('denies require("child_process") when shell is not declared', async () => {
    const dir = writeExtension('no-shell', `require('child_process');\nmodule.exports = {};\n`);
    const run = await runWorker(dir, { shell: false });

    expect(run.ready).toBe(false);
    expect(run.exitCode).toBe(1);
    const logs = joinedLogs(run);
    expect(logs).toContain('Permission denied');
    expect(logs).toContain('child_process');
  }, 30000);

  it('denies require("node:child_process") too', async () => {
    const dir = writeExtension('no-shell-prefixed', `require('node:child_process');\nmodule.exports = {};\n`);
    const run = await runWorker(dir, {});

    expect(run.ready).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(joinedLogs(run)).toContain('child_process');
  }, 30000);

  it('allows require("child_process") when shell is declared', async () => {
    const dir = writeExtension(
      'with-shell',
      `const cp = require('child_process');\nif (typeof cp.execSync !== 'function') throw new Error('bad module');\nmodule.exports = {};\n`
    );
    const run = await runWorker(dir, { shell: true });

    expect(joinedLogs(run)).not.toContain('Permission denied');
    expect(run.ready).toBe(true);
  }, 30000);

  it('always denies require("worker_threads")', async () => {
    const dir = writeExtension('no-threads', `require('worker_threads');\nmodule.exports = {};\n`);
    const run = await runWorker(dir, { shell: true, network: true, filesystem: 'full' });

    expect(run.ready).toBe(false);
    expect(joinedLogs(run)).toContain('never available');
  }, 30000);

  it('denies require("https") without a network permission', async () => {
    const dir = writeExtension('no-net', `require('https');\nmodule.exports = {};\n`);
    const run = await runWorker(dir, {});

    expect(run.ready).toBe(false);
    expect(joinedLogs(run)).toContain('"network"');
  }, 30000);

  it('denies fetch() without a network permission', async () => {
    const dir = writeExtension('no-fetch', `fetch('http://127.0.0.1:1/');\nmodule.exports = {};\n`);
    const run = await runWorker(dir, {});

    expect(run.ready).toBe(false);
    expect(joinedLogs(run)).toContain('fetch()');
  }, 30000);

  it('restricts fs to the extension directory when filesystem is extension-only', async () => {
    const dir = writeExtension(
      'fs-scoped',
      `const nodeFs = require('fs');\n` +
        `if (nodeFs.readFileSync(require('path').join(__dirname, 'inside.txt'), 'utf-8') !== 'inside') {\n` +
        `  throw new Error('expected to read own file');\n` +
        `}\n` +
        `nodeFs.readFileSync('/etc/hosts', 'utf-8');\n` +
        `module.exports = {};\n`
    );
    const run = await runWorker(dir, { filesystem: 'extension-only' });

    expect(run.ready).toBe(false);
    const logs = joinedLogs(run);
    expect(logs).toContain('outside the extension directory');
    expect(logs).toContain('/etc/hosts');
  }, 30000);

  it('allows unrestricted fs access when filesystem is full', async () => {
    const dir = writeExtension(
      'fs-full',
      `const nodeFs = require('fs');\nnodeFs.statSync('/etc/hosts');\nmodule.exports = {};\n`
    );
    const run = await runWorker(dir, { filesystem: 'full' });

    expect(joinedLogs(run)).not.toContain('Permission denied');
    expect(run.ready).toBe(true);
  }, 30000);

  it('denies require("module")', async () => {
    const dir = writeExtension('no-module', `require('module');\nmodule.exports = {};\n`);
    const run = await runWorker(dir, { shell: true, network: true, filesystem: 'full' });

    expect(run.ready).toBe(false);
    expect(joinedLogs(run)).toContain('never available');
  }, 30000);

  it('denies reaching the raw loader through module.constructor._load', async () => {
    const dir = writeExtension('no-module-load', `module.constructor._load('child_process');\nmodule.exports = {};\n`);
    const run = await runWorker(dir, {});

    expect(run.ready).toBe(false);
    const logs = joinedLogs(run);
    expect(logs).toContain('Permission denied');
    expect(logs).toContain('child_process');
  }, 30000);

  it.each(['binding', '_linkedBinding', 'dlopen'])(
    'denies process.%s()',
    async (api) => {
      const dir = writeExtension(`no-${api}`, `process.${api}('fs');\nmodule.exports = {};\n`);
      const run = await runWorker(dir, { shell: true, network: true, filesystem: 'full' });

      expect(run.ready).toBe(false);
      expect(joinedLogs(run)).toContain(`process.${api}()`);
    },
    30000
  );

  it('denies fs.copyFileSync escaping the extension directory', async () => {
    const dir = writeExtension(
      'fs-copy-escape',
      `const nodeFs = require('fs');\n` +
        `nodeFs.copyFileSync('/etc/hosts', require('path').join(__dirname, 'stolen.txt'));\n` +
        `module.exports = {};\n`
    );
    const run = await runWorker(dir, { filesystem: 'extension-only' });

    expect(run.ready).toBe(false);
    expect(joinedLogs(run)).toContain('outside the extension directory');
    expect(fs.existsSync(path.join(dir, 'stolen.txt'))).toBe(false);
  }, 30000);

  it('denies fs.appendFileSync outside the extension directory', async () => {
    const dir = writeExtension(
      'fs-append-escape',
      `const nodeFs = require('fs');\n` +
        `nodeFs.appendFileSync('/tmp/aionui-sandbox-should-not-exist.txt', 'x');\n` +
        `module.exports = {};\n`
    );
    const run = await runWorker(dir, { filesystem: 'extension-only' });

    expect(run.ready).toBe(false);
    expect(joinedLogs(run)).toContain('outside the extension directory');
    expect(fs.existsSync('/tmp/aionui-sandbox-should-not-exist.txt')).toBe(false);
  }, 30000);

  it('still allows copy/append/rename inside the extension directory', async () => {
    const dir = writeExtension(
      'fs-inside-ops',
      `const nodeFs = require('fs');\n` +
        `const p = require('path');\n` +
        `nodeFs.copyFileSync(p.join(__dirname, 'inside.txt'), p.join(__dirname, 'copy.txt'));\n` +
        `nodeFs.appendFileSync(p.join(__dirname, 'copy.txt'), '-more');\n` +
        `nodeFs.renameSync(p.join(__dirname, 'copy.txt'), p.join(__dirname, 'renamed.txt'));\n` +
        `module.exports = {};\n`
    );
    const run = await runWorker(dir, { filesystem: 'extension-only' });

    expect(joinedLogs(run)).not.toContain('Permission denied');
    expect(run.ready).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'renamed.txt'), 'utf-8')).toBe('inside-more');
  }, 30000);

  it('loads an extension that only needs unrestricted builtins', async () => {
    const dir = writeExtension(
      'plain',
      `const p = require('path');\nmodule.exports = { join: (a, b) => p.join(a, b) };\n`
    );
    const run = await runWorker(dir, {});

    expect(run.ready).toBe(true);
    expect(joinedLogs(run)).not.toContain('Permission denied');
  }, 30000);
});
