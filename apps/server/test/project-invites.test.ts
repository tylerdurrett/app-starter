// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, projects, projectInvites, workspaces } from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

let aliceCookie: string;
let bobCookie: string;
let _bobId: string;
let bobEmail: string;
const createdProjectIds: string[] = [];
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
async function createWorkspace(cookie: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/workspaces',
    headers: { 'content-type': 'application/json', cookie },
    payload: { name },
  });
  const body = JSON.parse(res.body);
  if (body.id) createdWorkspaceIds.push(body.id);
  return body;
}

/** Create a project via the API and track its ID for cleanup. */
async function createProject(cookie: string, workspaceSlug: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': 'application/json', cookie },
    payload: { workspaceSlug, name },
  });
  const body = JSON.parse(res.body);
  if (body.id) createdProjectIds.push(body.id);
  return body;
}

/** Create an invite via the API and return the invite + token + inviteUrl. */
async function createInviteViaApi(
  cookie: string,
  workspaceSlug: string,
  projectSlug: string,
  email: string,
  role?: 'manager' | 'member',
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceSlug}/projects/${projectSlug}/invites`,
    headers: { 'content-type': 'application/json', cookie },
    payload: { email, role },
  });
  const body = JSON.parse(res.body);
  // Extract the raw token from the inviteUrl
  const token = body.inviteUrl.split('/invite/project/')[1];
  return { invite: body.invite, token, inviteUrl: body.inviteUrl };
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  const alice = await signUp(`alice-pinv-${ts}@test.com`, 'Alice');
  aliceCookie = alice.cookie;

  bobEmail = `bob-pinv-${ts}@test.com`;
  const bob = await signUp(bobEmail, 'Bob');
  bobCookie = bob.cookie;
  _bobId = bob.userId;
});

afterAll(async () => {
  if (createdProjectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, createdProjectIds)).catch(() => {});
  }
  if (createdWorkspaceIds.length > 0) {
    await db.delete(workspaces).where(inArray(workspaces.id, createdWorkspaceIds)).catch(() => {});
  }
  await app.close();
});

// --- Token-based invite routes ---

describe('GET /api/project-invites/:token', () => {
  it('returns safe invite summary without authentication', async () => {
    const workspace = await createWorkspace(aliceCookie, 'Token Fetch Workspace');
    const project = await createProject(aliceCookie, workspace.slug, 'Token Fetch Project');
    const { token } = await createInviteViaApi(aliceCookie, workspace.slug, project.slug, 'tokenfetch@test.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/project-invites/${token}`,
      // No cookie — unauthenticated
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.email).toBe('tokenfetch@test.com');
    expect(body.projectName).toBe('Token Fetch Project');
    expect(body.projectSlug).toBe(project.slug);
    expect(body.status).toBe('pending');
    expect(body.expiresAt).toBeDefined();
  });

  it('returns 404 for invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/project-invites/invalid-token-xyz',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns metadata with status=revoked for revoked invite (so the landing page can render an explicit card)', async () => {
    const workspace = await createWorkspace(aliceCookie, 'Revoked Workspace');
    const project = await createProject(aliceCookie, workspace.slug, 'Revoked Project');
    const { invite, token } = await createInviteViaApi(aliceCookie, workspace.slug, project.slug, 'revoked@test.com');

    // Revoke the invite
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/invites/${invite.id}/revoke`,
      headers: { cookie: aliceCookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/project-invites/${token}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('revoked');
    expect(body.projectName).toBe('Revoked Project');
  });
});

describe('POST /api/project-invites/:token/accept', () => {
  it('accepts invite for email-matching user', async () => {
    const workspace = await createWorkspace(aliceCookie, 'Accept Workspace');
    const project = await createProject(aliceCookie, workspace.slug, 'Accept Project');
    const { token } = await createInviteViaApi(aliceCookie, workspace.slug, project.slug, bobEmail, 'manager');

    const res = await app.inject({
      method: 'POST',
      url: `/api/project-invites/${token}/accept`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.projectSlug).toBe(project.slug);
    expect(body.projectName).toBe('Accept Project');

    // Verify Bob can now access the project
    const check = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(check.statusCode).toBe(200);
    const checkBody = JSON.parse(check.body);
    expect(checkBody.role).toBe('manager');
  });

  it('returns 403 for email mismatch', async () => {
    const workspace = await createWorkspace(aliceCookie, 'Mismatch Workspace');
    const project = await createProject(aliceCookie, workspace.slug, 'Mismatch Project');
    const { token } = await createInviteViaApi(aliceCookie, workspace.slug, project.slug, 'other@test.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/project-invites/${token}/accept`,
      headers: { cookie: bobCookie }, // Bob's email doesn't match
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/different email/);
  });

  it('returns 401 when unauthenticated', async () => {
    const workspace = await createWorkspace(aliceCookie, 'Auth Workspace');
    const project = await createProject(aliceCookie, workspace.slug, 'Auth Project');
    const { token } = await createInviteViaApi(aliceCookie, workspace.slug, project.slug, 'auth@test.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/project-invites/${token}/accept`,
      // No cookie
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 409 for already accepted invite', async () => {
    const ts = Date.now();
    const carolEmail = `carol-pinv-${ts}@test.com`;
    const carol = await signUp(carolEmail, 'Carol');

    const workspace = await createWorkspace(aliceCookie, 'Already Workspace');
    const project = await createProject(aliceCookie, workspace.slug, 'Already Project');
    const { token } = await createInviteViaApi(aliceCookie, workspace.slug, project.slug, carolEmail);

    // Accept once
    await app.inject({
      method: 'POST',
      url: `/api/project-invites/${token}/accept`,
      headers: { cookie: carol.cookie },
    });

    // Try to accept again
    const res = await app.inject({
      method: 'POST',
      url: `/api/project-invites/${token}/accept`,
      headers: { cookie: carol.cookie },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/already been accepted/);
  });

  it('returns 409 when accepting an expired invite', async () => {
    const workspace = await createWorkspace(aliceCookie, 'Expired Workspace');
    const project = await createProject(aliceCookie, workspace.slug, 'Expired Project');
    const { invite, token } = await createInviteViaApi(aliceCookie, workspace.slug, project.slug, bobEmail);

    // Manually expire the invite in DB
    await db
      .update(projectInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvites.id, invite.id));

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/project-invites/${token}/accept`,
      headers: { cookie: bobCookie },
    });
    expect(acceptRes.statusCode).toBe(409);
    const body = JSON.parse(acceptRes.body);
    expect(body.error).toMatch(/expired/);
  });
});