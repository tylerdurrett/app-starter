// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, workspaceInvites } from '@repo/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  closeTestServers,
  createTestServer,
  createWorkspaceViaHttp,
  parseJsonBody,
  signUp,
} from './helpers.js';

let app: FastifyInstance;

let aliceCookie: string;
let bobCookie: string;
let bobEmail: string;

/** Create an invite via the API and return the invite + token + inviteUrl. */
async function createInviteViaApi(
  cookie: string,
  slug: string,
  email: string,
  role: 'manager' | 'member' = 'member',
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${slug}/invites`,
    headers: { 'content-type': 'application/json', cookie },
    payload: { email, role },
  });
  const body = parseJsonBody<{
    invite: { id: string };
    inviteUrl: string;
  }>(res);
  // Extract the raw token from the inviteUrl
  const token = body.inviteUrl.split('/invite/workspace/')[1];
  return { invite: body.invite, token, inviteUrl: body.inviteUrl };
}

beforeAll(async () => {
  app = await createTestServer();
  await app.ready();

  const ts = Date.now();
  const alice = await signUp(app, `alice-winv-${ts}@test.com`, 'Alice');
  aliceCookie = alice.cookie;

  bobEmail = `bob-winv-${ts}@test.com`;
  const bob = await signUp(app, bobEmail, 'Bob');
  bobCookie = bob.cookie;
});

afterAll(async () => {
  await closeTestServers();
});

// --- Token-based invite routes ---

describe('GET /api/workspace-invites/:token', () => {
  it('returns safe invite summary without authentication', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Token Fetch');
    const { token } = await createInviteViaApi(aliceCookie, ws.slug, 'tokenfetch@test.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspace-invites/${token}`,
      // No cookie — unauthenticated
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<Record<string, string>>(res);
    expect(body.email).toBe('tokenfetch@test.com');
    expect(body.workspaceName).toBe('Token Fetch');
    expect(body.workspaceSlug).toBe(ws.slug);
    expect(body.status).toBe('pending');
    expect(body.expiresAt).toBeDefined();
  });

  it('returns 404 for invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspace-invites/invalid-token-xyz',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns metadata with status=revoked for revoked invite (so the landing page can render an explicit card)', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Revoked');
    const { invite, token } = await createInviteViaApi(aliceCookie, ws.slug, 'revoked@test.com');

    // Revoke the invite
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites/${invite.id}/revoke`,
      headers: { cookie: aliceCookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspace-invites/${token}`,
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<Record<string, string>>(res);
    expect(body.status).toBe('revoked');
    expect(body.workspaceName).toBe('Revoked');
  });
});

describe('POST /api/workspace-invites/:token/accept', () => {
  it('accepts invite for email-matching user', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Accept');
    const { token } = await createInviteViaApi(aliceCookie, ws.slug, bobEmail, 'manager');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<Record<string, string>>(res);
    expect(body.workspaceSlug).toBe(ws.slug);
    expect(body.workspaceName).toBe('Accept');

    // Verify Bob can now access the workspace
    const check = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(check.statusCode).toBe(200);
    const checkBody = parseJsonBody<Record<string, string>>(check);
    expect(checkBody.role).toBe('manager');
  });

  it('returns 403 for email mismatch', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Mismatch');
    const { token } = await createInviteViaApi(aliceCookie, ws.slug, 'other@test.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      headers: { cookie: bobCookie }, // Bob's email doesn't match
    });
    expect(res.statusCode).toBe(403);
    const body = parseJsonBody<{ error: string }>(res);
    expect(body.error).toMatch(/different email/);
  });

  it('returns 401 when unauthenticated', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Auth');
    const { token } = await createInviteViaApi(aliceCookie, ws.slug, 'auth@test.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      // No cookie
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 409 for already accepted invite', async () => {
    const ts = Date.now();
    const carolEmail = `carol-winv-${ts}@test.com`;
    const carol = await signUp(app, carolEmail, 'Carol');

    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Already');
    const { token } = await createInviteViaApi(aliceCookie, ws.slug, carolEmail);

    // Accept once
    await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      headers: { cookie: carol.cookie },
    });

    // Try to accept again
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      headers: { cookie: carol.cookie },
    });
    expect(res.statusCode).toBe(409);
    const body = parseJsonBody<{ error: string }>(res);
    expect(body.error).toMatch(/already been accepted/);
  });

  it('returns 409 when accepting an expired invite', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Expired');
    const { invite, token } = await createInviteViaApi(aliceCookie, ws.slug, bobEmail);

    // Manually expire the invite in DB
    await db
      .update(workspaceInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(workspaceInvites.id, invite.id));

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      headers: { cookie: bobCookie },
    });
    expect(acceptRes.statusCode).toBe(409);
    const body = parseJsonBody<{ error: string }>(acceptRes);
    expect(body.error).toMatch(/expired/);
  });
});
