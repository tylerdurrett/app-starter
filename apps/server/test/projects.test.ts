// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, projectMemberships, workspaceMemberships } from '@repo/db';
import type { FastifyInstance } from 'fastify';
import {
  closeTestServers,
  createProjectViaHttp,
  createTestServer,
  createWorkspaceViaHttp,
  parseJsonBody,
  signUp,
} from './helpers.js';

let app: FastifyInstance;

let aliceCookie: string;
let aliceId: string;
let bobCookie: string;
let bobId: string;
let carolCookie: string;
let carolId: string;

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
  app = await createTestServer();
  await app.ready();

  const ts = Date.now();
  const alice = await signUp(app, `alice-proj-${ts}@test.com`, 'Alice');
  aliceCookie = alice.cookie;
  aliceId = alice.userId;

  const bob = await signUp(app, `bob-proj-${ts}@test.com`, 'Bob');
  bobCookie = bob.cookie;
  bobId = bob.userId;

  const carol = await signUp(app, `carol-proj-${ts}@test.com`, 'Carol');
  carolCookie = carol.cookie;
  carolId = carol.userId;
});
afterAll(async () => {
  await closeTestServers();
});

// --- Project CRUD ---

describe('POST /api/projects', () => {
  it('creates a project in a workspace and returns 201', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Project Test Workspace');
    const { response: res, body } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Test Project');

    expect(res.statusCode).toBe(201);
    expect(body.name).toBe('Test Project');
    expect(body.workspaceId).toBe(workspace.id);
    expect(body.slug).toMatch(/^test-project/);
  });

  it('returns 404 when user lacks projects:create permission on workspace', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'No Create Workspace');

    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json', cookie: bobCookie },
      payload: { workspaceSlug: workspace.slug, name: 'Bob Project' },
    });
    expect(res.statusCode).toBe(404); // Bob is not a workspace member
  });

  it('workspace member can create project', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Member Create Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');

    const { response: res, body } = await createProjectViaHttp(app, bobCookie, workspace.slug, 'Bob Created Project');
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'List Workspace');
    const { body: project } = await createProjectViaHttp(app,
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
    const body = parseJsonBody(res);
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'User Wide Direct Workspace');
    const { body: project } = await createProjectViaHttp(app,
      aliceCookie,
      workspace.slug,
      'User Wide Direct Project',
    );
    const { body: sibling } = await createProjectViaHttp(app,
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
    const body = parseJsonBody(res);
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Member Visible Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProjectViaHttp(app,
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
    expect(parseJsonBody(listResponse)).toEqual(
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
    expect(parseJsonBody(detailResponse)).toEqual(
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
    const body = parseJsonBody(res);
    expect(body).toBeNull();
  });

  it('returns project after GET /api/projects/:projectSlug sets it', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Last Active Workspace');
    const { body: project } = await createProjectViaHttp(app,
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
    const body = parseJsonBody(res);
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Fetch Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Fetch Test');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('returns non-null workspaceSlug/workspaceName for a normal project', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Enriched Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Enriched Project');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expect(body.workspaceSlug).toBe(workspace.slug);
    expect(body.workspaceName).toBe(workspace.name);
  });

  it('workspace owner can access project via admin override', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Override Workspace');

    // Bob creates a project in Alice's workspace (Alice gave him member access)
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProjectViaHttp(app, bobCookie, workspace.slug, 'Bob Project');

    // Alice (workspace owner) can access Bob's project
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('workspace manager can access project via admin override', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Manager Override Workspace');

    // Bob is workspace manager, Carol creates a project
    await addWorkspaceMember(workspace.id, bobId, 'manager');
    await addWorkspaceMember(workspace.id, carolId, 'member');
    const { body: project } = await createProjectViaHttp(app, carolCookie, workspace.slug, 'Carol Project');

    // Bob (workspace manager) can access Carol's project
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('workspace member without project membership gets synthetic member access', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Member Access Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProjectViaHttp(app,
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
    expectCanonicalProject(parseJsonBody(res), {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'member',
    });
  });

  it('user with project-scoped access but no workspace access can read project', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Project Scoped Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Project Scoped');

    // Give Carol direct project access but no workspace access
    await addProjectMember(project.id, carolId, 'member');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { cookie: carolCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expectCanonicalProject(body, {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'member',
    });
  });

  it('gives a weaker direct role precedence over workspace-owner access', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Point Precedence Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProjectViaHttp(app,
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
    expectCanonicalProject(parseJsonBody(res), {
      id: project.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'member',
    });
  });

  it('returns 404 for non-existent slug', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Missing Slug Workspace');
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Patch Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Before Patch');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { name: 'After Patch' },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expect(body.name).toBe('After Patch');
  });

  it('workspace owner can update project via admin override', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Patch Override Workspace');
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const { body: project } = await createProjectViaHttp(app, bobCookie, workspace.slug, 'Bob Original');

    // Alice (workspace owner) can update Bob's project
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { name: 'Alice Updated' },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expect(body.name).toBe('Alice Updated');
  });

  it('workspace member without direct project membership cannot update project', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'No Update Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'No Update');
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Private Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Private Project');

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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Delete Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'To Delete');

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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Bad Delete Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Bad Delete');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { confirmation: 'Wrong Text' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('member cannot delete', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Member Delete Workspace');
    const { body: project } = await createProjectViaHttp(app,
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
    const { body: workspaceA } = await createWorkspaceViaHttp(app, aliceCookie, 'Dup Slug Workspace A');
    const { body: workspaceB } = await createWorkspaceViaHttp(app, aliceCookie, 'Dup Slug Workspace B');

    const { body: projectA } = await createProjectViaHttp(app, aliceCookie, workspaceA.slug, 'Shared Name');
    const { body: projectB } = await createProjectViaHttp(app, aliceCookie, workspaceB.slug, 'Shared Name');

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
    expect(parseJsonBody(getA).id).toBe(projectA.id);

    const getB = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceB.slug}/projects/${projectB.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(getB.statusCode).toBe(200);
    expect(parseJsonBody(getB).id).toBe(projectB.id);

    // Updating one does not touch the other
    const patchA = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspaceA.slug}/projects/${projectA.slug}`,
      headers: { 'content-type': 'application/json', cookie: aliceCookie },
      payload: { name: 'Renamed A' },
    });
    expect(patchA.statusCode).toBe(200);
    expect(parseJsonBody(patchA).id).toBe(projectA.id);
    expect(parseJsonBody(patchA).name).toBe('Renamed A');

    const getBAgain = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceB.slug}/projects/${projectB.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(parseJsonBody(getBAgain).id).toBe(projectB.id);
    expect(parseJsonBody(getBAgain).name).toBe('Shared Name');

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
    expect(parseJsonBody(getBFinal).id).toBe(projectB.id);
  });

  it('returns 404 when a project slug is requested under the wrong workspace', async () => {
    const { body: workspaceA } = await createWorkspaceViaHttp(app, aliceCookie, 'Wrong Workspace A');
    const { body: workspaceB } = await createWorkspaceViaHttp(app, aliceCookie, 'Wrong Workspace B');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspaceA.slug, 'Only In A');

    // The slug exists only in workspace A; requesting it under B returns 404
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceB.slug}/projects/${project.slug}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 (not 403) for a non-member requesting an existing project', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Denial Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Denied Project');

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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Members Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Members Project');
    await addProjectMember(project.id, bobId, 'member');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2); // Alice (owner) + Bob (member)
  });

  it('returns 404 for non-member', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Private Members Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Private Members');

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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Remove Member Workspace');
    const { body: project } = await createProjectViaHttp(app,
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Self Remove Workspace');
    const { body: project } = await createProjectViaHttp(app,
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
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Member Remove Workspace');
    const { body: project } = await createProjectViaHttp(app,
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

  it('manager can remove member but not owner', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Manager Remove Owner Workspace');
    const { body: project } = await createProjectViaHttp(app,
      aliceCookie,
      workspace.slug,
      'Manager Remove Owner Project',
    );
    await addProjectMember(project.id, bobId, 'manager');
    await addProjectMember(project.id, carolId, 'member');

    // Manager can remove member
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members/${carolId}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(204);

    // But manager cannot remove the project owner
    const res2 = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members/${aliceId}`,
      headers: { cookie: bobCookie },
    });
    expect(res2.statusCode).toBe(400);

    // The rejected removal leaves the owner's membership intact
    const membersRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members`,
      headers: { cookie: aliceCookie },
    });
    expect(membersRes.statusCode).toBe(200);
    const members = parseJsonBody<Array<{ userId: string; role: string }>>(membersRes);
    expect(members.find((m) => m.userId === aliceId)?.role).toBe('owner');
  });

  it('workspace manager acting via override can remove the direct project owner', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Override Remove Workspace');
    const { body: project } = await createProjectViaHttp(app,
      aliceCookie,
      workspace.slug,
      'Override Remove Project',
    );
    // Bob is a workspace manager with no direct project membership; the
    // resolver presents him as synthetic project 'owner', so the guard passes.
    await addWorkspaceMember(workspace.id, bobId, 'manager');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members/${aliceId}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(204);

    const membersRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/members`,
      headers: { cookie: bobCookie },
    });
    expect(membersRes.statusCode).toBe(200);
    const members = parseJsonBody<Array<{ userId: string }>>(membersRes);
    expect(members.map((m) => m.userId)).not.toContain(aliceId);
  });
});

// --- Invites ---

describe('GET /api/projects/:projectSlug/invites', () => {
  it('owner can list invites', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Invites Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'Invites Project');

    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.slug}/projects/${project.slug}/invites`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody(res);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('POST /api/projects/:projectSlug/invites', () => {
  it('owner can create invite with role', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'Create Invite Workspace');
    const { body: project } = await createProjectViaHttp(app,
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
    const body = parseJsonBody(res);
    expect(body.inviteUrl).toMatch(/\/invite\/project\//);
    expect(body.invite).toMatchObject({
      email: 'newuser@example.com',
      role: 'manager',
      status: 'pending',
      invitedByName: 'Alice',
    });
    expect(Object.keys(body.invite).sort()).toEqual(
      ['createdAt', 'email', 'expiresAt', 'id', 'invitedByName', 'role', 'status'].sort(),
    );
  });

  it('member cannot create invite', async () => {
    const { body: workspace } = await createWorkspaceViaHttp(app, aliceCookie, 'No Invite Workspace');
    const { body: project } = await createProjectViaHttp(app, aliceCookie, workspace.slug, 'No Invite Project');
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
