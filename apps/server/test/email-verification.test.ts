import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const sendEmailMock = vi.fn(async () => {});
vi.mock('../src/email/send.js', () => ({ sendEmail: sendEmailMock }));

const ENV_KEYS = [
  'NODE_ENV',
  'AUTH_REQUIRE_EMAIL_VERIFICATION',
  'BETTER_AUTH_URL',
  'CORS_ORIGIN',
  'MCP_CANONICAL_URL',
  'BETTER_AUTH_SECRET',
  'CREDENTIAL_ENCRYPTION_KEY',
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

async function buildApp(authRequireEmailVerification: 'true' | 'false') {
  process.env.NODE_ENV = 'test';
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = authRequireEmailVerification;
  process.env.BETTER_AUTH_URL = 'http://localhost:5100';
  process.env.CORS_ORIGIN = 'http://localhost:5200';
  process.env.MCP_CANONICAL_URL = 'http://localhost:5100/mcp';
  process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef';
  process.env.CREDENTIAL_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  vi.resetModules();
  const { buildServer } = await import('../src/index.js');
  const app = buildServer();
  await app.ready();
  return app;
}

describe('email verification configuration', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    sendEmailMock.mockClear();
    await app?.close();
    app = undefined;
    for (const key of ENV_KEYS) {
      const original = originalEnv[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    vi.resetModules();
  });

  it('keeps sign-up immediate when verification is disabled', async () => {
    app = await buildApp('false');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: `verification-disabled-${Date.now()}@example.com`,
        password: 'password123',
        name: 'Verification Disabled',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeDefined();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('sends a verification email without logging the token when verification is enabled', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    app = await buildApp('true');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: `verification-enabled-${Date.now()}@example.com`,
        password: 'password123',
        name: 'Verification Enabled',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const sent = sendEmailMock.mock.calls.at(-1)?.[0] as
      | { to: string; subject: string; html: string; text: string }
      | undefined;
    expect(sent).toBeDefined();
    expect(sent?.subject).toBe('Verify your email');
    expect(sent?.html).toContain('Verify email');
    expect(sent?.text).toContain('Welcome to App Starter');
    expect(consoleLog).not.toHaveBeenCalled();

    consoleLog.mockRestore();
  });
});
