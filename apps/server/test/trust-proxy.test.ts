import { describe, it, expect, afterEach } from 'vitest';
import { buildServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('Fastify trustProxy', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('uses forwarded headers for client request metadata behind Render', async () => {
    app = buildServer();
    app.get('/test/request-metadata', async (request) => ({
      ip: request.ip,
      host: request.host,
      protocol: request.protocol,
    }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test/request-metadata',
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.5',
        'x-forwarded-host': 'brain-api.tdstuff.com',
        'x-forwarded-proto': 'https',
        host: 'internal-render-host',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ip: '203.0.113.10',
      host: 'brain-api.tdstuff.com',
      protocol: 'https',
    });
  });
});
