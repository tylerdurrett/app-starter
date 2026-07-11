// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, workspaces, workspaceMemberships, projects, projectMemberships } from '@repo/db';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { createWorkspace } from '../src/workspaces/service.js';
import { createProject } from '../src/projects/service.js';
import {
  getAuthorizedProjectBySlug,
  resolveProjectWithOverride,
} from '../src/projects/resolver.js';

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

// ---- tests ----

describe('getAuthorizedProjectBySlug', () => {
  it('returns the canonical project projection for a direct project owner', async () => {
    const ws = await createWs('Canonical Direct Owner Ws', wsOwnerId);
    const proj = await createProj('Canonical Direct Owner Proj', ws.id, ownerId);

    const result = await getAuthorizedProjectBySlug(ws.slug, proj.slug, ownerId);

    expect(result).toEqual({
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      role: 'owner',
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'name',
        'slug',
        'workspaceId',
        'workspaceSlug',
        'workspaceName',
        'createdAt',
        'updatedAt',
        'role',
      ].sort(),
    );
  });

  it.each(['manager', 'member'] as const)(
    'returns a direct project %s role',
    async (role) => {
      const ws = await createWs(`Canonical Direct ${role} Ws`, wsOwnerId);
      const proj = await createProj(`Canonical Direct ${role} Proj`, ws.id, ownerId);
      await addProjectMember(proj.id, outsiderId, role);

      const result = await getAuthorizedProjectBySlug(ws.slug, proj.slug, outsiderId);

      expect(result.role).toBe(role);
      expect(result.id).toBe(proj.id);
    },
  );

  it.each([
    ['owner', 'owner'],
    ['manager', 'owner'],
    ['member', 'member'],
  ] as const)(
    'maps workspace %s access to project %s',
    async (workspaceRole, expectedProjectRole) => {
      const ws = await createWs(`Canonical Override ${workspaceRole} Ws`, wsOwnerId);
      const proj = await createProj(`Canonical Override ${workspaceRole} Proj`, ws.id, ownerId);
      const actorUserId = workspaceRole === 'owner' ? wsOwnerId : outsiderId;
      if (workspaceRole !== 'owner') {
        await addWorkspaceMember(ws.id, actorUserId, workspaceRole);
      }

      const result = await getAuthorizedProjectBySlug(ws.slug, proj.slug, actorUserId);

      expect(result.role).toBe(expectedProjectRole);
      expect(result.id).toBe(proj.id);
    },
  );

  it('prefers a weaker direct role over a stronger workspace override', async () => {
    const ws = await createWs('Canonical Precedence Ws', wsOwnerId);
    const proj = await createProj('Canonical Precedence Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsOwnerId, 'member');

    const result = await getAuthorizedProjectBySlug(ws.slug, proj.slug, wsOwnerId);

    expect(result.role).toBe('member');
  });

  it('authorizes direct project access without workspace membership', async () => {
    const ws = await createWs('Canonical Direct Only Ws', wsOwnerId);
    const proj = await createProj('Canonical Direct Only Proj', ws.id, ownerId);

    const result = await getAuthorizedProjectBySlug(ws.slug, proj.slug, ownerId);

    expect(result).toMatchObject({ id: proj.id, workspaceId: ws.id, role: 'owner' });
  });

  it('resolves duplicate project slugs by workspace', async () => {
    const wsA = await createWs('Canonical Duplicate Ws A', wsOwnerId);
    const wsB = await createWs('Canonical Duplicate Ws B', wsOwnerId);
    const projA = await createProj('Canonical Shared Proj', wsA.id, ownerId);
    const projB = await createProj('Canonical Shared Proj', wsB.id, ownerId);
    expect(projA.slug).toBe(projB.slug);

    const resultA = await getAuthorizedProjectBySlug(wsA.slug, projA.slug, ownerId);
    const resultB = await getAuthorizedProjectBySlug(wsB.slug, projB.slug, ownerId);

    expect(resultA.id).toBe(projA.id);
    expect(resultB.id).toBe(projB.id);
  });

  it('returns NOT_FOUND when the project belongs to a different workspace', async () => {
    const wsA = await createWs('Canonical Wrong Workspace A', wsOwnerId);
    const wsB = await createWs('Canonical Wrong Workspace B', wsOwnerId);
    const proj = await createProj('Canonical Wrong Workspace Proj', wsA.id, ownerId);

    await expect(
      getAuthorizedProjectBySlug(wsB.slug, proj.slug, ownerId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns NOT_FOUND for a missing workspace or project', async () => {
    const ws = await createWs('Canonical Missing Ws', wsOwnerId);

    await expect(
      getAuthorizedProjectBySlug(ws.slug, 'missing-project', ownerId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      getAuthorizedProjectBySlug('missing-workspace', 'missing-project', ownerId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns NOT_FOUND when the actor has no project or workspace access', async () => {
    const ws = await createWs('Canonical Inaccessible Ws', wsOwnerId);
    const proj = await createProj('Canonical Inaccessible Proj', ws.id, ownerId);

    await expect(
      getAuthorizedProjectBySlug(ws.slug, proj.slug, outsiderId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('resolveProjectWithOverride', () => {
  it('throws NOT_FOUND for a non-existent project slug', async () => {
    const ws = await createWs('Nonexistent Slug Ws', wsOwnerId);
    await expect(
      resolveProjectWithOverride('no-such-project', ownerId, undefined, ws.slug),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns direct project member role with no workspace override flag', async () => {
    const ws = await createWs('Direct Member Ws', wsOwnerId);
    const proj = await createProj('Direct Member Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, ownerId, undefined, ws.slug);
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBeFalsy();
    expect(result.project.id).toBe(proj.id);
  });

  it('returns "manager" role for a direct project manager', async () => {
    const ws = await createWs('Direct Mgr Ws', wsOwnerId);
    const proj = await createProj('Direct Mgr Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsMemberId, 'manager');

    const result = await resolveProjectWithOverride(proj.slug, wsMemberId, undefined, ws.slug);
    expect(result.role).toBe('manager');
    expect(result.viaWorkspaceOverride).toBeFalsy();
  });

  it('returns "member" role for a direct project member', async () => {
    const ws = await createWs('Direct Mem Ws', wsOwnerId);
    const proj = await createProj('Direct Mem Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsMemberId, 'member');

    const result = await resolveProjectWithOverride(proj.slug, wsMemberId, undefined, ws.slug);
    expect(result.role).toBe('member');
    expect(result.viaWorkspaceOverride).toBeFalsy();
  });

  it('workspace owner without project membership gets synthetic owner role + override flag', async () => {
    const ws = await createWs('WsOwner Override Ws', wsOwnerId);
    // Project created by ownerId; wsOwner has no direct project membership.
    const proj = await createProj('WsOwner Override Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, wsOwnerId, undefined, ws.slug);
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBe(true);
  });

  it('workspace manager without project membership gets synthetic owner role + override flag', async () => {
    const ws = await createWs('WsMgr Override Ws', wsOwnerId);
    await addWorkspaceMember(ws.id, wsManagerId, 'manager');
    const proj = await createProj('WsMgr Override Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, wsManagerId, undefined, ws.slug);
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBe(true);
  });

  it('workspace member without project membership gets synthetic member read access', async () => {
    const ws = await createWs('WsMem Read Access Ws', wsOwnerId);
    await addWorkspaceMember(ws.id, wsMemberId, 'member');
    const proj = await createProj('WsMem Read Access Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, wsMemberId, 'project:read', ws.slug);

    expect(result.role).toBe('member');
    expect(result.viaWorkspaceOverride).toBe(true);
  });

  it('workspace member without project membership cannot edit the project', async () => {
    const ws = await createWs('WsMem Edit Access Ws', wsOwnerId);
    await addWorkspaceMember(ws.id, wsMemberId, 'member');
    const proj = await createProj('WsMem Edit Access Proj', ws.id, ownerId);

    await expect(
      resolveProjectWithOverride(proj.slug, wsMemberId, 'project:edit', ws.slug),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('outsider (no workspace or project access) gets NOT_FOUND', async () => {
    const ws = await createWs('Outsider Ws', wsOwnerId);
    const proj = await createProj('Outsider Proj', ws.id, ownerId);

    await expect(
      resolveProjectWithOverride(proj.slug, outsiderId, undefined, ws.slug),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('direct project membership takes precedence over workspace override', async () => {
    const ws = await createWs('Precedence Ws', wsOwnerId);
    // wsOwnerId is workspace owner AND we add them as a project *member* (lower role).
    // Direct membership should win, yielding role='member', not 'owner' from override.
    const proj = await createProj('Precedence Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsOwnerId, 'member');

    const result = await resolveProjectWithOverride(proj.slug, wsOwnerId, undefined, ws.slug);
    expect(result.role).toBe('member');
    expect(result.viaWorkspaceOverride).toBeFalsy();
  });

  it('applies requiredPermission and throws FORBIDDEN when denied', async () => {
    const ws = await createWs('Perm Ws', wsOwnerId);
    const proj = await createProj('Perm Proj', ws.id, ownerId);
    await addProjectMember(proj.id, wsMemberId, 'member');

    // project member cannot delete
    await expect(
      resolveProjectWithOverride(proj.slug, wsMemberId, 'project:delete', ws.slug),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('workspace admin override satisfies project:delete via synthetic owner role', async () => {
    const ws = await createWs('Perm Override Ws', wsOwnerId);
    const proj = await createProj('Perm Override Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, wsOwnerId, 'project:delete', ws.slug);
    expect(result.role).toBe('owner');
    expect(result.viaWorkspaceOverride).toBe(true);
  });
});

describe('resolveProjectWithOverride by (workspace, slug)', () => {
  it('resolves each duplicate-slug project under its own workspace', async () => {
    const wsA = await createWs('Composite Ws A', wsOwnerId);
    const wsB = await createWs('Composite Ws B', wsOwnerId);
    // Same name in both workspaces -> identical bare slug (slug is workspace-scoped).
    const projA = await createProj('Shared Slug Proj', wsA.id, ownerId);
    const projB = await createProj('Shared Slug Proj', wsB.id, ownerId);
    expect(projA.slug).toBe(projB.slug);

    const resultA = await resolveProjectWithOverride(projA.slug, ownerId, undefined, wsA.slug);
    const resultB = await resolveProjectWithOverride(projB.slug, ownerId, undefined, wsB.slug);

    expect(resultA.project.id).toBe(projA.id);
    expect(resultB.project.id).toBe(projB.id);
  });

  it('resolves via composite key without requiring workspace membership (non-authorizing join)', async () => {
    // ownerId has DIRECT project membership but is NOT a member of the workspace
    // (wsOwnerId owns it). The composite lookup must still find the project.
    const ws = await createWs('Composite NonMember Ws', wsOwnerId);
    const proj = await createProj('Composite NonMember Proj', ws.id, ownerId);

    const result = await resolveProjectWithOverride(proj.slug, ownerId, undefined, ws.slug);
    expect(result.project.id).toBe(proj.id);
    expect(result.role).toBe('owner');
  });

  it('returns NOT_FOUND when the slug exists only in a different workspace', async () => {
    const wsA = await createWs('Wrong Ws Source', wsOwnerId);
    const wsB = await createWs('Wrong Ws Target', wsOwnerId);
    const proj = await createProj('Only In A Proj', wsA.id, ownerId);

    // Looked up under wsB (where no such slug exists) -> NOT_FOUND, never FORBIDDEN.
    await expect(
      resolveProjectWithOverride(proj.slug, ownerId, undefined, wsB.slug),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns NOT_FOUND for an unknown workspace slug', async () => {
    const ws = await createWs('Composite Unknown Ws', wsOwnerId);
    const proj = await createProj('Composite Unknown Proj', ws.id, ownerId);

    await expect(
      resolveProjectWithOverride(proj.slug, ownerId, undefined, 'no-such-workspace'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('preserves NOT_FOUND (not FORBIDDEN) access denial under the composite lookup', async () => {
    // outsider has neither project nor workspace access; composite lookup finds
    // the row but access denial must still surface as NOT_FOUND.
    const ws = await createWs('Composite Denial Ws', wsOwnerId);
    const proj = await createProj('Composite Denial Proj', ws.id, ownerId);

    await expect(
      resolveProjectWithOverride(proj.slug, outsiderId, undefined, ws.slug),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
