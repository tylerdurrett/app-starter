import { afterEach, describe, expect, it } from 'vitest';
import {
  LOG_REDACTION_CENSOR,
  buildServer,
} from '../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('Pino log redaction', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('redacts auth headers, cookies, and token-shaped fields from structured logs', async () => {
    const logLines: string[] = [];
    const secrets = [
      'Bearer request-authorization-secret',
      'session=request-cookie-secret',
      'Bearer bare-authorization-secret',
      'bare-cookie-secret',
      'bare-set-cookie-secret',
      'reply-set-cookie-secret',
      'response-set-cookie-secret',
      'slack-signing-secret',
      'xoxb-bot-token-secret',
      'oauth-access-token-secret',
      'oauth-refresh-token-secret',
      'oauth-id-token-secret',
      'oauth-client-secret',
      'password-secret',
      'generic-token-secret',
    ];

    app = buildServer({
      dbProbe: { ping: async () => true },
      loggerStream: {
        write: (msg) => {
          logLines.push(msg);
        },
      },
    });

    app.get('/test/logger-redaction', async (request, reply) => {
      reply.header('set-cookie', 'session=reply-set-cookie-secret');
      request.log.info({
        req: {
          headers: {
            authorization: 'Bearer request-authorization-secret',
            cookie: 'session=request-cookie-secret',
          },
        },
        headers: {
          authorization: 'Bearer bare-authorization-secret',
          cookie: 'bare-cookie-secret',
          'set-cookie': 'bare-set-cookie-secret',
        },
        res: {
          headers: {
            'set-cookie': 'response-set-cookie-secret',
          },
        },
        integration: {
          signingSecret: 'slack-signing-secret',
          credentials: {
            botToken: 'xoxb-bot-token-secret',
            oauth: {
              access_token: 'oauth-access-token-secret',
              refreshToken: 'oauth-refresh-token-secret',
              idToken: 'oauth-id-token-secret',
              clientSecret: 'oauth-client-secret',
              password: 'password-secret',
              token: 'generic-token-secret',
            },
          },
        },
      }, 'redaction probe');

      return { ok: true };
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/test/logger-redaction',
      headers: {
        authorization: 'Bearer request-authorization-secret',
        cookie: 'session=request-cookie-secret',
      },
    });

    expect(res.statusCode).toBe(200);

    const logOutput = logLines.join('');
    expect(logOutput).toContain(LOG_REDACTION_CENSOR);
    for (const secret of secrets) {
      expect(logOutput).not.toContain(secret);
    }

    const probeLog = logLines
      .map((line) => JSON.parse(line) as { msg?: string; integration?: { credentials?: { oauth?: Record<string, unknown> } } })
      .find((line) => line.msg === 'redaction probe');

    expect(probeLog).toBeDefined();
    expect(probeLog?.integration?.credentials?.oauth).toMatchObject({
      access_token: LOG_REDACTION_CENSOR,
      refreshToken: LOG_REDACTION_CENSOR,
      idToken: LOG_REDACTION_CENSOR,
      clientSecret: LOG_REDACTION_CENSOR,
      password: LOG_REDACTION_CENSOR,
      token: LOG_REDACTION_CENSOR,
    });
  });
});
