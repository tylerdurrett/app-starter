import { describe, expect, it } from 'vitest';
import { AUTH_RATE_LIMIT_MAX, GLOBAL_RATE_LIMIT_MAX } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

import { createTestServer, parseResponse } from './helpers.js';

describe('Fastify rate limiting', () => {
  it('applies the global per-IP limit using trusted forwarded headers', async () => {
    const app: FastifyInstance = await createTestServer({
      buildServer: ({ buildServer }) => buildServer({ dbProbe: { ping: async () => true } }),
    });
    await app.ready();

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

    const limited = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-forwarded-for': limitedIp },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();

    const freshIp = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-forwarded-for': otherIp },
    });
    expect(freshIp.statusCode).toBe(200);
  });

  it('uses the stricter auth limit while still delegating allowed requests to Better Auth', async () => {
    const app: FastifyInstance = await createTestServer({
      buildServer: ({ buildServer }) => buildServer({ dbProbe: { ping: async () => true } }),
    });
    await app.ready();

    const limitedIp = '203.0.113.51';
    const otherIp = '203.0.113.52';
    const signInPayload = {
      email: 'rate-limit-missing-user@example.com',
      password: 'wrong-password-123',
    };

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
      expect(parseResponse<{ code: string }>(res).body).toMatchObject({
        code: 'INVALID_EMAIL_OR_PASSWORD',
      });
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': limitedIp,
      },
      payload: signInPayload,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();

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
