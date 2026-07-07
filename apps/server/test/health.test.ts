import { describe, it, expect, afterEach } from 'vitest';
import { buildServer } from '../src/index.js';
import type { DbProbe } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('GET /health', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 200 with real Postgres DB', async () => {
    app = buildServer();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'connected' });
  });

  it('returns 503 when DB probe fails', async () => {
    const failingProbe: DbProbe = {
      ping: async () => {
        throw new Error('connection refused');
      },
    };

    app = buildServer({ dbProbe: failingProbe });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'error',
      db: 'disconnected',
      error: 'connection refused',
    });
  });
});
