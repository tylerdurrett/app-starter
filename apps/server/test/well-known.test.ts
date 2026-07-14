import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, oauthClients } from '@repo/db';
import type { FastifyInstance } from 'fastify';

const HTTPS_ORIGIN = 'https://example.tailnet.ts.net';
const HTTPS_MCP_URL = `${HTTPS_ORIGIN}/mcp`;
const TEST_ENV = {
  BETTER_AUTH_URL: HTTPS_ORIGIN,
  MCP_CANONICAL_URL: HTTPS_MCP_URL,
  CORS_ORIGIN: 'http://localhost:5200',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  CREDENTIAL_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
} as const;

describe('OAuth well-known metadata', () => {
  let app: FastifyInstance | undefined;
  const originalEnv: Record<keyof typeof TEST_ENV, string | undefined> = {
    BETTER_AUTH_URL: undefined,
    MCP_CANONICAL_URL: undefined,
    CORS_ORIGIN: undefined,
    BETTER_AUTH_SECRET: undefined,
    CREDENTIAL_ENCRYPTION_KEY: undefined,
  };

  beforeEach(async () => {
    for (const key of Object.keys(TEST_ENV) as Array<keyof typeof TEST_ENV>) {
      originalEnv[key] = process.env[key];
      process.env[key] = TEST_ENV[key];
    }

    vi.resetModules();
    const { buildServer } = await import('../src/index.js');
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;

    for (const key of Object.keys(TEST_ENV) as Array<keyof typeof TEST_ENV>) {
      const original = originalEnv[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    vi.resetModules();
  });

  it('advertises the configured HTTPS issuer without rewriting BetterAuth metadata', async () => {
    const spoofedHeaders = {
      host: 'attacker.example.com',
      'x-forwarded-host': 'forwarded-attacker.example.com',
      'x-forwarded-proto': 'http',
    };
    const authServer = await app!.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
      headers: spoofedHeaders,
    });
    const openId = await app!.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration',
      headers: spoofedHeaders,
    });
    const protectedResource = await app!.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
      headers: spoofedHeaders,
    });

    expect(authServer.statusCode).toBe(200);
    expect(openId.statusCode).toBe(200);
    expect(protectedResource.statusCode).toBe(200);

    const authServerBody = authServer.json();
    const openIdBody = openId.json();
    const protectedResourceBody = protectedResource.json();

    expect(authServerBody).toMatchObject({
      issuer: HTTPS_ORIGIN,
      authorization_endpoint: `${HTTPS_ORIGIN}/api/auth/oauth2/authorize`,
      token_endpoint: `${HTTPS_ORIGIN}/api/auth/oauth2/token`,
      jwks_uri: `${HTTPS_ORIGIN}/api/auth/jwks`,
    });
    expect(openIdBody.issuer).toBe(HTTPS_ORIGIN);
    expect(protectedResourceBody).toMatchObject({
      resource: HTTPS_MCP_URL,
      authorization_servers: [HTTPS_ORIGIN],
      scopes_supported: ['workspaces:read', 'projects:read'],
    });
  });

  it('keeps real authorization redirects on the configured login origin', async () => {
    const clientId = `configured-origin-client-${Date.now()}`;
    const redirectUri = 'https://client.example.com/oauth/callback';
    await db.insert(oauthClients).values({
      id: clientId,
      clientId,
      name: 'Configured origin regression client',
      redirectUris: [redirectUri],
      scopes: ['openid'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      public: true,
      requirePKCE: true,
    });

    const response = await app!.inject({
      method: 'GET',
      url: '/api/auth/oauth2/authorize',
      query: {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid',
        state: 'configured-origin-regression',
        code_challenge: 'Q'.repeat(43),
        code_challenge_method: 'S256',
      },
      headers: {
        host: 'attacker.example.com',
        'x-forwarded-host': 'forwarded-attacker.example.com',
        'x-forwarded-proto': 'http',
      },
    });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin).toBe(TEST_ENV.CORS_ORIGIN);
    expect(location.pathname).toBe('/login');
    expect(location.href).not.toContain('attacker.example.com');
  });
});
