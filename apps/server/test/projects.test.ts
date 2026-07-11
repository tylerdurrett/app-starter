// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, projects, projectMemberships, workspaces, workspaceMemberships } from '@repo/db';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

let aliceCookie: string;
let aliceId: string;
let bobCookie: string;
let bobId: string;
let carolCookie: string;
let carolId: string;

const createdProjectIds: string[] = [];
const createdWorkspaceIds: string[] = [];

const canonicalProjectKeys = [
  'id',
  'name',
  'slug',
  'workspaceId',
  'workspaceSlug',
  'workspaceName',
  'createdAt',
  'updatedAt',
  'role',
].sort();

function expectCanonicalProject(
  project: Record<string, unknown>,
  expected: {
    id: string;
    workspaceId: string;
    workspaceSlug: string;
    workspaceName: string;
    role: 'owner' | 'manager' | 'member';
  },
) {
  expect(project).toMatchObject(expected);
  expect(Object.keys(project).sort()).toEqual(canonicalProjectKeys);
  expect(typeof project.createdAt).toBe('string');
  expect(typeof project.updatedAt).toBe('string');
}

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
  return { res, body };
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
  return { res, body };
}

/** Add a user as a member of a workspace directly in the DB. */
async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member' = 'member',
) {
  await db.insert(workspaceMemberships).values({
    id: `wm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    userId,
    role,
  });
}

/** Add a user as a member of a project directly in the DB. */
async function addProjectMember(
  projectId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member' = 'member',
) {
  await db.insert(projectMemberships).values({
    id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    userId,
    role,
  });
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  const alice = await signUp(`alice-proj-${ts}@test.com`, 'Alice');
  aliceCookie = alice.cookie;
  aliceId = alice.userId;

  const bob = await signUp(`bob-proj-${ts}@test.com`, 'Bob');
  bobCookie = bob.cookie;
  bobId = bob.userId;

  const carol = await signUp(`carol-proj-${ts}@test.com`, 'Carol');
  carolCookie = carol.cookie;
  carolId = carol.userId;
});

afterAll(async () => {
  if (createdProjectIds.length > 0) {
    await db
      .delete(projects)
      .where(inArray(projects.id, createdProjectIds))
      .catch(() => {});
  }
  if (createdWorkspaceIds.length > 0) {
    await db
      .delete(workspaces)
      .where(inArray(workspaces.id, createdWorkspaceIds))
      .catch(() => {});
  }
  await app.close();
});

// --- Project CRUD ---

describe('POST /api/projects', () => {
  it('creates a project in a workspace and returns 201', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Project Test Workspace');
    const { res, body } = await createProject(aliceCookie, workspace.slug, 'Test Project');

    expect(res.statusCode).toBe(201);
    expect(body.name).toBe('Test Project');
    expect(body.workspaceId).toBe(workspace.id);
    expect(body.slug).toMatch(/^test-project/);
  });

  it('returns 404 when user lacks projects:create permission on workspace', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'No Create Workspace');

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { workspaceSlug: workspace.slug, name: 'Bob Project' },
    });
    expect(res.statusCode).toBe(404); // Bob is not a workspace member
  });

  it('workspace member can create project', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Member Create Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');

    const { res, body } = await createProject(bobCookie, workspace.slug, 'Bob Created Project');
    expect(res.statusCode).toBe(201);
    expect(body.name).toBe('Bob Created Project');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      payload: { workspaceSlug: 'any', name: 'No Auth' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/projects', () => {
  it('returns projects for the authenticated user', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'List Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'List Test Project',
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    const listed = body.find((candidate: { id: string }) => candidate.id === project.id);
    expectCanonicalProject(listed, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('includes direct-only projects user-wide and omits inaccessible siblings', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'User Wide Direct Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'User Wide Direct Project',
    );
    const { body: sibling } = await createProject(
      aliceCookie,
      workspace.slug,
      'User Wide Inaccessible Sibling',
    );
    await addProjectMember(project.id, carolId, 'manager');

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: carolCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const listed = body.find((candidate: { id: string }) => candidate.id === project.id);
    expectCanonicalProject(listed, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'manager',
    });
    expect(body.some((candidate: { id: string }) => candidate.id === sibling.id)).toBe(false);
  });

  it('lists and reads a workspace project for a member without direct project access', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Member Visible Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Member Visible Project',
    );

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: bobCookie },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: project.id, workspaceId: workspace.id, role: 'member' }),
      ]),
    );

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(JSON.parse(detailResponse.body)).toEqual(
      expect.objectContaining({ id: project.id, role: 'member' }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/projects/last-active', () => {
  it('returns null when no last-active is set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/last-active',
      headers: { cookie: carolCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toBeNull();
  });

  it('returns project after GET /api/projects/:projectSlug sets it', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Last Active Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Last Active Project',
    );

    // Fetch project by slug (sets lastActive)
    await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/last-active',
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/last-active' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/projects/:projectSlug', () => {
  it('returns project + role for a direct member', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Fetch Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Fetch Test');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('returns non-null workspaceSlug/workspaceName for a normal project', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Enriched Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Enriched Project');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.workspaceSlug).toBe(workspace.slug);
    expect(body.workspaceName).toBe(workspace.name);
  });

  it('workspace owner can access project via admin override', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Override Workspace');

    // Bob creates a project in Alice's workspace (Alice gave him member access)
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProject(bobCookie, workspace.slug, 'Bob Project');

    // Alice (workspace owner) can access Bob's project
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('workspace manager can access project via admin override', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Manager Override Workspace');

    // Bob is workspace manager, Carol creates a project
    await addWorkspaceMember(workspace.id, bobId, 'manager');
    await addWorkspaceMember(workspace.id, carolId, 'member');
    const { body: project } = await createProject(carolCookie, workspace.slug, 'Carol Project');

    // Bob (workspace manager) can access Carol's project
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('workspace member without project membership gets synthetic member access', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Member Access Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Workspace Member Project',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(200);
    expectCanonicalProject(JSON.parse(res.body), {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'member',
    });
  });

  it('user with project-scoped access but no workspace access can read project', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Project Scoped Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Project Scoped');

    // Give Carol direct project access but no workspace access
    await addProjectMember(project.id, carolId, 'member');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: carolCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'member',
    });
  });

  it('gives a weaker direct role precedence over workspace-owner access', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Point Precedence Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProject(
      bobCookie,
      workspace.slug,
      'Point Precedence Project',
    );
    await addProjectMember(project.id, aliceId, 'member');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    expectCanonicalProject(JSON.parse(res.body), {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'member',
    });
  });

  it('returns 404 for non-existent slug', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Missing Slug Workspace');
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/no-such-project-ever`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces/anything/projects/anything',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /api/projects/:projectSlug', () => {
  it('owner can update name', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Patch Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Before Patch');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { name: 'After Patch' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('After Patch');
  });

  it('workspace owner can update project via admin override', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Patch Override Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProject(bobCookie, workspace.slug, 'Bob Original');

    // Alice (workspace owner) can update Bob's project
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { name: 'Alice Updated' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Alice Updated');
  });

  it('workspace member without direct project membership cannot update project', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'No Update Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'No Update');
    await addWorkspaceMember(workspace.id, bobId, 'member');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { name: 'Bob Tries' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for non-member', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Private Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Private Project');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { name: 'Bob Tries' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/projects/:projectSlug', () => {
  it('owner can delete with correct confirmation', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Delete Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'To Delete');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { confirmation: 'Delete To Delete' },
    });
    expect(res.statusCode).toBe(204);

    // Verify it's gone
    const check = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(check.statusCode).toBe(404);
  });

  it('returns 400 with incorrect confirmation', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Bad Delete Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Bad Delete');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { confirmation: 'Wrong Text' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('member cannot delete', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Member Delete Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Member Cannot Delete',
    );
    await addProjectMember(project.id, bobId, 'member');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { confirmation: 'Delete Member Cannot Delete' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// --- Cross-workspace duplicate slugs ---

describe('duplicate project slugs across workspaces', () => {
  it('fetches, updates, and deletes each same-slug project via its own workspace URL', async () => {
    const { body: workspaceA } = await createWorkspace(aliceCookie, 'Dup Slug Workspace A');
    const { body: workspaceB } = await createWorkspace(aliceCookie, 'Dup Slug Workspace B');

    const { body: projectA } = await createProject(aliceCookie, workspaceA.slug, 'Shared Name');
    const { body: projectB } = await createProject(aliceCookie, workspaceB.slug, 'Shared Name');

    // Same slug, different projects in different workspaces
    expect(projectA.slug).toBe(projectB.slug);
    expect(projectA.id).not.toBe(projectB.id);

    // Each fetchable via its own workspace URL, resolving to the right project
    const getA = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceA.slug}/projects/${projectA.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(getA.statusCode).toBe(200);
    expect(JSON.parse(getA.body).id).toBe(projectA.id);

    const getB = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceB.slug}/projects/${projectB.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(getB.statusCode).toBe(200);
    expect(JSON.parse(getB.body).id).toBe(projectB.id);

    // Updating one does not touch the other
    const patchA = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspaceA.slug}/projects/${projectA.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { name: 'Renamed A' },
    });
    expect(patchA.statusCode).toBe(200);
    expect(JSON.parse(patchA.body).id).toBe(projectA.id);
    expect(JSON.parse(patchA.body).name).toBe('Renamed A');

    const getBAgain = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceB.slug}/projects/${projectB.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(JSON.parse(getBAgain.body).id).toBe(projectB.id);
    expect(JSON.parse(getBAgain.body).name).toBe('Shared Name');

    // Deleting one leaves the other reachable
    const deleteA = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspaceA.slug}/projects/${projectA.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { confirmation: 'Delete Renamed A' },
    });
    expect(deleteA.statusCode).toBe(204);

    const getBFinal = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceB.slug}/projects/${projectB.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(getBFinal.statusCode).toBe(200);
    expect(JSON.parse(getBFinal.body).id).toBe(projectB.id);
  });

  it('returns 404 when a project slug is requested under the wrong workspace', async () => {
    const { body: workspaceA } = await createWorkspace(aliceCookie, 'Wrong Workspace A');
    const { body: workspaceB } = await createWorkspace(aliceCookie, 'Wrong Workspace B');
    const { body: project } = await createProject(aliceCookie, workspaceA.slug, 'Only In A');

    // The slug exists only in workspace A; requesting it under B returns 404
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceB.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 (not 403) for a non-member requesting an existing project', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Denial Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Denied Project');

    // Bob is neither a workspace member nor a project member
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

// --- Members ---

describe('GET /api/projects/:projectSlug/members', () => {
  it('returns members list for authorized user', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Members Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Members Project');
    await addProjectMember(project.id, bobId, 'member');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2); // Alice (owner) + Bob (member)
  });

  it('returns 404 for non-member', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Private Members Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Private Members');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/projects/:projectSlug/members/:userId', () => {
  it('owner can remove member', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Remove Member Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Remove Member Project',
    );
    await addProjectMember(project.id, bobId, 'member');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members/${bobId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('cannot remove self', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Self Remove Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Self Remove Project',
    );

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members/${aliceId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it('member cannot remove others', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Member Remove Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Member Remove Project',
    );
    await addProjectMember(project.id, bobId, 'member');
    await addProjectMember(project.id, carolId, 'member');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members/${carolId}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

// --- Invites ---

describe('GET /api/projects/:projectSlug/invites', () => {
  it('owner can list invites', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Invites Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'Invites Project');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/invites`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('POST /api/projects/:projectSlug/invites', () => {
  it('owner can create invite with role', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'Create Invite Workspace');
    const { body: project } = await createProject(
      aliceCookie,
      workspace.slug,
      'Create Invite Project',
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/invites`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { email: 'newuser@example.com', role: 'manager' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.inviteUrl).toMatch(/\/invite\/project\//);
    expect(body.invite.email).toBe('newuser@example.com');
    expect(body.invite.role).toBe('manager');
  });

  it('member cannot create invite', async () => {
    const { body: workspace } = await createWorkspace(aliceCookie, 'No Invite Workspace');
    const { body: project } = await createProject(aliceCookie, workspace.slug, 'No Invite Project');
    await addProjectMember(project.id, bobId, 'member');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/invites`,
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { email: 'blocked@example.com' },
    });
    expect(res.statusCode).toBe(403);
  });
});
