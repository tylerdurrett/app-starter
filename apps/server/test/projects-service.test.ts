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
  projectInvites,
  users,
} from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { createWorkspace } from '../src/workspaces/service.js';
import {
  createProject,
  listAccessibleProjectsForUser,
  listProjectsForUser,
  getProjectBySlug,
  updateProject,
  deleteProject,
  listMembers,
  removeMember,
  setLastActiveProject,
  getLastActiveProject,
} from '../src/projects/service.js';

import {
  createInvite,
  listInvites,
  revokeInvite,
  getInviteByToken,
  acceptInvite,
} from '../src/projects/invites.js';

import { requireProjectPermission } from '../src/auth/require-permission.js';
import type { FastifyRequest } from 'fastify';

// ---- helpers ----

let app: FastifyInstance;
let aliceId: string;
let bobId: string;
let bobEmail: string;
let workspaceId: string;
let _workspaceSlug: string;
const createdProjectIds: string[] = [];
const createdWorkspaceIds: string[] = [];

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

async function createAndTrackWorkspace(name: string, ownerUserId: string) {
  const ws = await createWorkspace({ name, ownerUserId });
  createdWorkspaceIds.push(ws.id);
  return ws;
}

async function createAndTrack(name: string, ownerUserId: string, opts?: { wsId?: string }) {
  const proj = await createProject({
    name,
    workspaceId: opts?.wsId ?? workspaceId,
    ownerUserId,
  });
  if (proj) createdProjectIds.push(proj.id);
  return proj!;
}

async function addProjectMember(
  projectId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member' = 'member',
) {
  await db.insert(projectMemberships).values({
    id: `pmem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    userId,
    role,
  });
}

async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member' = 'member',
) {
  await db.insert(workspaceMemberships).values({
    id: `wmem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    userId,
    role,
  });
}

// ---- setup / teardown ----

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  aliceId = await signUp(`alice-psvc-${ts}@test.com`, 'Alice');
  bobId = await signUp(`bob-psvc-${ts}@test.com`, 'Bob');
  bobEmail = `bob-psvc-${ts}@test.com`;

  // Projects live under a workspace; create one shared parent workspace for this file.
  const parent = await createAndTrackWorkspace('Projects Test Parent', aliceId);
  workspaceId = parent.id;
  _workspaceSlug = parent.slug;
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

describe('createProject', () => {
  it('creates a project with correct slug, workspaceId, and owner membership', async () => {
    const proj = await createAndTrack('Marketing Site', aliceId);

    expect(proj.name).toBe('Marketing Site');
    expect(proj.slug).toMatch(/^marketing-site/);
    expect(proj.workspaceId).toBe(workspaceId);

    const [membership] = await db
      .select()
      .from(projectMemberships)
      .where(eq(projectMemberships.projectId, proj.id));

    expect(membership.userId).toBe(aliceId);
    expect(membership.role).toBe('owner');
  });

  it('creates a unique slug when duplicate name exists', async () => {
    const p1 = await createAndTrack('Duplicate Proj', aliceId);
    const p2 = await createAndTrack('Duplicate Proj', aliceId);

    expect(p1.slug).toBe('duplicate-proj');
    expect(p2.slug).toBe('duplicate-proj-2');
  });

  it('handles special-character names with a fallback slug', async () => {
    const proj = await createAndTrack('!@#$%', aliceId);
    expect(proj.slug).toMatch(/^project-/);
  });
});

describe('listProjectsForUser', () => {
  it('includes workspace-visible projects with the existing response shape', async () => {
    const workspace = await createAndTrackWorkspace('User Project List Workspace', aliceId);
    await addWorkspaceMember(workspace.id, bobId, 'member');
    const project = await createAndTrack('Workspace Visible User Project', aliceId, {
      wsId: workspace.id,
    });

    const bobList = await listProjectsForUser(bobId);
    const listedProject = bobList.find(({ id }) => id === project.id);

    expect(listedProject).toEqual({
      id: project.id,
      name: project.name,
      slug: project.slug,
      workspaceId: workspace.id,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      role: 'member',
    });
  });

  it('orders workspace-visible projects by project creation time', async () => {
    const firstWorkspace = await createAndTrackWorkspace('First Ordered Workspace', aliceId);
    const secondWorkspace = await createAndTrackWorkspace('Second Ordered Workspace', aliceId);
    await addWorkspaceMember(firstWorkspace.id, bobId, 'member');
    await addWorkspaceMember(secondWorkspace.id, bobId, 'member');

    const olderProject = await createAndTrack('Older Ordered Project', aliceId, {
      wsId: secondWorkspace.id,
    });
    const newerProject = await createAndTrack('Newer Ordered Project', aliceId, {
      wsId: firstWorkspace.id,
    });
    await db
      .update(projects)
      .set({ createdAt: new Date('2000-01-01T00:00:00.000Z') })
      .where(eq(projects.id, olderProject.id));
    await db
      .update(projects)
      .set({ createdAt: new Date('2001-01-01T00:00:00.000Z') })
      .where(eq(projects.id, newerProject.id));

    const bobList = await listProjectsForUser(bobId);

    expect(bobList.slice(0, 2).map(({ id }) => id)).toEqual([olderProject.id, newerProject.id]);
  });
});

describe('listAccessibleProjectsForUser', () => {
  it('returns direct project memberships with workspace context', async () => {
    const workspace = await createAndTrackWorkspace('Direct Access Workspace', aliceId);
    const project = await createAndTrack('Direct Access Project', aliceId, {
      wsId: workspace.id,
    });
    await addProjectMember(project.id, bobId, 'member');

    const result = await listAccessibleProjectsForUser(bobId);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: project.id,
          role: 'member',
          access: 'project_membership',
          workspace: expect.objectContaining({
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
          }),
        }),
      ]),
    );
  });

  it.each([
    ['owner', 'owner', 'workspace_admin'],
    ['manager', 'owner', 'workspace_admin'],
    ['member', 'member', 'workspace_member'],
  ] as const)(
    'includes projects visible to a workspace %s with role %s and access %s',
    async (workspaceRole, projectRole, access) => {
      const workspace = await createAndTrackWorkspace(
        `Workspace ${workspaceRole} List`,
        workspaceRole === 'owner' ? bobId : aliceId,
      );
      if (workspaceRole !== 'owner') {
        await addWorkspaceMember(workspace.id, bobId, workspaceRole);
      }
      const project = await createAndTrack(`${workspaceRole} Visible Project`, aliceId, {
        wsId: workspace.id,
      });

      const result = await listAccessibleProjectsForUser(bobId, {
        workspaceSlug: workspace.slug,
      });

      expect(result).toEqual([
        expect.objectContaining({
          id: project.id,
          role: projectRole,
          access,
          workspace: expect.objectContaining({ slug: workspace.slug }),
        }),
      ]);
    },
  );

  it('keeps direct project role when workspace admin access also applies', async () => {
    const workspace = await createAndTrackWorkspace('Direct Role Wins Workspace', aliceId);
    await addWorkspaceMember(workspace.id, bobId, 'manager');
    const project = await createAndTrack('Direct Role Wins Project', aliceId, {
      wsId: workspace.id,
    });
    await addProjectMember(project.id, bobId, 'member');

    const result = await listAccessibleProjectsForUser(bobId, { workspaceSlug: workspace.slug });

    expect(result).toEqual([
      expect.objectContaining({
        id: project.id,
        role: 'member',
        access: 'project_membership',
      }),
    ]);
  });

  it('filters direct project access by workspace slug even without workspace membership', async () => {
    const workspace = await createAndTrackWorkspace('Project Scoped Filter Workspace', aliceId);
    const project = await createAndTrack('Project Scoped Filter Project', aliceId, {
      wsId: workspace.id,
    });
    await addProjectMember(project.id, bobId, 'member');

    const matching = await listAccessibleProjectsForUser(bobId, { workspaceSlug: workspace.slug });
    const missing = await listAccessibleProjectsForUser(bobId, {
      workspaceSlug: 'no-such-workspace',
    });

    expect(matching.map((p) => p.id)).toContain(project.id);
    expect(missing).toEqual([]);
  });
});

describe('getProjectBySlug', () => {
  it('returns project and role for a direct member', async () => {
    const proj = await createAndTrack('Get Proj', aliceId);
    const result = await getProjectBySlug(proj.slug, aliceId);

    expect(result.project.id).toBe(proj.id);
    expect(result.role).toBe('owner');
  });

  it('throws NOT_FOUND for non-existent slug', async () => {
    await expect(getProjectBySlug('no-such-proj', aliceId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND for user with neither project nor workspace access', async () => {
    const proj = await createAndTrack('No Bob Proj', aliceId);
    await expect(getProjectBySlug(proj.slug, bobId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('updateProject', () => {
  it('owner can update name', async () => {
    const proj = await createAndTrack('Before Update', aliceId);
    const updated = await updateProject(proj.slug, aliceId, { name: 'After Update' });

    expect(updated.name).toBe('After Update');
    expect(updated.slug).toBe(proj.slug); // slug does not change
  });

  it('member cannot update (FORBIDDEN)', async () => {
    const proj = await createAndTrack('Member Update Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    await expect(updateProject(proj.slug, bobId, { name: 'Nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('manager can update (intermediate access)', async () => {
    const proj = await createAndTrack('Manager Update Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'manager');

    const updated = await updateProject(proj.slug, bobId, { name: 'Manager Updated' });
    expect(updated.name).toBe('Manager Updated');
  });
});

describe('deleteProject', () => {
  it('owner can delete with correct confirmation', async () => {
    const proj = await createAndTrack('Delete Me Proj', aliceId);
    await deleteProject(proj.slug, aliceId, { confirmation: `Delete ${proj.name}` });

    const [gone] = await db.select().from(projects).where(eq(projects.id, proj.id));
    expect(gone).toBeUndefined();
  });

  it('rejects incorrect confirmation', async () => {
    const proj = await createAndTrack('Keep Me Proj', aliceId);
    await expect(
      deleteProject(proj.slug, aliceId, { confirmation: 'wrong' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('manager cannot delete (FORBIDDEN)', async () => {
    const proj = await createAndTrack('Manager Delete Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'manager');

    await expect(
      deleteProject(proj.slug, bobId, { confirmation: `Delete ${proj.name}` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cascade deletes memberships and invites', async () => {
    const proj = await createAndTrack('Cascade Proj', aliceId);
    await createInvite(proj.slug, aliceId, { email: 'cascade-proj@test.com' });

    await deleteProject(proj.slug, aliceId, { confirmation: `Delete ${proj.name}` });

    const memberships = await db
      .select()
      .from(projectMemberships)
      .where(eq(projectMemberships.projectId, proj.id));
    const invites = await db
      .select()
      .from(projectInvites)
      .where(eq(projectInvites.projectId, proj.id));

    expect(memberships).toHaveLength(0);
    expect(invites).toHaveLength(0);
  });
});

describe('listMembers', () => {
  it('owner can list members', async () => {
    const proj = await createAndTrack('Members List Proj', aliceId);
    const members = await listMembers(proj.slug, aliceId);

    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(aliceId);
    expect(members[0].role).toBe('owner');
  });

  it('member can list members', async () => {
    const proj = await createAndTrack('Members List Mem Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    const members = await listMembers(proj.slug, bobId);
    expect(members).toHaveLength(2);
  });

  it('non-member with no workspace override gets NOT_FOUND', async () => {
    // Create a workspace that bob is NOT in, and a project inside it
    const outsideWs = await createAndTrackWorkspace('Outside Ws', aliceId);
    const proj = await createAndTrack('Outside Proj', aliceId, { wsId: outsideWs.id });

    await expect(listMembers(proj.slug, bobId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('removeMember', () => {
  it('owner can remove a member', async () => {
    const proj = await createAndTrack('Remove Test Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    await removeMember(proj.slug, aliceId, bobId);

    const members = await listMembers(proj.slug, aliceId);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(aliceId);
  });

  it('cannot self-remove (CONFLICT)', async () => {
    const proj = await createAndTrack('Self Remove Proj', aliceId);
    await expect(removeMember(proj.slug, aliceId, aliceId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('member cannot remove others (FORBIDDEN)', async () => {
    const proj = await createAndTrack('Member Remove Forbid Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    await expect(removeMember(proj.slug, bobId, aliceId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('removing non-existent member throws NOT_FOUND', async () => {
    const proj = await createAndTrack('Remove Ghost Proj', aliceId);
    await expect(removeMember(proj.slug, aliceId, 'no-such-user')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('workspace-scoped slug threading through service wrappers', () => {
  it('getProjectBySlug resolves each duplicate-slug project under its own workspace', async () => {
    const wsA = await createAndTrackWorkspace('Svc Composite Ws A', aliceId);
    const wsB = await createAndTrackWorkspace('Svc Composite Ws B', aliceId);
    const projA = await createAndTrack('Svc Shared Slug', aliceId, { wsId: wsA.id });
    const projB = await createAndTrack('Svc Shared Slug', aliceId, { wsId: wsB.id });
    expect(projA.slug).toBe(projB.slug);

    const resA = await getProjectBySlug(projA.slug, aliceId, wsA.slug);
    const resB = await getProjectBySlug(projB.slug, aliceId, wsB.slug);

    expect(resA.project.id).toBe(projA.id);
    expect(resB.project.id).toBe(projB.id);
  });

  it('getProjectBySlug returns NOT_FOUND when the slug lives only in another workspace', async () => {
    const wsA = await createAndTrackWorkspace('Svc Wrong Ws A', aliceId);
    const wsB = await createAndTrackWorkspace('Svc Wrong Ws B', aliceId);
    const proj = await createAndTrack('Svc Only In A', aliceId, { wsId: wsA.id });

    await expect(getProjectBySlug(proj.slug, aliceId, wsB.slug)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('updateProject targets the project in the given workspace', async () => {
    const wsA = await createAndTrackWorkspace('Svc Update Ws A', aliceId);
    const wsB = await createAndTrackWorkspace('Svc Update Ws B', aliceId);
    const projA = await createAndTrack('Svc Update Shared', aliceId, { wsId: wsA.id });
    const projB = await createAndTrack('Svc Update Shared', aliceId, { wsId: wsB.id });

    const updated = await updateProject(projB.slug, aliceId, { name: 'Renamed In B' }, wsB.slug);
    expect(updated.id).toBe(projB.id);
    expect(updated.name).toBe('Renamed In B');

    const [aStill] = await db.select().from(projects).where(eq(projects.id, projA.id));
    expect(aStill.name).toBe('Svc Update Shared');
  });

  it('deleteProject deletes the project in the given workspace only', async () => {
    const wsA = await createAndTrackWorkspace('Svc Delete Ws A', aliceId);
    const wsB = await createAndTrackWorkspace('Svc Delete Ws B', aliceId);
    const projA = await createAndTrack('Svc Delete Shared', aliceId, { wsId: wsA.id });
    const projB = await createAndTrack('Svc Delete Shared', aliceId, { wsId: wsB.id });

    await deleteProject(projB.slug, aliceId, { confirmation: `Delete ${projB.name}` }, wsB.slug);

    const [bGone] = await db.select().from(projects).where(eq(projects.id, projB.id));
    const [aStill] = await db.select().from(projects).where(eq(projects.id, projA.id));
    expect(bGone).toBeUndefined();
    expect(aStill.id).toBe(projA.id);
  });

  it('listMembers resolves the project in the given workspace', async () => {
    const wsA = await createAndTrackWorkspace('Svc Members Ws A', aliceId);
    const wsB = await createAndTrackWorkspace('Svc Members Ws B', aliceId);
    const projA = await createAndTrack('Svc Members Shared', aliceId, { wsId: wsA.id });
    const projB = await createAndTrack('Svc Members Shared', aliceId, { wsId: wsB.id });
    await addProjectMember(projB.id, bobId, 'member');

    const membersB = await listMembers(projB.slug, aliceId, wsB.slug);
    const membersA = await listMembers(projA.slug, aliceId, wsA.slug);

    expect(membersB.map((m) => m.userId).sort()).toEqual([aliceId, bobId].sort());
    expect(membersA.map((m) => m.userId)).toEqual([aliceId]);
  });

  it('removeMember resolves the project in the given workspace', async () => {
    const wsA = await createAndTrackWorkspace('Svc Remove Ws A', aliceId);
    const wsB = await createAndTrackWorkspace('Svc Remove Ws B', aliceId);
    const projA = await createAndTrack('Svc Remove Shared', aliceId, { wsId: wsA.id });
    const projB = await createAndTrack('Svc Remove Shared', aliceId, { wsId: wsB.id });
    await addProjectMember(projA.id, bobId, 'member');
    await addProjectMember(projB.id, bobId, 'member');

    await removeMember(projB.slug, aliceId, bobId, wsB.slug);

    const membersB = await listMembers(projB.slug, aliceId, wsB.slug);
    const membersA = await listMembers(projA.slug, aliceId, wsA.slug);
    expect(membersB.map((m) => m.userId)).toEqual([aliceId]);
    expect(membersA.map((m) => m.userId).sort()).toEqual([aliceId, bobId].sort());
  });
});

describe('last active project', () => {
  it('setLastActiveProject updates the user row', async () => {
    const proj = await createAndTrack('Last Active Set', aliceId);
    await setLastActiveProject(aliceId, proj.id);

    const [user] = await db
      .select({ lastActiveProjectId: users.lastActiveProjectId })
      .from(users)
      .where(eq(users.id, aliceId));

    expect(user.lastActiveProjectId).toBe(proj.id);
  });

  it('getLastActiveProject returns the project when set and user has access', async () => {
    const proj = await createAndTrack('Last Active Get', aliceId);
    await setLastActiveProject(aliceId, proj.id);

    const result = await getLastActiveProject(aliceId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(proj.id);
  });

  it('returns null after the referenced project is deleted (FK SET NULL)', async () => {
    const proj = await createAndTrack('Last Active Delete', aliceId);
    await setLastActiveProject(aliceId, proj.id);

    await deleteProject(proj.slug, aliceId, { confirmation: `Delete ${proj.name}` });
    const result = await getLastActiveProject(aliceId);
    expect(result).toBeNull();
  });
});

describe('invites', () => {
  describe('createInvite', () => {
    it('owner can create invite with default member role', async () => {
      const proj = await createAndTrack('Invite Create Proj', aliceId);
      const { invite, token } = await createInvite(proj.slug, aliceId, {
        email: 'invitee-p@test.com',
      });

      expect(invite.email).toBe('invitee-p@test.com');
      expect(invite.status).toBe('pending');
      expect(invite.role).toBe('member');
      expect(token).toBeTruthy();
      expect(invite.tokenHash).not.toBe(token);
    });

    it('accepts manager role on invite creation', async () => {
      const proj = await createAndTrack('Invite Manager Role', aliceId);
      const { invite } = await createInvite(proj.slug, aliceId, {
        email: 'manager-p@test.com',
        role: 'manager',
      });

      expect(invite.role).toBe('manager');
    });

    it('normalizes email to lowercase', async () => {
      const proj = await createAndTrack('Invite Normalize Proj', aliceId);
      const { invite } = await createInvite(proj.slug, aliceId, {
        email: '  UPPER@Test.COM  ',
      });

      expect(invite.email).toBe('upper@test.com');
    });

    it('rejects if email is already a member', async () => {
      const proj = await createAndTrack('Invite Already Member Proj', aliceId);
      const [alice] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, aliceId));

      await expect(createInvite(proj.slug, aliceId, { email: alice.email })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('rejects if pending invite already exists', async () => {
      const proj = await createAndTrack('Invite Dup Proj', aliceId);
      await createInvite(proj.slug, aliceId, { email: 'dup-p@test.com' });

      await expect(
        createInvite(proj.slug, aliceId, { email: 'dup-p@test.com' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('member cannot create invite (FORBIDDEN)', async () => {
      const proj = await createAndTrack('Invite Member Forbid Proj', aliceId);
      await addProjectMember(proj.id, bobId, 'member');

      await expect(
        createInvite(proj.slug, bobId, { email: 'someone-p@test.com' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('manager can create invite', async () => {
      const proj = await createAndTrack('Invite Manager Create', aliceId);
      await addProjectMember(proj.id, bobId, 'manager');

      const { invite } = await createInvite(proj.slug, bobId, {
        email: 'mgr-created@test.com',
      });
      expect(invite.email).toBe('mgr-created@test.com');
    });
  });

  describe('listInvites', () => {
    it('returns pending invites with inviter name', async () => {
      const proj = await createAndTrack('Invite List Proj', aliceId);
      await createInvite(proj.slug, aliceId, { email: 'list-p@test.com' });

      const list = await listInvites(proj.slug, aliceId);
      expect(list.length).toBeGreaterThanOrEqual(1);
      const found = list.find((i) => i.email === 'list-p@test.com');
      expect(found).toBeDefined();
      expect(found!.invitedByName).toBe('Alice');
    });

    it('non-member with no override gets NOT_FOUND', async () => {
      const outsideWs = await createAndTrackWorkspace('List NonMem Ws', aliceId);
      const proj = await createAndTrack('Invite List NonMem Proj', aliceId, { wsId: outsideWs.id });

      await expect(listInvites(proj.slug, bobId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('revokeInvite', () => {
    it('owner can revoke a pending invite', async () => {
      const proj = await createAndTrack('Invite Revoke Proj', aliceId);
      const { invite } = await createInvite(proj.slug, aliceId, { email: 'revoke-p@test.com' });

      await revokeInvite(proj.slug, aliceId, invite.id);

      const list = await listInvites(proj.slug, aliceId);
      expect(list.find((i) => i.id === invite.id)).toBeUndefined();
    });

    it('member cannot revoke (FORBIDDEN)', async () => {
      const proj = await createAndTrack('Invite Revoke Forbid Proj', aliceId);
      await addProjectMember(proj.id, bobId, 'member');
      const { invite } = await createInvite(proj.slug, aliceId, { email: 'revforbid-p@test.com' });

      await expect(revokeInvite(proj.slug, bobId, invite.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('getInviteByToken', () => {
    it('returns invite summary for a valid pending token', async () => {
      const proj = await createAndTrack('Token Lookup Proj', aliceId);
      const { token } = await createInvite(proj.slug, aliceId, { email: 'token-p@test.com' });

      const summary = await getInviteByToken(token);
      expect(summary.email).toBe('token-p@test.com');
      expect(summary.projectName).toBe('Token Lookup Proj');
      expect(summary.status).toBe('pending');
    });

    it('throws NOT_FOUND for invalid token', async () => {
      await expect(getInviteByToken('bad-token-xyz')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('returns metadata with status=revoked for a revoked invite (landing page needs an explicit state)', async () => {
      const proj = await createAndTrack('Token Revoked Proj', aliceId);
      const { token, invite } = await createInvite(proj.slug, aliceId, {
        email: 'revtoken@test.com',
      });

      await revokeInvite(proj.slug, aliceId, invite.id);
      const summary = await getInviteByToken(token);
      expect(summary.status).toBe('revoked');
      expect(summary.projectName).toBe('Token Revoked Proj');
    });

    it('returns metadata with past expiresAt for an expired invite', async () => {
      const proj = await createAndTrack('Token Expired Proj', aliceId);
      const { token, invite } = await createInvite(proj.slug, aliceId, {
        email: 'exptoken@test.com',
      });

      await db
        .update(projectInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(projectInvites.id, invite.id));

      const summary = await getInviteByToken(token);
      expect(summary.status).toBe('pending');
      expect(summary.expiresAt.getTime()).toBeLessThan(Date.now());
    });
  });

  describe('acceptInvite', () => {
    it('correct email user can accept and gets membership', async () => {
      const proj = await createAndTrack('Accept Test Proj', aliceId);
      const { token } = await createInvite(proj.slug, aliceId, { email: bobEmail });

      const result = await acceptInvite(token, bobId);
      expect(result.projectSlug).toBe(proj.slug);

      const members = await listMembers(proj.slug, aliceId);
      const bobMember = members.find((m) => m.userId === bobId);
      expect(bobMember).toBeDefined();
      expect(bobMember!.role).toBe('member');

      const summary = await getInviteByToken(token);
      expect(summary.status).toBe('accepted');
    });

    it('manager-role invite grants manager membership on accept', async () => {
      const proj = await createAndTrack('Accept Manager Proj', aliceId);
      const ts = Date.now();
      const carolEmail = `carol-accept-mgr-${ts}@test.com`;
      const carolId = await signUp(carolEmail, 'Carol');

      const { token } = await createInvite(proj.slug, aliceId, {
        email: carolEmail,
        role: 'manager',
      });

      await acceptInvite(token, carolId);

      const members = await listMembers(proj.slug, aliceId);
      const carolMember = members.find((m) => m.userId === carolId);
      expect(carolMember?.role).toBe('manager');
    });

    it('mismatched email throws FORBIDDEN', async () => {
      const proj = await createAndTrack('Accept Mismatch Proj', aliceId);
      const { token } = await createInvite(proj.slug, aliceId, { email: 'stranger-p@test.com' });

      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('accepting already-accepted invite throws CONFLICT', async () => {
      const proj = await createAndTrack('Accept Twice Proj', aliceId);
      const { token } = await createInvite(proj.slug, aliceId, { email: bobEmail });

      await acceptInvite(token, bobId);
      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('accepting revoked invite throws CONFLICT', async () => {
      const proj = await createAndTrack('Accept Revoked Proj', aliceId);
      const { token, invite } = await createInvite(proj.slug, aliceId, { email: bobEmail });

      await revokeInvite(proj.slug, aliceId, invite.id);
      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('accepting expired invite throws CONFLICT', async () => {
      const proj = await createAndTrack('Accept Expired Proj', aliceId);
      const { token, invite } = await createInvite(proj.slug, aliceId, { email: bobEmail });

      await db
        .update(projectInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(projectInvites.id, invite.id));

      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('workspace-scoped resolution', () => {
    it('createInvite with a non-matching workspaceSlug resolves NOT_FOUND', async () => {
      const wsA = await createAndTrackWorkspace('Inv Cross Ws A', aliceId);
      const wsB = await createAndTrackWorkspace('Inv Cross Ws B', aliceId);
      // Distinct names → distinct slugs, so projA's slug is genuinely absent from wsB.
      const projA = await createAndTrack('Inv Cross A Only', aliceId, { wsId: wsA.id });
      await createAndTrack('Inv Cross B Only', aliceId, { wsId: wsB.id });

      // projA.slug lives in wsA; resolving it under wsB must not find a row.
      await expect(
        createInvite(projA.slug, aliceId, { email: 'crossinv@test.com' }, wsB.slug),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('createInvite with the matching workspaceSlug resolves the correct project', async () => {
      const wsA = await createAndTrackWorkspace('Inv Match Ws A', aliceId);
      const wsB = await createAndTrackWorkspace('Inv Match Ws B', aliceId);
      const projA = await createAndTrack('Inv Match Shared', aliceId, { wsId: wsA.id });
      const projB = await createAndTrack('Inv Match Shared', aliceId, { wsId: wsB.id });

      const { invite } = await createInvite(
        projB.slug,
        aliceId,
        { email: 'matchinv@test.com' },
        wsB.slug,
      );
      expect(invite.email).toBe('matchinv@test.com');
      // The invite must attach to the wsB project, not the same-slug wsA project.
      expect(invite.projectId).toBe(projB.id);
      expect(invite.projectId).not.toBe(projA.id);
    });

    it('createInvite preserves FORBIDDEN semantics when threaded with a workspaceSlug', async () => {
      const ws = await createAndTrackWorkspace('Inv Forbid Ws', aliceId);
      const proj = await createAndTrack('Inv Forbid Threaded', aliceId, { wsId: ws.id });
      await addProjectMember(proj.id, bobId, 'member');

      await expect(
        createInvite(proj.slug, bobId, { email: 'nope@test.com' }, ws.slug),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('listInvites resolves the project in the given workspace', async () => {
      const wsA = await createAndTrackWorkspace('Inv List Ws A', aliceId);
      const wsB = await createAndTrackWorkspace('Inv List Ws B', aliceId);
      // Distinct names so projA's slug is absent from wsB and the NOT_FOUND is real.
      const projA = await createAndTrack('Inv List A Only', aliceId, { wsId: wsA.id });
      const projB = await createAndTrack('Inv List B Only', aliceId, { wsId: wsB.id });
      await createInvite(projA.slug, aliceId, { email: 'ina-list@test.com' }, wsA.slug);
      await createInvite(projB.slug, aliceId, { email: 'inb-list@test.com' }, wsB.slug);

      const listB = await listInvites(projB.slug, aliceId, wsB.slug);
      expect(listB.map((i) => i.email)).toContain('inb-list@test.com');
      expect(listB.map((i) => i.email)).not.toContain('ina-list@test.com');

      // A slug that does not live in the named workspace resolves NOT_FOUND.
      await expect(
        listInvites(projA.slug, aliceId, wsB.slug),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('revokeInvite with a non-matching workspaceSlug resolves NOT_FOUND', async () => {
      const wsA = await createAndTrackWorkspace('Inv Revoke Ws A', aliceId);
      const wsB = await createAndTrackWorkspace('Inv Revoke Ws B', aliceId);
      // Distinct names so the NOT_FOUND comes from the (workspace, slug) project
      // lookup rather than falling through to the invite lookup.
      const projA = await createAndTrack('Inv Revoke A Only', aliceId, { wsId: wsA.id });
      await createAndTrack('Inv Revoke B Only', aliceId, { wsId: wsB.id });
      const { invite } = await createInvite(
        projA.slug,
        aliceId,
        { email: 'revcross@test.com' },
        wsA.slug,
      );

      await expect(
        revokeInvite(projA.slug, aliceId, invite.id, wsB.slug),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      // The invite is untouched and still pending under the correct workspace.
      const list = await listInvites(projA.slug, aliceId, wsA.slug);
      expect(list.find((i) => i.id === invite.id)).toBeDefined();
    });
  });
});

describe('requireProjectPermission workspace threading', () => {
  it('carries workspaceSlug to the resolver, selecting the same-slug project in the named workspace', async () => {
    const ts = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: { email: `guard-${ts}@test.com`, password: 'password123', name: 'Guard' },
    });
    const guardId = JSON.parse(res.body).user.id;
    const cookie = (res.headers['set-cookie'] as string).split(';')[0];
    const req = { headers: { cookie } } as unknown as FastifyRequest;

    const wsA = await createAndTrackWorkspace('Guard Ws A', guardId);
    const wsB = await createAndTrackWorkspace('Guard Ws B', guardId);
    const projA = await createAndTrack('Guard Shared', guardId, { wsId: wsA.id });
    const projB = await createAndTrack('Guard Shared', guardId, { wsId: wsB.id });

    const resolved = await requireProjectPermission(req, projB.slug, 'project:read', wsB.slug);
    expect(resolved.project.id).toBe(projB.id);
    expect(resolved.project.id).not.toBe(projA.id);

    // A slug not present in the named workspace surfaces as NOT_FOUND (404 semantics).
    await expect(
      requireProjectPermission(req, projB.slug, 'project:read', 'no-such-workspace'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('still throws 401 when unauthenticated (semantics unchanged)', async () => {
    const req = { headers: {} } as unknown as FastifyRequest;
    await expect(
      requireProjectPermission(req, 'any-slug', 'project:read', 'any-ws'),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
