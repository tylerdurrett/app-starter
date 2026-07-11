// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, workspaces, workspaceMemberships, projects, projectMemberships } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { createWorkspace } from '../src/workspaces/service.js';
import { createProject } from '../src/projects/service.js';
import {
  findAuthorizedProjectById,
  getAuthorizedProjectBySlug,
  listAuthorizedProjectsForUser,
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

async function signUpWithoutPersonalWorkspace(label: string): Promise<string> {
  const userId = await signUp(
    `resolver-isolated-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
    `Isolated ${label}`,
  );
  await db.delete(workspaces).where(eq(workspaces.createdByUserId, userId));
  return userId;
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

function projectIdsInCreatedOrder(
  ...projectRows: Array<{ id: string; createdAt: Date }>
): string[] {
  return projectRows
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((project) => project.id);
}

const authorizedProjectKeys = [
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

describe('findAuthorizedProjectById', () => {
  it('returns the exact canonical projection for a direct owner', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('find-direct-owner');
    const ws = await createWs('Canonical Find Direct Owner Ws', wsOwnerId);
    const proj = await createProj('Canonical Find Direct Owner Proj', ws.id, actorId);

    const result = await findAuthorizedProjectById(proj.id, actorId);

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
    expect(Object.keys(result!).sort()).toEqual(authorizedProjectKeys);
  });

  it.each(['manager', 'member'] as const)('returns a direct %s role', async (role) => {
    const actorId = await signUpWithoutPersonalWorkspace(`find-direct-${role}`);
    const ws = await createWs(`Canonical Find Direct ${role} Ws`, wsOwnerId);
    const proj = await createProj(`Canonical Find Direct ${role} Proj`, ws.id, ownerId);
    await addProjectMember(proj.id, actorId, role);

    const result = await findAuthorizedProjectById(proj.id, actorId);

    expect(result).toMatchObject({ id: proj.id, role });
  });

  it.each([
    ['owner', 'owner'],
    ['manager', 'owner'],
    ['member', 'member'],
  ] as const)(
    'maps workspace %s access to project %s',
    async (workspaceRole, expectedProjectRole) => {
      const actorId = await signUpWithoutPersonalWorkspace(`find-workspace-${workspaceRole}`);
      const ws = await createWs(
        `Canonical Find Workspace ${workspaceRole} Ws`,
        workspaceRole === 'owner' ? actorId : wsOwnerId,
      );
      if (workspaceRole !== 'owner') {
        await addWorkspaceMember(ws.id, actorId, workspaceRole);
      }
      const proj = await createProj(
        `Canonical Find Workspace ${workspaceRole} Proj`,
        ws.id,
        ownerId,
      );

      const result = await findAuthorizedProjectById(proj.id, actorId);

      expect(result).toMatchObject({
        id: proj.id,
        workspaceId: ws.id,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        role: expectedProjectRole,
      });
      expect(Object.keys(result!).sort()).toEqual(authorizedProjectKeys);
    },
  );

  it('prefers a weaker direct role over workspace-owner access', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('find-precedence');
    const ws = await createWs('Canonical Find Precedence Ws', actorId);
    const proj = await createProj('Canonical Find Precedence Proj', ws.id, ownerId);
    await addProjectMember(proj.id, actorId, 'member');

    await expect(findAuthorizedProjectById(proj.id, actorId)).resolves.toMatchObject({
      id: proj.id,
      role: 'member',
    });
  });

  it('falls back to workspace access after direct access is removed, then returns null', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('find-access-loss');
    const ws = await createWs('Canonical Find Access Loss Ws', wsOwnerId);
    const proj = await createProj('Canonical Find Access Loss Proj', ws.id, ownerId);
    await addWorkspaceMember(ws.id, actorId, 'manager');
    await addProjectMember(proj.id, actorId, 'member');

    await db
      .delete(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, proj.id),
          eq(projectMemberships.userId, actorId),
        ),
      );
    await expect(findAuthorizedProjectById(proj.id, actorId)).resolves.toMatchObject({
      role: 'owner',
    });

    await db
      .delete(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, ws.id),
          eq(workspaceMemberships.userId, actorId),
        ),
      );
    await expect(findAuthorizedProjectById(proj.id, actorId)).resolves.toBeNull();
  });

  it('returns null without throwing for missing and inaccessible projects', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('find-null');
    const ws = await createWs('Canonical Find Inaccessible Ws', wsOwnerId);
    const proj = await createProj('Canonical Find Inaccessible Proj', ws.id, ownerId);

    await expect(findAuthorizedProjectById('missing-project-id', actorId)).resolves.toBeNull();
    await expect(findAuthorizedProjectById(proj.id, actorId)).resolves.toBeNull();
  });
});

describe('listAuthorizedProjectsForUser', () => {
  it('returns the exact flat projection in global project-created order', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('exact-order');
    const wsA = await createWs('Canonical List Exact Ws A', wsOwnerId);
    const wsB = await createWs('Canonical List Exact Ws B', wsOwnerId);
    const projA = await createProj('Canonical List Exact Proj A', wsA.id, ownerId);
    const projB = await createProj('Canonical List Exact Proj B', wsB.id, ownerId);
    await addProjectMember(projA.id, actorId, 'manager');
    await addProjectMember(projB.id, actorId, 'member');
    const createdA = new Date('2026-01-01T00:00:00.000Z');
    const createdB = new Date('2026-01-02T00:00:00.000Z');
    await db.update(projects).set({ createdAt: createdA }).where(eq(projects.id, projA.id));
    await db.update(projects).set({ createdAt: createdB }).where(eq(projects.id, projB.id));

    const result = await listAuthorizedProjectsForUser(actorId);

    expect(result.map((project) => project.id)).toEqual([projA.id, projB.id]);
    expect(result[0]).toEqual({
      id: projA.id,
      name: projA.name,
      slug: projA.slug,
      workspaceId: wsA.id,
      workspaceSlug: wsA.slug,
      workspaceName: wsA.name,
      createdAt: createdA,
      updatedAt: projA.updatedAt,
      role: 'manager',
    });
    for (const project of result) {
      expect(Object.keys(project).sort()).toEqual(authorizedProjectKeys);
    }
  });

  it.each([
    ['owner', 'owner'],
    ['manager', 'owner'],
    ['member', 'member'],
  ] as const)(
    'returns every project inherited by a workspace %s, user-wide and filtered',
    async (workspaceRole, expectedProjectRole) => {
      const actorId = await signUpWithoutPersonalWorkspace(`workspace-${workspaceRole}`);
      const ws = await createWs(
        `Canonical List Workspace ${workspaceRole}`,
        workspaceRole === 'owner' ? actorId : wsOwnerId,
      );
      if (workspaceRole !== 'owner') {
        await addWorkspaceMember(ws.id, actorId, workspaceRole);
      }
      const projA = await createProj(`Canonical List ${workspaceRole} Proj A`, ws.id, ownerId);
      const projB = await createProj(`Canonical List ${workspaceRole} Proj B`, ws.id, ownerId);

      const userWide = await listAuthorizedProjectsForUser(actorId);
      const filtered = await listAuthorizedProjectsForUser(actorId, { workspaceSlug: ws.slug });

      const expectedIds = projectIdsInCreatedOrder(projA, projB);
      expect(userWide.map((project) => project.id)).toEqual(expectedIds);
      expect(filtered.map((project) => project.id)).toEqual(expectedIds);
      expect(userWide.every((project) => project.role === expectedProjectRole)).toBe(true);
      expect(filtered.every((project) => project.role === expectedProjectRole)).toBe(true);
      for (const project of userWide) {
        expect(Object.keys(project).sort()).toEqual(authorizedProjectKeys);
      }
    },
  );

  it('filters direct-only access without requiring workspace membership or leaking siblings', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('direct-filter');
    const wsA = await createWs('Canonical List Direct Filter Ws A', wsOwnerId);
    const wsB = await createWs('Canonical List Direct Filter Ws B', wsOwnerId);
    const projA = await createProj('Canonical List Direct Filter Proj A', wsA.id, ownerId);
    const siblingA = await createProj('Canonical List Direct Filter Sibling A', wsA.id, ownerId);
    const projB = await createProj('Canonical List Direct Filter Proj B', wsB.id, ownerId);
    await addProjectMember(projA.id, actorId, 'member');
    await addProjectMember(projB.id, actorId, 'manager');

    const result = await listAuthorizedProjectsForUser(actorId, { workspaceSlug: wsA.slug });

    expect(result.map((project) => project.id)).toEqual([projA.id]);
    expect(result.map((project) => project.id)).not.toContain(siblingA.id);
    expect(result.map((project) => project.id)).not.toContain(projB.id);
  });

  it('deduplicates projects and gives a weaker direct membership precedence', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('precedence');
    const ws = await createWs('Canonical List Precedence Ws', actorId);
    const proj = await createProj('Canonical List Precedence Proj', ws.id, ownerId);
    await addProjectMember(proj.id, actorId, 'member');

    const result = await listAuthorizedProjectsForUser(actorId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: proj.id, role: 'member' });
  });

  it('combines access across workspaces while omitting inaccessible projects', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('mixed');
    const directWs = await createWs('Canonical List Mixed Direct Ws', wsOwnerId);
    const inheritedWs = await createWs('Canonical List Mixed Inherited Ws', wsOwnerId);
    const inaccessibleWs = await createWs('Canonical List Mixed Inaccessible Ws', wsOwnerId);
    const directProj = await createProj('Canonical List Mixed Direct Proj', directWs.id, ownerId);
    const inheritedA = await createProj(
      'Canonical List Mixed Inherited A',
      inheritedWs.id,
      ownerId,
    );
    const inheritedB = await createProj(
      'Canonical List Mixed Inherited B',
      inheritedWs.id,
      ownerId,
    );
    const inaccessibleProj = await createProj(
      'Canonical List Mixed Inaccessible Proj',
      inaccessibleWs.id,
      ownerId,
    );
    await addProjectMember(directProj.id, actorId, 'manager');
    await addWorkspaceMember(inheritedWs.id, actorId, 'member');

    const result = await listAuthorizedProjectsForUser(actorId);

    expect(result.map((project) => project.id)).toEqual(
      projectIdsInCreatedOrder(directProj, inheritedA, inheritedB),
    );
    expect(result.map((project) => project.id)).not.toContain(inaccessibleProj.id);
  });

  it('returns an empty list for unknown and wholly inaccessible workspace filters', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('empty-filters');
    const ws = await createWs('Canonical List Empty Filter Ws', wsOwnerId);
    await createProj('Canonical List Empty Filter Proj', ws.id, ownerId);

    await expect(
      listAuthorizedProjectsForUser(actorId, { workspaceSlug: 'unknown-workspace' }),
    ).resolves.toEqual([]);
    await expect(
      listAuthorizedProjectsForUser(actorId, { workspaceSlug: ws.slug }),
    ).resolves.toEqual([]);
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
