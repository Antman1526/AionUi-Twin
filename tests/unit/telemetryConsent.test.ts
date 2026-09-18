import { describe, expect, it } from 'vitest';
import {
  MAIN_PROCESS_SESSION_INTEGRATION,
  isTelemetryAllowed,
  resolveSentryInitOptions,
} from '@/common/utils/telemetryConsent';

describe('isTelemetryAllowed', () => {
  it('denies by default when the user never chose', () => {
    expect(isTelemetryAllowed({})).toBe(false);
    expect(isTelemetryAllowed({ telemetryEnabled: undefined })).toBe(false);
  });

  it('denies when the user opted out', () => {
    expect(isTelemetryAllowed({ telemetryEnabled: false })).toBe(false);
  });

  it('allows only an explicit opt-in', () => {
    expect(isTelemetryAllowed({ telemetryEnabled: true })).toBe(true);
    expect(isTelemetryAllowed({ telemetryEnabled: true, ghostMode: false })).toBe(true);
  });

  it('lets Ghost Mode override an opt-in', () => {
    expect(isTelemetryAllowed({ telemetryEnabled: true, ghostMode: true })).toBe(false);
  });

  it('stays denied under Ghost Mode regardless of the stored value', () => {
    expect(isTelemetryAllowed({ telemetryEnabled: false, ghostMode: true })).toBe(false);
    expect(isTelemetryAllowed({ ghostMode: true })).toBe(false);
  });
});

describe('resolveSentryInitOptions', () => {
  it('starts the client disabled so nothing is sent before consent', () => {
    expect(resolveSentryInitOptions({ dsn: 'https://example.invalid/1' }).enabled).toBe(false);
  });

  it('passes the dsn through untouched', () => {
    expect(resolveSentryInitOptions({ dsn: 'https://example.invalid/1' }).dsn).toBe('https://example.invalid/1');
    expect(resolveSentryInitOptions({}).dsn).toBeUndefined();
  });

  it('drops the main-process session integration so no release-health session starts', () => {
    const { integrations } = resolveSentryInitOptions({});
    const result = integrations([
      { name: 'Breadcrumbs' },
      { name: MAIN_PROCESS_SESSION_INTEGRATION },
      { name: 'Dedupe' },
    ]);
    expect(result.map((i) => i.name)).toEqual(['Breadcrumbs', 'Dedupe']);
  });

  it('leaves other integrations alone and tolerates a non-array', () => {
    const { integrations } = resolveSentryInitOptions({});
    expect(integrations([{ name: 'Breadcrumbs' }]).map((i) => i.name)).toEqual(['Breadcrumbs']);
    expect(integrations(undefined as unknown as { name?: string }[])).toEqual([]);
  });
});
