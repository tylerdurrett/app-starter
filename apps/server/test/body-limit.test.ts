import { describe, it, expect, afterEach } from 'vitest';
import { buildServer, BODY_LIMIT_BYTES } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('Fastify bodyLimit', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('documents the explicit server body limit on routes', async () => {
    app = buildServer();
    app.post('/test/body-limit', async (request) => ({
      bodyLimit: request.routeOptions.bodyLimit,
    }));
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/test/body-limit',
      headers: { 'content-type': 'application/json' },
      payload: { ok: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ bodyLimit: BODY_LIMIT_BYTES });
  });

  it('rejects JSON request bodies larger than the server body limit', async () => {
    app = buildServer();
    app.post('/test/body-limit', async () => ({ ok: true }));
    await app.ready();

    const oversizedPayload = JSON.stringify({ value: 'x'.repeat(BODY_LIMIT_BYTES) });
    const res = await app.inject({
      method: 'POST',
      url: '/test/body-limit',
      headers: { 'content-type': 'application/json' },
      payload: oversizedPayload,
    });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'Request body is too large' });
  });
});
