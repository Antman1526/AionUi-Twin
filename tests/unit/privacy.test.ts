/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IProvider } from '../../src/common/config/storage';
import {
  createTelemetryGate,
  isLocalProvider,
  isLoopbackOrLanHost,
  isTelemetryAllowed,
  resolveSentryInitOptions,
  shouldLookupPublicIp,
  type SentryIntegrationLike,
} from '../../src/common/utils/privacy';

function makeProvider(overrides: Partial<IProvider> & { id: string }): IProvider {
  return {
    id: overrides.id,
    platform: 'custom',
    name: overrides.id,
    baseUrl: '',
    apiKey: '',
    model: ['test-model'],
    ...overrides,
  };
}

describe('isLoopbackOrLanHost', () => {
  it('recognizes loopback hosts', () => {
    expect(isLoopbackOrLanHost('http://localhost:11434/v1')).toBe(true);
    expect(isLoopbackOrLanHost('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLoopbackOrLanHost('http://[::1]:8080')).toBe(true);
  });

  it('recognizes private LAN ranges', () => {
    expect(isLoopbackOrLanHost('http://10.0.0.5:8080')).toBe(true);
    expect(isLoopbackOrLanHost('http://172.16.0.1:8080')).toBe(true);
    expect(isLoopbackOrLanHost('http://172.31.255.255:8080')).toBe(true);
    expect(isLoopbackOrLanHost('http://192.168.1.20:8080')).toBe(true);
  });

  it('recognizes mDNS .local hosts', () => {
    expect(isLoopbackOrLanHost('http://my-server.local:8080')).toBe(true);
  });

  it('rejects public hosts and ranges outside the private blocks', () => {
    expect(isLoopbackOrLanHost('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackOrLanHost('http://172.32.0.1:8080')).toBe(false); // just outside 172.16/12
    expect(isLoopbackOrLanHost('http://8.8.8.8')).toBe(false);
  });

  it('returns false for missing or invalid URLs', () => {
    expect(isLoopbackOrLanHost(undefined)).toBe(false);
    expect(isLoopbackOrLanHost('')).toBe(false);
    expect(isLoopbackOrLanHost('not a url')).toBe(false);
  });
});

describe('isLocalProvider', () => {
  it('treats the managed local llama.cpp provider as local regardless of baseUrl', () => {
    expect(isLocalProvider(makeProvider({ id: 'local-llama-cpp-abc123', baseUrl: '' }))).toBe(true);
  });

  it('treats providers with a loopback/LAN baseUrl as local', () => {
    expect(isLocalProvider(makeProvider({ id: 'ollama-1', baseUrl: 'http://localhost:11434/v1' }))).toBe(true);
    expect(isLocalProvider(makeProvider({ id: 'lmstudio-1', baseUrl: 'http://192.168.1.5:1234/v1' }))).toBe(true);
  });

  it('treats providers explicitly flagged as ollama/lmstudio as local', () => {
    expect(isLocalProvider(makeProvider({ id: 'p1', platform: 'ollama', baseUrl: '' }))).toBe(true);
    expect(isLocalProvider(makeProvider({ id: 'p2', platform: 'lmstudio', baseUrl: '' }))).toBe(true);
  });

  it('treats cloud providers as non-local', () => {
    expect(isLocalProvider(makeProvider({ id: 'openai-1', baseUrl: 'https://api.openai.com/v1' }))).toBe(false);
    expect(isLocalProvider(makeProvider({ id: 'gauth-1', platform: 'gemini-with-google-auth', baseUrl: '' }))).toBe(
      false
    );
  });

  it('returns false for a mixed provider list filter, keeping only local entries', () => {
    const providers = [
      makeProvider({ id: 'local-llama-cpp-1', baseUrl: '' }),
      makeProvider({ id: 'ollama-1', baseUrl: 'http://localhost:11434/v1' }),
      makeProvider({ id: 'openai-1', baseUrl: 'https://api.openai.com/v1' }),
      makeProvider({ id: 'anthropic-1', platform: 'anthropic', baseUrl: 'https://api.anthropic.com' }),
    ];
    expect(providers.filter(isLocalProvider).map((p) => p.id)).toEqual(['local-llama-cpp-1', 'ollama-1']);
  });

  it('handles null/undefined input safely', () => {
    expect(isLocalProvider(undefined)).toBe(false);
    expect(isLocalProvider(null)).toBe(false);
  });
});

describe('isTelemetryAllowed', () => {
  it('is a truth table over telemetry.enabled and privacy.privateMode', () => {
    expect(isTelemetryAllowed({ 'telemetry.enabled': true, 'privacy.privateMode': false })).toBe(true);
    expect(isTelemetryAllowed({ 'telemetry.enabled': true, 'privacy.privateMode': true })).toBe(false);
    expect(isTelemetryAllowed({ 'telemetry.enabled': false, 'privacy.privateMode': false })).toBe(false);
    expect(isTelemetryAllowed({ 'telemetry.enabled': false, 'privacy.privateMode': true })).toBe(false);
    expect(isTelemetryAllowed({})).toBe(false);
  });
});

describe('createTelemetryGate', () => {
  it('drops the event when telemetry is disabled', () => {
    const gate = createTelemetryGate(() => false);
    expect(gate({ message: 'error' })).toBeNull();
  });

  it('passes the event through when telemetry is enabled', () => {
    const event = { message: 'error' };
    const gate = createTelemetryGate(() => true);
    expect(gate(event)).toBe(event);
  });

  it('reads the flag lazily on every call rather than capturing it once', () => {
    let enabled = false;
    const gate = createTelemetryGate(() => enabled);
    expect(gate({ a: 1 })).toBeNull();
    enabled = true;
    expect(gate({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('resolveSentryInitOptions', () => {
  it('starts the client disabled so no event or session envelope can leave before the telemetry gate resolves', () => {
    const options = resolveSentryInitOptions({ dsn: 'https://example.test/1' });
    expect(options.enabled).toBe(false);
    expect(options.dsn).toBe('https://example.test/1');
  });

  it('passes dsn through as-is, including undefined', () => {
    expect(resolveSentryInitOptions({}).dsn).toBeUndefined();
  });

  it('drops the MainProcessSession integration (the @sentry/electron replacement for the removed autoSessionTracking option), leaving others untouched', () => {
    const options = resolveSentryInitOptions({ dsn: undefined });
    const defaults: SentryIntegrationLike[] = [
      { name: 'ElectronMinidump' },
      { name: 'MainProcessSession' },
      { name: 'ChildProcess' },
    ];
    expect(options.integrations(defaults).map((i) => i.name)).toEqual(['ElectronMinidump', 'ChildProcess']);
  });

  it('is a no-op filter when MainProcessSession is not present', () => {
    const options = resolveSentryInitOptions({});
    const defaults: SentryIntegrationLike[] = [{ name: 'ElectronMinidump' }];
    expect(options.integrations(defaults)).toEqual(defaults);
  });
});

describe('shouldLookupPublicIp', () => {
  it('never looks up the public IP in Private Mode', () => {
    expect(shouldLookupPublicIp({ privateMode: true, remoteAccessEnabled: true })).toBe(false);
  });

  it('skips the lookup when remote access is not enabled', () => {
    expect(shouldLookupPublicIp({ privateMode: false, remoteAccessEnabled: false })).toBe(false);
    expect(shouldLookupPublicIp({ privateMode: false })).toBe(false);
  });

  it('looks up the public IP only when remote access is enabled and Private Mode is off', () => {
    expect(shouldLookupPublicIp({ privateMode: false, remoteAccessEnabled: true })).toBe(true);
  });
});
