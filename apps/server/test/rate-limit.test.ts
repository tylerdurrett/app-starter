import { describe, expect, it } from 'vitest';
import { AUTH_RATE_LIMIT_MAX, GLOBAL_RATE_LIMIT_MAX } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

import { createTestServer, parseResponse } from './helpers.js';

const signInPayload = {
  email: 'rate-limit-missing-user@example.com',
  password: 'wrong-password-123',
};

async function createRateLimitServer(trustProxy: false | string[] = false): Promise<FastifyInstance> {
  const app = await createTestServer({
    buildServer: ({ buildServer }) =>
      buildServer({
        dbProbe: { ping: async () => true },
        trustProxy,
      }),
  });
  await app.ready();
  return app;
}

describe('Fastify rate limiting', () => {
  it('does not let rotating forwarded IPs evade the global limit by default', async () => {
    const app = await createRateLimitServer();

    for (let i = 0; i < GLOBAL_RATE_LIMIT_MAX; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-forwarded-for': `203.0.113.${(i % 250) + 1}` },
      });
      expect(res.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-forwarded-for': '198.51.100.99' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('does not let rotating forwarded IPs evade the stricter auth limit by default', async () => {
    const app = await createRateLimitServer();

    for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${i + 1}`,
        },
        payload: signInPayload,
      });

      expect(res.statusCode).toBe(401);
      expect(parseResponse<{ code: string }>(res).body).toMatchObject({
        code: 'INVALID_EMAIL_OR_PASSWORD',
      });
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.99',
      },
      payload: signInPayload,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('separates verified clients behind a trusted proxy for the global limit', async () => {
    const app = await createRateLimitServer(['loopback']);
    const limitedIp = '203.0.113.41';
    const otherIp = '203.0.113.42';

    for (let i = 0; i < GLOBAL_RATE_LIMIT_MAX; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-forwarded-for': limitedIp },
      });
      expect(res.statusCode).toBe(200);
    }

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/health',
          headers: { 'x-forwarded-for': limitedIp },
        })
      ).statusCode,
    ).toBe(429);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/health',
          headers: { 'x-forwarded-for': otherIp },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('separates verified clients behind a trusted proxy for the auth limit', async () => {
    const app = await createRateLimitServer(['loopback']);
    const limitedIp = '203.0.113.51';
    const otherIp = '203.0.113.52';

    for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': limitedIp,
        },
        payload: signInPayload,
      });
      expect(res.statusCode).toBe(401);
    }

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': limitedIp,
          },
          payload: signInPayload,
        })
      ).statusCode,
    ).toBe(429);

    const freshIp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': otherIp,
      },
      payload: signInPayload,
    });
    expect(freshIp.statusCode).toBe(401);
    expect(parseResponse<{ code: string }>(freshIp).body).toMatchObject({
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
  });
});
