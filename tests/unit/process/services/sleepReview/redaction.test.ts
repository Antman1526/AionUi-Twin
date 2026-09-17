import { describe, expect, it } from 'vitest';
import { redactTranscript } from '@process/services/sleepReview/redaction';

describe('redactTranscript', () => {
  it('returns empty output for empty input', () => {
    expect(redactTranscript('')).toEqual({ text: '', redactionCount: 0 });
  });

  it('redacts OpenAI-style keys', () => {
    const result = redactTranscript('key is sk-abcdefghijklmnopqrstuvwxyz here');
    expect(result.text).toBe('key is [REDACTED_API_KEY] here');
    expect(result.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts Anthropic keys without leaving the sk-ant prefix', () => {
    const result = redactTranscript('sk-ant-api03-AAAAbbbbCCCCddddEEEEffff');
    expect(result.text).toBe('[REDACTED_API_KEY]');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts AWS access key ids', () => {
    const result = redactTranscript('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).toBe('[REDACTED_AWS_KEY]');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts GitHub tokens for every prefix letter', () => {
    const body = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa gho_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const result = redactTranscript(body);
    expect(result.text).toBe('[REDACTED_GITHUB_TOKEN] [REDACTED_GITHUB_TOKEN]');
    expect(result.redactionCount).toBe(2);
  });

  it('redacts Slack tokens', () => {
    const result = redactTranscript('xoxb-123456789012-abcdefghijkl');
    expect(result.text).toBe('[REDACTED_SLACK_TOKEN]');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts bearer tokens', () => {
    const result = redactTranscript('Authorization: Bearer abcd1234efgh5678');
    expect(result.text).toBe('Authorization: Bearer [REDACTED_TOKEN]');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts JWT-looking values', () => {
    const result = redactTranscript('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123');
    expect(result.text).toBe('token [REDACTED_JWT]');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts email addresses', () => {
    const result = redactTranscript('ping alice@example.com now');
    expect(result.text).toBe('ping [REDACTED_EMAIL] now');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts IPv4 addresses', () => {
    const result = redactTranscript('host 192.168.1.42');
    expect(result.text).toBe('host [REDACTED_IP]');
    expect(result.redactionCount).toBe(1);
  });

  it('collapses macOS home paths', () => {
    const result = redactTranscript('open /Users/antman/Desktop/notes.md');
    expect(result.text).toBe('open ~/Desktop/notes.md');
    expect(result.text).not.toContain('antman');
    expect(result.redactionCount).toBe(1);
  });

  it('collapses Linux home paths', () => {
    const result = redactTranscript('cat /home/deploy/app/config.yml');
    expect(result.text).toBe('cat ~/app/config.yml');
    expect(result.redactionCount).toBe(1);
  });

  it('collapses Windows home paths', () => {
    const result = redactTranscript('type C:\\Users\\Antman\\notes.txt');
    expect(result.text).toBe('type ~/notes.txt');
    expect(result.text).not.toContain('Antman');
    expect(result.redactionCount).toBe(1);
  });

  it('counts every replacement across patterns', () => {
    const result = redactTranscript('sk-abcdefghijklmnopqrstuvwxyz and bob@example.com from 10.0.0.1 in /Users/bob/x');
    expect(result.redactionCount).toBe(4);
    expect(result.text).toBe('[REDACTED_API_KEY] and [REDACTED_EMAIL] from [REDACTED_IP] in ~/x');
  });

  it('leaves ordinary text untouched', () => {
    const result = redactTranscript('The agent failed to resolve the skill index.');
    expect(result.text).toBe('The agent failed to resolve the skill index.');
    expect(result.redactionCount).toBe(0);
  });
});

describe('redactTranscript – extended secret patterns', () => {
  it('redacts Google API keys', () => {
    const key = `AIza${'B'.repeat(35)}`;
    const result = redactTranscript(`maps key ${key} ok`);
    expect(result.text).toBe('maps key [REDACTED_API_KEY] ok');
    expect(result.text).not.toContain(key);
    expect(result.redactionCount).toBe(1);
  });

  it('redacts a whole PEM private key block', () => {
    const body = [
      'before',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAsecretline1',
      'MIIEowIBAAKCAQEAsecretline2',
      '-----END RSA PRIVATE KEY-----',
      'after',
    ].join('\n');
    const result = redactTranscript(body);
    expect(result.text).toBe('before\n[REDACTED_PRIVATE_KEY]\nafter');
    expect(result.text).not.toContain('secretline1');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts an unlabelled PEM private key block', () => {
    const body = ['-----BEGIN PRIVATE KEY-----', 'aGVsbG8gd29ybGQ=', '-----END PRIVATE KEY-----'].join('\n');
    expect(redactTranscript(body).text).toBe('[REDACTED_PRIVATE_KEY]');
  });

  it('redacts underscore-style Stripe keys', () => {
    const result = redactTranscript('sk_live_abcdefgh12345678 sk_test_abcdefgh12345678 rk_live_abcdefgh12345678');
    expect(result.text).toBe('[REDACTED_API_KEY] [REDACTED_API_KEY] [REDACTED_API_KEY]');
    expect(result.redactionCount).toBe(3);
  });

  it('redacts Hugging Face tokens', () => {
    const result = redactTranscript('token hf_aaaaaaaaaaaaaaaaaaaaaaaaaaaa here');
    expect(result.text).toBe('token [REDACTED_API_KEY] here');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts GitLab personal access tokens', () => {
    const result = redactTranscript('glpat-abcdefghijklmnopqrstuv');
    expect(result.text).toBe('[REDACTED_GITLAB_TOKEN]');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts npm tokens', () => {
    const token = `npm_${'a'.repeat(36)}`;
    const result = redactTranscript(`npm auth ${token}`);
    expect(result.text).toBe('npm auth [REDACTED_NPM_TOKEN]');
    expect(result.text).not.toContain(token);
    expect(result.redactionCount).toBe(1);
  });

  it('redacts inline credentials in connection strings but keeps the host', () => {
    const result = redactTranscript('DSN postgres://admin:hunter2@db.internal:5432/app');
    expect(result.text).toBe('DSN postgres://[REDACTED_CREDENTIALS]@db.internal:5432/app');
    expect(result.text).not.toContain('hunter2');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts credentials in mongodb+srv, mysql, redis and amqp URLs', () => {
    const result = redactTranscript(
      [
        'mongodb+srv://u1:p1@cluster.example.net',
        'mysql://u2:p2@localhost',
        'redis://u3:p3@cache',
        'amqp://u4:p4@broker',
      ].join(' ')
    );
    expect(result.text).toBe(
      [
        'mongodb+srv://[REDACTED_CREDENTIALS]@cluster.example.net',
        'mysql://[REDACTED_CREDENTIALS]@localhost',
        'redis://[REDACTED_CREDENTIALS]@cache',
        'amqp://[REDACTED_CREDENTIALS]@broker',
      ].join(' ')
    );
    expect(result.redactionCount).toBe(4);
  });

  it('redacts generic key/value assignments while keeping the key name', () => {
    const result = redactTranscript('api_key = "superSecretValue"');
    expect(result.text).toBe('api_key = [REDACTED_SECRET]');
    expect(result.text).not.toContain('superSecretValue');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts every generic assignment spelling, case-insensitively', () => {
    const result = redactTranscript(
      ['APIKEY=abcdefgh12345678', 'password: hunter2hunter2', "client_secret:'abcdefgh12345678'"].join('\n')
    );
    expect(result.text).toBe(
      ['APIKEY=[REDACTED_SECRET]', 'password: [REDACTED_SECRET]', 'client_secret:[REDACTED_SECRET]'].join('\n')
    );
    expect(result.redactionCount).toBe(3);
  });

  it('does not double-redact a value an earlier rule already replaced', () => {
    const result = redactTranscript('api_key=sk-abcdefghijklmnopqrstuvwxyz');
    expect(result.text).toBe('api_key=[REDACTED_API_KEY]');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts HTTP basic authorization headers', () => {
    const result = redactTranscript('Authorization: Basic dXNlcjpwYXNzd29yZA==');
    expect(result.text).toBe('Authorization: Basic [REDACTED_TOKEN]');
    expect(result.text).not.toContain('dXNlcjpwYXNzd29yZA');
    expect(result.redactionCount).toBe(1);
  });

  it('does not treat dotted version numbers as IP addresses', () => {
    const result = redactTranscript('upgraded to version 1.2.3.4 and v10.20.30.40 today');
    expect(result.text).toBe('upgraded to version 1.2.3.4 and v10.20.30.40 today');
    expect(result.redactionCount).toBe(0);
  });

  it('does not redact ordinary prose', () => {
    const prose = [
      'The reviewer asked for a token of appreciation and a secret handshake.',
      'Release 1.2.3 shipped on time; the password policy doc is in the wiki.',
      'Basic concepts are covered in chapter 4 of the handbook.',
    ].join('\n');
    const result = redactTranscript(prose);
    expect(result.text).toBe(prose);
    expect(result.redactionCount).toBe(0);
  });
});
