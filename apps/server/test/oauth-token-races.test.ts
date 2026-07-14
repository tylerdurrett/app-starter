import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, oauthClients, oauthRefreshTokens } from '@repo/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { createTestServer, signUp } from './helpers.js';

/**
 * Regression tests for the Better Auth token-race advisories fixed by the
 * 1.6.23 upgrade:
 * - GHSA-7w99-5wm4-3g79: authorization codes could be redeemed more than once
 *   under concurrent token requests.
 * - GHSA-392p-2q2v-4372: refresh-token rotation was not atomic, so concurrent
 *   refresh requests could each mint tokens from the same parent token.
 */

const REDIRECT_URI = 'http://localhost:5200/callback';
const CLIENT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];
const REQUESTED_SCOPE = 'openid offline_access';

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
  [key: string]: unknown;
}

/** Public PKCE client fixture. Dynamic client registration is disabled, so a
 * direct DB insert is the supported way to provision OAuth clients. */
async function insertPublicPkceClient(clientId: string): Promise<void> {
  await db.insert(oauthClients).values({
    id: `row-${clientId}`,
    clientId,
    disabled: false,
    skipConsent: true,
    scopes: CLIENT_SCOPES,
    redirectUris: [REDIRECT_URI],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    public: true,
    requirePKCE: true,
    name: `Race test client ${clientId}`,
  });
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Runs the authorize leg with a signed-in session and returns the code. */
async function authorize(
  app: FastifyInstance,
  cookie: string,
  clientId: string,
  challenge: string,
): Promise<string> {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: REQUESTED_SCOPE,
    state: 'race-test-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const res = await app.inject({
    method: 'GET',
    url: `/api/auth/oauth2/authorize?${query.toString()}`,
    headers: { cookie },
  });

  expect(res.statusCode).toBe(302);
  const location = new URL(res.headers.location as string);
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
  expect(location.searchParams.get('error')).toBeNull();
  const code = location.searchParams.get('code');
  expect(code).toBeTruthy();
  return code as string;
}

async function postToken(
  app: FastifyInstance,
  params: Record<string, string>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/auth/oauth2/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(params).toString(),
  });
}

function splitRace(responses: LightMyRequestResponse[]): {
  winners: LightMyRequestResponse[];
  losers: LightMyRequestResponse[];
} {
  return {
    winners: responses.filter((res) => res.statusCode === 200),
    losers: responses.filter((res) => res.statusCode !== 200),
  };
}

describe('OAuth token race regressions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createTestServer();
    await app.ready();
  });

  it('redeems a concurrently replayed authorization code exactly once (GHSA-7w99-5wm4-3g79)', async () => {
    const clientId = `race-code-client-${Date.now()}`;
    await insertPublicPkceClient(clientId);
    const { cookie } = await signUp(app, `race-code-${Date.now()}@example.com`, 'Code Race User');

    const { verifier, challenge } = pkcePair();
    const code = await authorize(app, cookie, clientId, challenge);

    const exchange = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    };
    const { winners, losers } = splitRace(
      await Promise.all([postToken(app, exchange), postToken(app, exchange)]),
    );

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winnerBody = winners[0]!.json<TokenBody>();
    expect(winnerBody.access_token).toBeTruthy();

    // Better Auth surfaces the consumed-code replay as 401 invalid_grant.
    expect(losers[0]!.statusCode).toBe(401);
    expect(losers[0]!.json<TokenBody>().error).toBe('invalid_grant');
  });

  it('rotates a concurrently replayed refresh token exactly once (GHSA-392p-2q2v-4372)', async () => {
    const clientId = `race-refresh-client-${Date.now()}`;
    await insertPublicPkceClient(clientId);
    const { cookie } = await signUp(
      app,
      `race-refresh-${Date.now()}@example.com`,
      'Refresh Race User',
    );

    const { verifier, challenge } = pkcePair();
    const code = await authorize(app, cookie, clientId, challenge);

    const redeem = await postToken(app, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    });
    expect(redeem.statusCode).toBe(200);
    const refreshToken = redeem.json<TokenBody>().refresh_token;
    expect(refreshToken).toBeTruthy();

    const parentRows = await db
      .select({ id: oauthRefreshTokens.id, revoked: oauthRefreshTokens.revoked })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.clientId, clientId));
    expect(parentRows).toHaveLength(1);
    const parentId = parentRows[0]!.id;
    expect(parentRows[0]!.revoked).toBeNull();

    const rotate = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken as string,
      client_id: clientId,
    };
    const { winners, losers } = splitRace(
      await Promise.all([postToken(app, rotate), postToken(app, rotate)]),
    );

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winnerBody = winners[0]!.json<TokenBody>();
    expect(winnerBody.access_token).toBeTruthy();
    expect(winnerBody.refresh_token).toBeTruthy();
    expect(losers[0]!.statusCode).toBe(400);
    expect(losers[0]!.json<TokenBody>().error).toBe('invalid_grant');

    // The parent row must be marked revoked by the winning rotation. Checked
    // before the replay below: replaying a revoked token tears down the whole
    // token family (RFC 9700 §4.14), deleting the row we assert on.
    const [parentRow] = await db
      .select({ revoked: oauthRefreshTokens.revoked })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.id, parentId));
    expect(parentRow).toBeDefined();
    expect(parentRow!.revoked).not.toBeNull();

    // Replaying the rotated-out parent token must fail closed.
    const replay = await postToken(app, rotate);
    expect(replay.statusCode).toBe(400);
    expect(replay.json<TokenBody>().error).toBe('invalid_grant');

    // Deliberately NOT asserted: the winner's new refresh token dying after
    // the replay. Strict RFC 9700 family invalidation is deferred upstream
    // (FIXME(strict-family-invalidation) in @better-auth/oauth-provider).
  });
});
