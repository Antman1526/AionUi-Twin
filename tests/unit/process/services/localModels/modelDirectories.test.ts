import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_MODEL_DIRECTORIES,
  normalizeModelDirectories,
  resolveModelDirectories,
} from '../../../../../src/common/utils/localModelProviders';

describe('normalizeModelDirectories', () => {
  it('trims, drops empty entries, and de-duplicates while preserving order', () => {
    expect(normalizeModelDirectories(['  /a  ', '/b', '/a', '', '   ', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
  });

  it('returns an empty array for non-array / undefined input', () => {
    expect(normalizeModelDirectories(undefined)).toEqual([]);
    // @ts-expect-error testing invalid runtime input
    expect(normalizeModelDirectories('nope')).toEqual([]);
  });
});

describe('resolveModelDirectories', () => {
  it('falls back to the built-in defaults when no valid directories are configured', () => {
    expect(resolveModelDirectories(undefined)).toEqual([...DEFAULT_LOCAL_MODEL_DIRECTORIES]);
    expect(resolveModelDirectories(['', '   '])).toEqual([...DEFAULT_LOCAL_MODEL_DIRECTORIES]);
  });

  it('uses the configured directories when at least one is valid', () => {
    expect(resolveModelDirectories(['/custom/models', ' /custom/models '])).toEqual(['/custom/models']);
  });
});
