/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The real `electron` package cannot be resolved outside an Electron runtime.
// Every test below injects its own `showConsentDialog`, so this mock is only
// here to let the module import succeed.
vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
}));

import { installOfficeCli } from '@process/services/officecli/officeCliInstaller';

const scriptContent = Buffer.from('#!/bin/bash\necho "pretend officecli install"\n');
const scriptSha256 = createHash('sha256').update(scriptContent).digest('hex');

let server: http.Server;
let baseUrl: string;
let requestCount: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
    if (req.url === '/install.sh') {
      res.writeHead(200, { 'Content-Length': String(scriptContent.length) });
      res.end(scriptContent);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}/install.sh`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requestCount = 0;
});

describe('installOfficeCli', () => {
  it('does not touch the network or exec when the user declines consent', async () => {
    const showConsentDialog = vi.fn().mockResolvedValue({ response: 1 });
    const execFile = vi.fn().mockResolvedValue(undefined);

    const result = await installOfficeCli({
      showConsentDialog,
      execFile,
      scriptUrl: baseUrl,
      expectedSha256: scriptSha256,
    });

    expect(result).toEqual({ installed: false, reason: 'declined' });
    expect(showConsentDialog).toHaveBeenCalledTimes(1);
    expect(requestCount).toBe(0);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('downloads, verifies, executes, and removes the temp file when the user accepts with a correct hash', async () => {
    const showConsentDialog = vi.fn().mockResolvedValue({ response: 0 });
    const execFile = vi.fn().mockResolvedValue(undefined);
    const onInstalling = vi.fn();

    const result = await installOfficeCli({
      showConsentDialog,
      execFile,
      scriptUrl: baseUrl,
      expectedSha256: scriptSha256,
      onInstalling,
    });

    expect(result).toEqual({ installed: true });
    expect(requestCount).toBe(1);
    expect(onInstalling).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledTimes(1);

    const [file, args] = execFile.mock.calls[0] as [string, string[]];
    expect(file).toBe('bash');
    expect(args).toHaveLength(1);
    const tmpFile = args[0];
    expect(path.dirname(tmpFile)).toBe(os.tmpdir());

    // The temp file must be removed after execution.
    await expect(fs.access(tmpFile)).rejects.toThrow();
  });

  it('rejects and never execs when the downloaded script does not match the expected hash', async () => {
    const showConsentDialog = vi.fn().mockResolvedValue({ response: 0 });
    const execFile = vi.fn().mockResolvedValue(undefined);

    await expect(
      installOfficeCli({
        showConsentDialog,
        execFile,
        scriptUrl: baseUrl,
        expectedSha256: 'a'.repeat(64),
      })
    ).rejects.toThrow();

    expect(requestCount).toBe(1);
    expect(execFile).not.toHaveBeenCalled();
  });
});
