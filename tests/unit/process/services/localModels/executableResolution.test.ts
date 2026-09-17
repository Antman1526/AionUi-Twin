import { describe, expect, it } from 'vitest';
import { resolveLlamaServerExecutable } from '@process/services/localModels/executableResolution';

/** Build an `exists` predicate that only accepts the listed absolute paths. */
function existsIn(paths: string[]): (candidate: string) => boolean {
  const set = new Set(paths);
  return (candidate) => set.has(candidate);
}

describe('resolveLlamaServerExecutable', () => {
  it('prefers the user-configured path over everything else', () => {
    const resolved = resolveLlamaServerExecutable({
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      homeDir: '/Users/dev',
      configuredPath: '/custom/build/llama-server',
      exists: existsIn(['/custom/build/llama-server', '/usr/bin/llama-server', '/opt/homebrew/bin/llama-server']),
    });
    expect(resolved).toBe('/custom/build/llama-server');
  });

  it('ignores a configured path that no longer exists and falls through to PATH', () => {
    const resolved = resolveLlamaServerExecutable({
      platform: 'darwin',
      env: { PATH: '/usr/bin:/opt/homebrew/bin' },
      homeDir: '/Users/dev',
      configuredPath: '/deleted/llama-server',
      exists: existsIn(['/opt/homebrew/bin/llama-server']),
    });
    expect(resolved).toBe('/opt/homebrew/bin/llama-server');
  });

  it('walks PATH entries in order on macOS', () => {
    const resolved = resolveLlamaServerExecutable({
      platform: 'darwin',
      env: { PATH: '/empty:/first:/second' },
      homeDir: '/Users/dev',
      exists: existsIn(['/first/llama-server', '/second/llama-server']),
    });
    expect(resolved).toBe('/first/llama-server');
  });

  it('falls back to Homebrew and ~/.local/bin on macOS when PATH has no hit', () => {
    expect(
      resolveLlamaServerExecutable({
        platform: 'darwin',
        env: { PATH: '/usr/bin' },
        homeDir: '/Users/dev',
        exists: existsIn(['/opt/homebrew/bin/llama-server']),
      })
    ).toBe('/opt/homebrew/bin/llama-server');

    expect(
      resolveLlamaServerExecutable({
        platform: 'darwin',
        env: { PATH: '' },
        homeDir: '/Users/dev',
        exists: existsIn(['/Users/dev/.local/bin/llama-server']),
      })
    ).toBe('/Users/dev/.local/bin/llama-server');
  });

  it('checks /usr/local/bin, /usr/bin, ~/.local/bin and /snap/bin on Linux', () => {
    for (const hit of ['/usr/local/bin', '/usr/bin', '/home/dev/.local/bin', '/snap/bin']) {
      expect(
        resolveLlamaServerExecutable({
          platform: 'linux',
          env: { PATH: '' },
          homeDir: '/home/dev',
          exists: existsIn([`${hit}/llama-server`]),
        })
      ).toBe(`${hit}/llama-server`);
    }
  });

  it('looks for llama-server.exe and splits PATH on ";" on Windows', () => {
    const resolved = resolveLlamaServerExecutable({
      platform: 'win32',
      env: { PATH: 'C:\\Windows;C:\\tools' },
      homeDir: 'C:\\Users\\dev',
      exists: existsIn(['C:\\tools\\llama-server.exe']),
    });
    expect(resolved).toBe('C:\\tools\\llama-server.exe');
  });

  it('checks the WinGet, Scoop and Program Files locations on Windows', () => {
    const env = { PATH: '', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local', USERPROFILE: 'C:\\Users\\dev' };
    const candidates = [
      'C:\\Users\\dev\\AppData\\Local\\llama.cpp',
      'C:\\Users\\dev\\AppData\\Local\\Microsoft\\WinGet\\Links',
      'C:\\Users\\dev\\scoop\\shims',
      'C:\\Program Files\\llama.cpp',
    ];
    for (const dir of candidates) {
      expect(
        resolveLlamaServerExecutable({
          platform: 'win32',
          env,
          homeDir: 'C:\\Users\\dev',
          exists: existsIn([`${dir}\\llama-server.exe`]),
        })
      ).toBe(`${dir}\\llama-server.exe`);
    }
  });

  it('returns null when nothing matches, so callers can show install guidance', () => {
    expect(
      resolveLlamaServerExecutable({
        platform: 'linux',
        env: { PATH: '/usr/bin:/bin' },
        homeDir: '/home/dev',
        exists: () => false,
      })
    ).toBeNull();
  });
});
