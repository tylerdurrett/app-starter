// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getSessionFromRequest } from '../src/auth/get-session.js';
import { HttpError } from '../src/auth/require-permission.js';

import { createTestServer, parseResponse, signUp } from './helpers.js';

let app: FastifyInstance;
let sessionCookie: string;

beforeAll(async () => {
  app = await createTestServer({
    buildServer: ({ buildServer }) => {
      const server = buildServer();

      // Register test routes before the instance is ready
      server.get('/test/session', async (request) => {
        const result = await getSessionFromRequest(request);
        return result;
      });

      server.get('/test/session-none', async (request) => {
        const result = await getSessionFromRequest(request);
        return result ?? null;
      });

      server.get('/test/throw-401', async () => {
        throw new HttpError(401, 'Unauthorized');
      });

      server.get('/test/throw-403', async () => {
        throw new HttpError(403, 'Forbidden');
      });

      server.get('/test/throw-404', async () => {
        throw new HttpError(404, 'Not found');
      });

      return server;
    },
  });

  await app.ready();

  // Sign up a test user to get a valid session cookie
  const ts = Date.now();
  ({ cookie: sessionCookie } = await signUp(app, `session-guard-${ts}@test.com`, 'Guard Tester'));
});

describe('getSessionFromRequest', () => {
  it('returns session and user for a valid cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/session',
      headers: { cookie: sessionCookie },
    });

    const { statusCode, body } = parseResponse<{
      user: { id: string; name: string };
      session: { userId: string };
    }>(res);
    expect(statusCode).toBe(200);
    expect(body.user).toBeDefined();
    expect(body.user.name).toBe('Guard Tester');
    expect(body.session).toBeDefined();
    expect(body.session.userId).toBe(body.user.id);
  });

  it('returns null when no cookie is present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/session-none',
    });

    const { statusCode, body } = parseResponse<null>(res);
    expect(statusCode).toBe(200);
    expect(body).toBeNull();
  });
});

describe('error handler', () => {
  it('returns 401 JSON for HttpError(401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/throw-401' });
    const { statusCode, body } = parseResponse<{ error: string }>(res);
    expect(statusCode).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 JSON for HttpError(403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/throw-403' });
    const { statusCode, body } = parseResponse<{ error: string }>(res);
    expect(statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('returns 404 JSON for HttpError(404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/throw-404' });
    const { statusCode, body } = parseResponse<{ error: string }>(res);
    expect(statusCode).toBe(404);
    expect(body.error).toBe('Not found');
  });
});
