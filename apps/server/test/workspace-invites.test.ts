// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, users, workspaceInvites } from '@repo/db';
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
    invite: {
      id: string;
      email: string;
      role: string;
      status: string;
      expiresAt: string;
      createdAt: string;
      invitedByName: string;
    };
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
    expect(Object.keys(body).sort()).toEqual([
      'email',
      'expiresAt',
      'inviteId',
      'status',
      'workspaceName',
      'workspaceSlug',
    ]);
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
    expect(Object.keys(body)).not.toContain('workspaceId');
    expect(Object.keys(body)).not.toContain('tokenHash');
  });
});

describe('POST /api/workspace-invites/:token/accept', () => {
  it('accepts normalized email representations and returns the workspace result', async () => {
    const ts = Date.now();
    const normalizedEmail = `normalized-winv-${ts}@test.com`;
    const normalizedUser = await signUp(app, normalizedEmail, 'Normalized Workspace User');
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Accept');
    const { invite, token } = await createInviteViaApi(
      aliceCookie,
      ws.slug,
      `  ${normalizedEmail.toUpperCase()}  `,
      'manager',
    );
    expect(invite.email).toBe(normalizedEmail);
    await db
      .update(users)
      .set({ email: `  ${normalizedEmail.toUpperCase()}  ` })
      .where(eq(users.id, normalizedUser.userId));

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      headers: { cookie: normalizedUser.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<Record<string, string>>(res);
    expect(body.workspaceSlug).toBe(ws.slug);
    expect(body.workspaceName).toBe('Accept');

    // Verify Bob can now access the workspace
    const check = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}`,
      headers: { cookie: normalizedUser.cookie },
    });
    expect(check.statusCode).toBe(200);
    const checkBody = parseJsonBody<Record<string, string>>(check);
    expect(checkBody.role).toBe('manager');

    const metadata = await app.inject({
      method: 'GET',
      url: `/api/workspace-invites/${token}`,
    });
    expect(parseJsonBody<Record<string, string>>(metadata).status).toBe('accepted');

    await db
      .update(users)
      .set({ email: normalizedEmail })
      .where(eq(users.id, normalizedUser.userId));
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

    const metadata = await app.inject({
      method: 'GET',
      url: `/api/workspace-invites/${token}`,
    });
    expect(metadata.statusCode).toBe(200);
    const metadataBody = parseJsonBody<Record<string, string>>(metadata);
    expect(metadataBody.status).toBe('pending');
    expect(new Date(metadataBody.expiresAt).getTime()).toBeLessThan(Date.now());
    expect(Object.keys(metadataBody)).not.toContain('workspaceId');

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

describe('POST /api/workspaces/:workspaceSlug/invites/:inviteId/revoke', () => {
  it('returns 404 for a missing invite', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Revoke Missing');
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites/missing-invite/revoke`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns an empty 204 then 409 when revoking the same invite again', async () => {
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Revoke Twice');
    const { invite } = await createInviteViaApi(
      aliceCookie,
      ws.slug,
      'revoke-twice-http-w@test.com',
    );

    const first = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites/${invite.id}/revoke`,
      headers: { cookie: aliceCookie },
    });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');

    const second = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites/${invite.id}/revoke`,
      headers: { cookie: aliceCookie },
    });
    expect(second.statusCode).toBe(409);
  });

  it('returns 409 for an accepted invite and leaves it accepted', async () => {
    const ts = Date.now();
    const email = `accept-revoke-http-w-${ts}@test.com`;
    const actor = await signUp(app, email, 'Accepted Workspace User');
    const { body: ws } = await createWorkspaceViaHttp(app, aliceCookie, 'Accepted Revoke');
    const { invite, token } = await createInviteViaApi(aliceCookie, ws.slug, email);
    await app.inject({
      method: 'POST',
      url: `/api/workspace-invites/${token}/accept`,
      headers: { cookie: actor.cookie },
    });

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites/${invite.id}/revoke`,
      headers: { cookie: aliceCookie },
    });
    expect(revoke.statusCode).toBe(409);
    const metadata = await app.inject({ method: 'GET', url: `/api/workspace-invites/${token}` });
    expect(parseJsonBody<Record<string, string>>(metadata).status).toBe('accepted');
  });
});
