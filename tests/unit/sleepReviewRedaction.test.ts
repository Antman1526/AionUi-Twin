/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { redactSecrets, redactTranscript } from '@process/services/sleepReview/redaction';

/** Shorthand: the redacted text of `input`. */
const redact = (input: string): string => redactSecrets(input).text;

describe('redactSecrets — provider credentials', () => {
  it('redacts an OpenAI key', () => {
    const result = redactSecrets('key is sk-abcdefghijklmnopqrstuvwxyz0123 here');
    expect(result.text).toBe('key is [redacted:openai-key] here');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts an OpenAI project key', () => {
    expect(redact('sk-proj-AbCdEfGhIjKlMnOpQrStUvWx')).toBe('[redacted:openai-key]');
  });

  it('redacts an Anthropic key without falling through to the generic sk- rule', () => {
    expect(redact('sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe('[redacted:anthropic-key]');
  });

  it('redacts a Google API key', () => {
    expect(redact('AIzaSyA1234567890abcdefghijklmnopqrstuv')).toBe('[redacted:google-key]');
  });

  it('redacts an AWS access key id', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('[redacted:aws-key]');
  });

  it('redacts every GitHub token prefix', () => {
    for (const prefix of ['ghp', 'gho', 'ghu', 'ghs', 'ghr']) {
      expect(redact(`${prefix}_0123456789abcdefghijklmnopqrstuvwxyz`)).toBe('[redacted:github-token]');
    }
  });

  it('redacts a Slack token', () => {
    expect(redact('xoxb-123456789012-abcdefghijkl')).toBe('[redacted:slack-token]');
  });

  it('redacts a GitLab personal access token', () => {
    expect(redact('glpat-AbCdEfGhIjKlMnOpQrSt')).toBe('[redacted:gitlab-token]');
  });

  it('redacts a Hugging Face token', () => {
    expect(redact('hf_AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe('[redacted:huggingface-token]');
  });

  it('redacts an npm token', () => {
    expect(redact('npm_AbCdEfGhIjKlMnOpQrStUvWxYz01')).toBe('[redacted:npm-token]');
  });

  it('redacts live Stripe secret and restricted keys', () => {
    expect(redact('sk_live_abcdefgh12345678')).toBe('[redacted:stripe-key]');
    expect(redact('rk_live_abcdefgh12345678')).toBe('[redacted:stripe-key]');
  });
});

describe('redactSecrets — headers and structured secrets', () => {
  it('keeps the Bearer header name and drops the token', () => {
    expect(redact('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toBe(
      'Authorization: Bearer [redacted:bearer-token]'
    );
  });

  it('keeps the Basic header name and drops the base64 blob', () => {
    expect(redact('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe('Authorization: Basic [redacted:basic-auth]');
  });

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(redact(`token=${jwt}`)).toContain('[redacted:jwt]');
    expect(redact(`token=${jwt}`)).not.toContain('eyJhbGci');
  });

  it('redacts a multi-line PEM private key block', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA1234',
      'abcd/efgh+ijkl=',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const result = redactSecrets(`before\n${pem}\nafter`);
    expect(result.text).toBe('before\n[redacted:private-key]\nafter');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts only the credential part of a connection string', () => {
    expect(redact('postgres://appuser:s3cr3tpw@db.internal:5432/main')).toBe(
      'postgres://appuser:[redacted:credential]@db.internal:5432/main'
    );
  });

  it('keeps the key name of a generic assignment and drops the value', () => {
    expect(redact('api_key=ZZZZtopsecretZZZZ')).toBe('api_key=[redacted:secret]');
    expect(redact('password: hunter2000')).toBe('password: [redacted:secret]');
    expect(redact('secret="swordfish123"')).toBe('secret="[redacted:secret]"');
  });

  it('does not count a vendor key twice when it sits in an assignment', () => {
    const result = redactSecrets('api_key=sk-abcdefghijklmnopqrstuvwxyz0123');
    expect(result.text).toBe('api_key=[redacted:openai-key]');
    expect(result.redactionCount).toBe(1);
  });
});

describe('redactSecrets — personal data', () => {
  it('redacts e-mail addresses', () => {
    expect(redact('ping ada@example.co.uk about it')).toBe('ping [redacted:email] about it');
  });

  it('redacts IPv4 addresses', () => {
    expect(redact('host 192.168.1.20 refused')).toBe('host [redacted:ip] refused');
  });

  it('does not redact dotted version numbers', () => {
    expect(redact('upgrade to v1.2.3.4 today')).toBe('upgrade to v1.2.3.4 today');
    expect(redactSecrets('release 10.20.30.40.50 is odd').redactionCount).toBe(0);
  });

  it('collapses home directories to ~', () => {
    expect(redact('see /Users/ada/Desktop/notes.md')).toBe('see ~/Desktop/notes.md');
    expect(redact('see /home/ada/src/app.ts')).toBe('see ~/src/app.ts');
    expect(redact('see C:\\Users\\ada\\src')).toBe('see ~\\src');
  });
});

describe('redactSecrets — leaves ordinary prose alone', () => {
  it('does not redact ordinary prose', () => {
    const prose =
      'The agent kept re-reading the same file, so the skill should say to cache the result. ' +
      'Version 2 of the workflow ran in 1.5 seconds and the user asked for a summary at the end.';
    const result = redactSecrets(prose);
    expect(result.text).toBe(prose);
    expect(result.redactionCount).toBe(0);
  });

  it('does not treat the word "token" in prose as a bearer token', () => {
    expect(redactSecrets('ask for a Bearer token next time').redactionCount).toBe(0);
  });
});

describe('redactTranscript', () => {
  it('joins roles and redacts across messages', () => {
    const result = redactTranscript([
      { role: 'user', text: 'use sk-abcdefghijklmnopqrstuvwxyz0123' },
      { role: 'assistant', text: '   ' },
      { role: 'assistant', text: 'done' },
    ]);
    expect(result.text).toBe('user: use [redacted:openai-key]\n\nassistant: done');
    expect(result.redactionCount).toBe(1);
  });
});
