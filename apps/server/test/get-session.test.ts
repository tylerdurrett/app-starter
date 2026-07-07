// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';
import { getSessionFromRequest } from '../src/auth/get-session.js';
import { HttpError } from '../src/auth/require-permission.js';

let app: FastifyInstance;
let sessionCookie: string;

beforeAll(async () => {
  app = buildServer();

  // Register test routes before the instance is ready
  app.get('/test/session', async (request) => {
    const result = await getSessionFromRequest(request);
    return result;
  });

  app.get('/test/session-none', async (request) => {
    const result = await getSessionFromRequest(request);
    return result ?? null;
  });

  app.get('/test/throw-401', async () => {
    throw new HttpError(401, 'Unauthorized');
  });

  app.get('/test/throw-403', async () => {
    throw new HttpError(403, 'Forbidden');
  });

  app.get('/test/throw-404', async () => {
    throw new HttpError(404, 'Not found');
  });

  await app.ready();

  // Sign up a test user to get a valid session cookie
  const ts = Date.now();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: `session-guard-${ts}@test.com`, password: 'password123', name: 'Guard Tester' },
  });
  const setCookie = res.headers['set-cookie'] as string;
  sessionCookie = setCookie.split(';')[0];
});

afterAll(async () => {
  await app.close();
});

describe('getSessionFromRequest', () => {
  it('returns session and user for a valid cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/session',
      headers: { cookie: sessionCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
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

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toBeNull();
  });
});

describe('error handler', () => {
  it('returns 401 JSON for HttpError(401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/throw-401' });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 JSON for HttpError(403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/throw-403' });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Forbidden');
  });

  it('returns 404 JSON for HttpError(404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/throw-404' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Not found');
  });
});
