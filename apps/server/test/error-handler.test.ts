import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('global error handler', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('logs unexpected exceptions without exposing their details in the 500 response', async () => {
    const internalDetails = [
      'db.internal.example',
      'customer_production',
      'SELECT private_value FROM internal_table',
      'ECONNREFUSED',
    ];
    const internalMessage = internalDetails.join(' | ');
    const logLines: string[] = [];

    app = buildServer({
      dbProbe: { ping: async () => undefined },
      loggerStream: {
        write: (msg) => {
          logLines.push(msg);
        },
      },
    });
    app.get('/test/unexpected-error', async () => {
      throw new Error(internalMessage);
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test/unexpected-error' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal Server Error' });
    for (const detail of internalDetails) {
      expect(res.body).not.toContain(detail);
    }

    const failureLog = logLines
      .map((line) => JSON.parse(line) as { msg?: string; err?: { message?: string; stack?: string } })
      .find((line) => line.msg === 'Unhandled request error');

    expect(failureLog?.err?.message).toBe(internalMessage);
    expect(failureLog?.err?.stack).toContain(internalMessage);
  });
});
