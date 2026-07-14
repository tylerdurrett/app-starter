import { afterEach, describe, expect, it, vi } from 'vitest';

const TEST_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'BETTER_AUTH_URL',
  'CORS_ORIGIN',
  'MCP_CANONICAL_URL',
  'CREDENTIAL_ENCRYPTION_KEY',
  'AUTH_REQUIRE_EMAIL_VERIFICATION',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'TRUST_PROXY',
] as const;

const VALID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const originalEnv = Object.fromEntries(
  TEST_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof TEST_ENV_KEYS)[number], string | undefined>;

function setEnv(overrides: Partial<Record<(typeof TEST_ENV_KEYS)[number], string>>) {
  for (const key of TEST_ENV_KEYS) {
    process.env[key] = '';
  }
  process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'false';
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key as (typeof TEST_ENV_KEYS)[number]] = value;
  }
}

async function importConfig() {
  vi.resetModules();
  return import('../src/config.js');
}

describe('server config', () => {
  afterEach(() => {
    for (const key of TEST_ENV_KEYS) {
      const original = originalEnv[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    vi.resetModules();
  });

  it('uses PORT when present and falls back to project config otherwise', async () => {
    setEnv({ PORT: '6123' });
    const withPort = await importConfig();
    expect(withPort.config.port).toBe(6123);

    setEnv({ PORT: '' });
    const withoutPort = await importConfig();
    expect(withoutPort.config.port).toBe(5100);
  });

  it('rejects invalid PORT values', async () => {
    setEnv({ PORT: 'not-a-port' });
    await expect(importConfig()).rejects.toThrow('PORT must be an integer between 1 and 65535');

    setEnv({ PORT: '70000' });
    await expect(importConfig()).rejects.toThrow('PORT must be an integer between 1 and 65535');
  });

  it('requires production URLs instead of falling back to localhost', async () => {
    setEnv({ NODE_ENV: 'production' });
    await expect(importConfig()).rejects.toThrow('BETTER_AUTH_URL environment variable is required');
  });

  it.each([
    ['http protocol', { BETTER_AUTH_URL: 'http://api.example.com' }],
    ['localhost host', { BETTER_AUTH_URL: 'https://localhost' }],
    ['loopback host', { BETTER_AUTH_URL: 'https://127.0.0.1' }],
    ['zero host', { BETTER_AUTH_URL: 'https://0.0.0.0' }],
    ['private host', { BETTER_AUTH_URL: 'https://192.168.1.20' }],
  ])('rejects unsafe production URL: %s', async (_name, override) => {
    setEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com',
      CORS_ORIGIN: 'https://app.example.com',
      MCP_CANONICAL_URL: 'https://api.example.com/mcp',
      ...override,
    });

    await expect(importConfig()).rejects.toThrow(/BETTER_AUTH_URL must/);
  });

  it('normalizes valid production HTTPS URLs', async () => {
    setEnv({
      NODE_ENV: 'production',
      PORT: '3456',
      BETTER_AUTH_URL: 'https://api.example.com/',
      CORS_ORIGIN: 'https://app.example.com/',
      MCP_CANONICAL_URL: 'https://api.example.com/mcp/',
    });

    const { config } = await importConfig();

    expect(config).toMatchObject({
      port: 3456,
      apiOrigin: 'https://api.example.com',
      webOrigin: 'https://app.example.com',
      mcpCanonicalUrl: 'https://api.example.com/mcp',
      authRequireEmailVerification: false,
      trustProxy: false,
    });
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['explicit false', 'false'],
    ['trimmed false', ' false '],
  ])('disables proxy trust when TRUST_PROXY is %s', async (_name, value) => {
    setEnv({});
    if (value === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = value;

    const { config } = await importConfig();

    expect(config.trustProxy).toBe(false);
  });

  it.each([
    ['one hop', '1', 1],
    ['trimmed hop count', ' 2 ', 2],
    ['largest safe hop count', String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('accepts TRUST_PROXY as a canonical positive integer: %s', async (_name, value, expected) => {
    setEnv({ TRUST_PROXY: value });

    const { config } = await importConfig();

    expect(config.trustProxy).toBe(expected);
  });

  it.each([
    ['IPv4', '127.0.0.1'],
    ['IPv6', '::1'],
    ['IPv4 CIDR', '10.0.0.0/8'],
    ['IPv6 CIDR', 'fd00::/8'],
    ['supported aliases', 'loopback,linklocal,uniquelocal'],
    ['trimmed mixed list', ' loopback, 10.0.0.0/8, fd00::/8 '],
  ])('accepts a validated TRUST_PROXY address list: %s', async (_name, value) => {
    setEnv({ TRUST_PROXY: value });

    const { config } = await importConfig();

    expect(config.trustProxy).toEqual(
      value
        .trim()
        .split(',')
        .map((entry) => entry.trim()),
    );
  });

  it.each([
    ['boolean true', 'true'],
    ['zero hop count', '0'],
    ['negative hop count', '-1'],
    ['leading-zero hop count', '01'],
    ['unsafe hop count', '9007199254740992'],
    ['decimal hop count', '1.5'],
    ['empty first member', ',loopback'],
    ['empty middle member', 'loopback,,10.0.0.0/8'],
    ['empty last member', 'loopback,'],
    ['false in a list', 'false,loopback'],
    ['unsupported alias', 'private'],
    ['hostname', 'proxy.example.com'],
    ['malformed IPv4', '203.0.113.256'],
    ['malformed IPv4 CIDR', '10.0.0.0/33'],
    ['zero-prefix IPv4 CIDR', '0.0.0.0/0'],
    ['noncanonical CIDR prefix', '10.0.0.0/08'],
    ['malformed IPv6 CIDR', 'fd00::/129'],
    ['zero-prefix IPv6 CIDR', '::/0'],
  ])('rejects invalid TRUST_PROXY input: %s', async (_name, value) => {
    setEnv({ TRUST_PROXY: value });

    await expect(importConfig()).rejects.toThrow(
      'TRUST_PROXY must be "false", a canonical positive integer, or a comma-separated list',
    );
  });

  it('defaults email verification on in production and requires email config', async () => {
    setEnv({
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com',
      CORS_ORIGIN: 'https://app.example.com',
      MCP_CANONICAL_URL: 'https://api.example.com/mcp',
      AUTH_REQUIRE_EMAIL_VERIFICATION: '',
    });

    await expect(importConfig()).rejects.toThrow(
      'RESEND_API_KEY environment variable is required when email verification is enabled in production',
    );
  });
});
