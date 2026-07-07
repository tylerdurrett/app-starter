// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, workspaces, workspaceMemberships } from '@repo/db';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

let aliceCookie: string;
let aliceId: string;
let bobCookie: string;
let bobId: string;
const createdWorkspaceIds: string[] = [];

/** Sign up a user and return their ID + session cookie. */
async function signUp(email: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password: 'password123', name },
  });
  const body = JSON.parse(res.body);
  const setCookie = res.headers['set-cookie'] as string;
  return { userId: body.user.id, cookie: setCookie.split(';')[0] };
}

/** Create a workspace via the API and track its ID for cleanup. */
async function createWs(cookie: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/workspaces',
    headers: { 'content-type': 'application/json', cookie },
    payload: { name },
  });
  const body = JSON.parse(res.body);
  if (body.id) createdWorkspaceIds.push(body.id);
  return { res, body };
}

/** Add a user as a member of a workspace directly in the DB. */
async function addMember(workspaceId: string, userId: string, role: 'owner' | 'manager' | 'member' = 'member') {
  await db.insert(workspaceMemberships).values({
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    userId,
    role,
  });
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  const alice = await signUp(`alice-ws-${ts}@test.com`, 'Alice');
  aliceCookie = alice.cookie;
  aliceId = alice.userId;

  const bob = await signUp(`bob-ws-${ts}@test.com`, 'Bob');
  bobCookie = bob.cookie;
  bobId = bob.userId;
});

afterAll(async () => {
  if (createdWorkspaceIds.length > 0) {
    await db.delete(workspaces).where(inArray(workspaces.id, createdWorkspaceIds)).catch(() => {});
  }
  await app.close();
});

// --- Workspace CRUD ---

describe('POST /api/workspaces', () => {
  it('creates a workspace and returns 201', async () => {
    const { res, body } = await createWs(aliceCookie, 'Route Test');
    expect(res.statusCode).toBe(201);
    expect(body.name).toBe('Route Test');
    expect(body.slug).toMatch(/^route-test/);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'No Auth' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/workspaces', () => {
  it('returns workspaces for the authenticated user', async () => {
    await createWs(aliceCookie, 'List Test');

    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((w: { name: string }) => w.name === 'List Test')).toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/workspaces/:workspaceSlug', () => {
  it('returns workspace + role for a member', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Fetch Test');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(ws.id);
    expect(body.role).toBe('owner');
  });

  it('returns 404 for non-member', async () => {
    const { body: ws } = await createWs(aliceCookie, 'No Bob Fetch');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-existent slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/no-such-workspace-ever',
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/anything',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /api/workspaces/:workspaceSlug', () => {
  it('owner can update name', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Before Patch');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { name: 'After Patch' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('After Patch');
  });

  it('manager can update name', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Manager Update');
    await addMember(ws.id, bobId, 'manager');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { name: 'Manager Updated' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Manager Updated');
  });

  it('member cannot update', async () => {
    const { body: ws } = await createWs(aliceCookie, 'No Member Update');
    await addMember(ws.id, bobId, 'member');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { name: 'Blocked' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for non-member', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Private Update');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { name: 'Bob Tries' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/workspaces/:workspaceSlug', () => {
  it('owner can delete with correct confirmation', async () => {
    const { body: ws } = await createWs(aliceCookie, 'To Delete');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { confirmation: 'Delete To Delete' },
    });
    expect(res.statusCode).toBe(204);

    // Verify it's gone
    const check = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(check.statusCode).toBe(404);
  });

  it('manager cannot delete', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Manager No Delete');
    await addMember(ws.id, bobId, 'manager');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { confirmation: `Delete ${ws.name}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 with incorrect confirmation', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Bad Delete');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { confirmation: 'Wrong Text' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('member cannot delete', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Member No Delete');
    await addMember(ws.id, bobId, 'member');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { confirmation: `Delete ${ws.name}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// --- Members ---

describe('GET /api/workspaces/:workspaceSlug/members', () => {
  it('returns members list for authorized user', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Members List');
    await addMember(ws.id, bobId, 'member');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}/members`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2); // Alice (owner) + Bob (member)
  });

  it('returns 404 for non-member', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Private Members');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}/members`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/workspaces/:workspaceSlug/members/:userId', () => {
  it('owner can remove member', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Remove Member');
    await addMember(ws.id, bobId, 'member');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}/members/${bobId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('manager can remove member but not owner', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Manager Remove');
    await addMember(ws.id, bobId, 'manager');

    // Create another member
    const ts = Date.now();
    const carol = await signUp(`carol-ws-${ts}@test.com`, 'Carol');
    await addMember(ws.id, carol.userId, 'member');

    // Manager can remove member
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}/members/${carol.userId}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(204);

    // But manager cannot remove owner
    const res2 = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}/members/${aliceId}`,
      headers: { cookie: bobCookie },
    });
    expect(res2.statusCode).toBe(400); // Cannot remove yourself applies to all roles
  });

  it('cannot remove self', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Self Remove');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}/members/${aliceId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('member cannot remove others', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Member Remove Block');
    await addMember(ws.id, bobId, 'member');

    const ts = Date.now();
    const carol = await signUp(`carol2-ws-${ts}@test.com`, 'Carol');
    await addMember(ws.id, carol.userId, 'member');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.slug}/members/${carol.userId}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

// --- Invites ---

describe('GET /api/workspaces/:workspaceSlug/invites', () => {
  it('owner can list invites', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Invites List');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${ws.slug}/invites`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('POST /api/workspaces/:workspaceSlug/invites', () => {
  it('owner can create invite with role', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Create Invite');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { email: 'newuser@example.com', role: 'manager' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.inviteUrl).toMatch(/\/invite\/workspace\//);
    expect(body.invite.email).toBe('newuser@example.com');
    expect(body.invite.role).toBe('manager');
  });

  it('manager can create invite', async () => {
    const { body: ws } = await createWs(aliceCookie, 'Manager Invite');
    await addMember(ws.id, bobId, 'manager');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { email: 'manager-invited@example.com', role: 'member' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('member cannot create invite', async () => {
    const { body: ws } = await createWs(aliceCookie, 'No Member Invite');
    await addMember(ws.id, bobId, 'member');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws.slug}/invites`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { email: 'blocked@example.com', role: 'member' },
    });
    expect(res.statusCode).toBe(403);
  });
});