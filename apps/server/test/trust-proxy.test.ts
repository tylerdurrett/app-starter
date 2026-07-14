import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

function addRequestMetadataRoute(app: FastifyInstance) {
  app.get('/test/request-metadata', async (request) => ({
    ip: request.ip,
    host: request.host,
    protocol: request.protocol,
  }));
}

describe('Fastify trustProxy', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('ignores forwarded identity headers with the default disabled policy', async () => {
    app = buildServer({ trustProxy: false });
    addRequestMetadataRoute(app);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test/request-metadata',
      headers: {
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-host': 'spoofed.example.com',
        'x-forwarded-proto': 'https',
        host: 'direct.example.com',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ip: '127.0.0.1',
      host: 'direct.example.com',
      protocol: 'http',
    });
  });

  it('recovers forwarded identity through a trusted loopback proxy', async () => {
    app = buildServer({ trustProxy: ['loopback'] });
    addRequestMetadataRoute(app);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test/request-metadata',
      headers: {
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-host': 'api.example.com',
        'x-forwarded-proto': 'https',
        host: 'localhost:5100',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ip: '203.0.113.10',
      host: 'api.example.com',
      protocol: 'https',
    });
  });

  it('ignores forwarded identity from an untrusted immediate peer', async () => {
    app = buildServer({ trustProxy: ['loopback'] });
    addRequestMetadataRoute(app);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test/request-metadata',
      remoteAddress: '198.51.100.25',
      headers: {
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-host': 'spoofed.example.com',
        'x-forwarded-proto': 'https',
        host: 'direct.example.com',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ip: '198.51.100.25',
      host: 'direct.example.com',
      protocol: 'http',
    });
  });

  it('stops a multi-hop chain at the first untrusted address', async () => {
    app = buildServer({ trustProxy: ['loopback', '10.0.0.0/8'] });
    addRequestMetadataRoute(app);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test/request-metadata',
      headers: {
        'x-forwarded-for': '203.0.113.10, 198.51.100.7, 10.0.0.5',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ip: '198.51.100.7' });
  });
});
