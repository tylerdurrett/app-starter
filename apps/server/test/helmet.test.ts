import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, HSTS_MAX_AGE_SECONDS } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('Helmet security headers', () => {
  let app: FastifyInstance | undefined;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('sets baseline security headers on health responses', async () => {
    process.env.NODE_ENV = 'test';
    app = buildServer({ dbProbe: { ping: async () => true } });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBeDefined();
  });

  it('does not send HSTS outside production', async () => {
    process.env.NODE_ENV = 'development';
    app = buildServer({ dbProbe: { ping: async () => true } });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('sends HSTS in production', async () => {
    process.env.NODE_ENV = 'production';
    app = buildServer({ dbProbe: { ping: async () => true } });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['strict-transport-security']).toBe(
      `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
    );
  });
});
