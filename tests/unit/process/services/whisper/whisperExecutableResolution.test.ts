import { describe, expect, it } from 'vitest';
import { resolveWhisperServerExecutable } from '@process/services/whisper/whisperExecutableResolution';

/** Build an `exists` predicate that only accepts the listed absolute paths. */
function existsIn(paths: string[]): (candidate: string) => boolean {
  const set = new Set(paths);
  return (candidate) => set.has(candidate);
}

describe('resolveWhisperServerExecutable', () => {
  it('prefers the user-configured path over everything else', () => {
    const resolved = resolveWhisperServerExecutable({
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      homeDir: '/Users/dev',
      configuredPath: '/custom/build/whisper-server',
      exists: existsIn(['/custom/build/whisper-server', '/usr/bin/whisper-server', '/opt/homebrew/bin/whisper-server']),
    });
    expect(resolved).toBe('/custom/build/whisper-server');
  });

  it('ignores a configured path that no longer exists and falls through to PATH', () => {
    const resolved = resolveWhisperServerExecutable({
      platform: 'darwin',
      env: { PATH: '/usr/bin:/opt/homebrew/bin' },
      homeDir: '/Users/dev',
      configuredPath: '/deleted/whisper-server',
      exists: existsIn(['/opt/homebrew/bin/whisper-server']),
    });
    expect(resolved).toBe('/opt/homebrew/bin/whisper-server');
  });

  it('walks PATH entries in order', () => {
    const resolved = resolveWhisperServerExecutable({
      platform: 'darwin',
      env: { PATH: '/empty:/first:/second' },
      homeDir: '/Users/dev',
      exists: existsIn(['/first/whisper-server', '/second/whisper-server']),
    });
    expect(resolved).toBe('/first/whisper-server');
  });

  it('falls back to Homebrew and ~/.local/bin on macOS when PATH has no hit', () => {
    expect(
      resolveWhisperServerExecutable({
        platform: 'darwin',
        env: { PATH: '/usr/bin' },
        homeDir: '/Users/dev',
        exists: existsIn(['/opt/homebrew/bin/whisper-server']),
      })
    ).toBe('/opt/homebrew/bin/whisper-server');

    expect(
      resolveWhisperServerExecutable({
        platform: 'darwin',
        env: { PATH: '' },
        homeDir: '/Users/dev',
        exists: existsIn(['/Users/dev/.local/bin/whisper-server']),
      })
    ).toBe('/Users/dev/.local/bin/whisper-server');
  });

  it('checks /usr/local/bin, /usr/bin, ~/.local/bin and /snap/bin on Linux', () => {
    for (const hit of ['/usr/local/bin', '/usr/bin', '/home/dev/.local/bin', '/snap/bin']) {
      expect(
        resolveWhisperServerExecutable({
          platform: 'linux',
          env: { PATH: '' },
          homeDir: '/home/dev',
          exists: existsIn([`${hit}/whisper-server`]),
        })
      ).toBe(`${hit}/whisper-server`);
    }
  });

  it('looks for whisper-server.exe and splits PATH on ";" on Windows', () => {
    const resolved = resolveWhisperServerExecutable({
      platform: 'win32',
      env: { PATH: 'C:\\Windows;C:\\tools' },
      homeDir: 'C:\\Users\\dev',
      exists: existsIn(['C:\\tools\\whisper-server.exe']),
    });
    expect(resolved).toBe('C:\\tools\\whisper-server.exe');
  });

  it('returns null when nothing matches, so callers can show install guidance', () => {
    expect(
      resolveWhisperServerExecutable({
        platform: 'linux',
        env: { PATH: '/usr/bin:/bin' },
        homeDir: '/home/dev',
        exists: () => false,
      })
    ).toBeNull();
  });
});
