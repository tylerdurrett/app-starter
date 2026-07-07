// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import {
  db,
  workspaces,
  workspaceMemberships,
  projects,
  projectMemberships,
} from '@repo/db';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { createWorkspace } from '../src/workspaces/service.js';
import { createProject } from '../src/projects/service.js';
import { resolveProjectWithOverride } from '../src/projects/resolver.js';

// ---- helpers ----

let app: FastifyInstance;
let ownerId: string;
let wsOwnerId: string;
let wsManagerId: string;
let wsMemberId: string;
let outsiderId: string;
const createdWorkspaceIds: string[] = [];
const createdProjectIds: string[] = [];

async function signUp(email: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password: 'password123', name },
  });
  const body = JSON.parse(res.body);
  return body.user.id;
}

async function createWs(name: string, ownerUserId: string) {
  const ws = await createWorkspace({ name, ownerUserId });
  createdWorkspaceIds.push(ws.id);
  return ws;
}

async function createProj(name: string, workspaceId: string, ownerUserId: string) {
  const proj = await createProject({ name, workspaceId, ownerUserId });
  if (proj) createdProjectIds.push(proj.id);
  return proj!;
}

async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member',
) {
  await db.insert(workspaceMemberships).values({
    id: `wsm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    userId,
    role,
  });
}

async function addProjectMember(
  projectId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member',
) {
  await db.insert(projectMemberships).values({
    id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    userId,
    role,
  });
}

// ---- setup / teardown ----

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  ownerId = await signUp(`resolver-owner-${ts}@test.com`, 'Owner');
  wsOwnerId = await signUp(`resolver-wsowner-${ts}@test.com`, 'WsOwner');
  wsManagerId = await signUp(`resolver-wsmgr-${ts}@test.com`, 'WsMgr');
  wsMemberId = await signUp(`resolver-wsmem-${ts}@test.com`, 'WsMem');
  outsiderId = await signUp(`resolver-outsider-${ts}@test.com`, 'Outsider');
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

// ---- tests ----

describe('resolveProjectWithOverride', () => {
  it('throws NOT_FOUND for a non-existent project slug', async () => {
    await expect(resolveProjectWithOverride('no-such-project', ownerId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns direct project member role with no workspace override flag', async () => {
    const ws = await createWs('Direct Member Ws', wsOwnerId);
    const proj = await createProj('Direct Member Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, ownerId);
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBeFalsy();
    expect(result.project.id).toBe(proj.id);
  });

  it('returns "manager" role for a direct project manager', async () => {
    const ws = await createWs('Direct Mgr Ws', wsOwnerId);
    const proj = await createProj('Direct Mgr Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsMemberId, 'manager');

    const result = await resolveProjectWithOverride(proj.slug, wsMemberId);
    expect(result.role).toBe('manager');
    expect(result.viaWorkspaceOverride).toBeFalsy();
  });

  it('returns "member" role for a direct project member', async () => {
    const ws = await createWs('Direct Mem Ws', wsOwnerId);
    const proj = await createProj('Direct Mem Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsMemberId, 'member');

    const result = await resolveProjectWithOverride(proj.slug, wsMemberId);
    expect(result.role).toBe('member');
    expect(result.viaWorkspaceOverride).toBeFalsy();
  });

  it('workspace owner without project membership gets synthetic owner role + override flag', async () => {
    const ws = await createWs('WsOwner Override Ws', wsOwnerId);
    // Project created by ownerId; wsOwner has no direct project membership.
    const proj = await createProj('WsOwner Override Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, wsOwnerId);
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBe(true);
  });

  it('workspace manager without project membership gets synthetic owner role + override flag', async () => {
    const ws = await createWs('WsMgr Override Ws', wsOwnerId);
    await addWorkspaceMember(ws.id, wsManagerId, 'manager');
    const proj = await createProj('WsMgr Override Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, wsManagerId);
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBe(true);
  });

  it('workspace member without project membership gets NOT_FOUND (no override)', async () => {
    const ws = await createWs('WsMem No Override Ws', wsOwnerId);
    await addWorkspaceMember(ws.id, wsMemberId, 'member');
    const proj = await createProj('WsMem No Override Proj', ws.id, ownerId);

    await expect(resolveProjectWithOverride(proj.slug, wsMemberId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('outsider (no workspace or project access) gets NOT_FOUND', async () => {
    const ws = await createWs('Outsider Ws', wsOwnerId);
    const proj = await createProj('Outsider Proj', ws.id, ownerId);

    await expect(resolveProjectWithOverride(proj.slug, outsiderId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('direct project membership takes precedence over workspace override', async () => {
    const ws = await createWs('Precedence Ws', wsOwnerId);
    // wsOwnerId is workspace owner AND we add them as a project *member* (lower role).
    // Direct membership should win, yielding role='member', not 'owner' from override.
    const proj = await createProj('Precedence Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsOwnerId, 'member');

    const result = await resolveProjectWithOverride(proj.slug, wsOwnerId);
    expect(result.role).toBe('member');
    expect(result.viaWorkspaceOverride).toBeFalsy();
  });

  it('applies requiredPermission and throws FORBIDDEN when denied', async () => {
    const ws = await createWs('Perm Ws', wsOwnerId);
    const proj = await createProj('Perm Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsMemberId, 'member');

    // project member cannot delete
    await expect(
      resolveProjectWithOverride(proj.slug, wsMemberId, 'project:delete'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('workspace admin override satisfies project:delete via synthetic owner role', async () => {
    const ws = await createWs('Perm Override Ws', wsOwnerId);
    const proj = await createProj('Perm Override Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, wsOwnerId, 'project:delete');
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBe(true);
  });
});
