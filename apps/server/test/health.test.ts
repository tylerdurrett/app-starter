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
    const internalDetails = [
      'db.internal.example',
      'customer_production',
      'SELECT private_value FROM internal_table',
      'ECONNREFUSED',
    ];
    const internalMessage = internalDetails.join(' | ');
    const logLines: string[] = [];
    const failingProbe: DbProbe = {
      ping: async () => {
        throw new Error(internalMessage);
      },
    };

    app = buildServer({
      dbProbe: failingProbe,
      loggerStream: {
        write: (msg) => {
          logLines.push(msg);
        },
      },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'error',
      db: 'disconnected',
      error: 'Database unavailable',
    });

    for (const detail of internalDetails) {
      expect(res.body).not.toContain(detail);
    }

    const failureLog = logLines
      .map((line) => JSON.parse(line) as { msg?: string; err?: { message?: string; stack?: string } })
      .find((line) => line.msg === 'Database health probe failed');

    expect(failureLog?.err?.message).toBe(internalMessage);
    expect(failureLog?.err?.stack).toContain(internalMessage);
  });
});
