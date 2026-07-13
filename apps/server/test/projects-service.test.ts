// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll } from 'vitest';
import {
  db,
  workspaceMemberships,
  projects,
  projectMemberships,
  projectInvites,
  users,
} from '@repo/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import {
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
import {
  createProjectViaService,
  createTestServer,
  createWorkspaceViaService,
  signUp,
} from './helpers.js';

// ---- helpers ----

let app: FastifyInstance;
let aliceId: string;
let bobId: string;
let bobEmail: string;
let workspaceId: string;
let workspaceSlug: string;

async function createWorkspaceForTest(name: string, ownerUserId: string) {
  return createWorkspaceViaService(name, ownerUserId);
}

async function createProjectForTest(name: string, ownerUserId: string, opts?: { wsId?: string }) {
  return createProjectViaService(name, opts?.wsId ?? workspaceId, ownerUserId);
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
  app = await createTestServer();
  await app.ready();

  const ts = Date.now();
  aliceId = (await signUp(app, `alice-psvc-${ts}@test.com`, 'Alice')).userId;
  bobId = (await signUp(app, `bob-psvc-${ts}@test.com`, 'Bob')).userId;
  bobEmail = `bob-psvc-${ts}@test.com`;

  // Projects live under a workspace; create one shared parent workspace for this file.
  const parent = await createWorkspaceForTest('Projects Test Parent', aliceId);
  workspaceId = parent.id;
  workspaceSlug = parent.slug;
});

// ---- tests ----

describe('createProject', () => {
  it('creates a project with correct slug, workspaceId, and owner membership', async () => {
    const proj = await createProjectForTest('Marketing Site', aliceId);

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
    const p1 = await createProjectForTest('Duplicate Proj', aliceId);
    const p2 = await createProjectForTest('Duplicate Proj', aliceId);

    expect(p1.slug).toBe('duplicate-proj');
    expect(p2.slug).toBe('duplicate-proj-2');
  });

  it('handles special-character names with a fallback slug', async () => {
    const proj = await createProjectForTest('!@#$%', aliceId);
    expect(proj.slug).toMatch(/^project-/);
  });
});

describe('updateProject', () => {
  it('owner can update name', async () => {
    const proj = await createProjectForTest('Before Update', aliceId);
    const updated = await updateProject(
      proj.slug,
      aliceId,
      { name: 'After Update' },
      workspaceSlug,
    );

    expect(updated.name).toBe('After Update');
    expect(updated.slug).toBe(proj.slug); // slug does not change
  });

  it('member cannot update (FORBIDDEN)', async () => {
    const proj = await createProjectForTest('Member Update Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    await expect(
      updateProject(proj.slug, bobId, { name: 'Nope' }, workspaceSlug),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('manager can update (intermediate access)', async () => {
    const proj = await createProjectForTest('Manager Update Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'manager');

    const updated = await updateProject(
      proj.slug,
      bobId,
      { name: 'Manager Updated' },
      workspaceSlug,
    );
    expect(updated.name).toBe('Manager Updated');
  });
});

describe('deleteProject', () => {
  it('owner can delete with correct confirmation', async () => {
    const proj = await createProjectForTest('Delete Me Proj', aliceId);
    await deleteProject(proj.slug, aliceId, { confirmation: `Delete ${proj.name}` }, workspaceSlug);

    const [gone] = await db.select().from(projects).where(eq(projects.id, proj.id));
    expect(gone).toBeUndefined();
  });

  it('rejects incorrect confirmation', async () => {
    const proj = await createProjectForTest('Keep Me Proj', aliceId);
    await expect(
      deleteProject(proj.slug, aliceId, { confirmation: 'wrong' }, workspaceSlug),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('manager cannot delete (FORBIDDEN)', async () => {
    const proj = await createProjectForTest('Manager Delete Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'manager');

    await expect(
      deleteProject(proj.slug, bobId, { confirmation: `Delete ${proj.name}` }, workspaceSlug),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cascade deletes memberships and invites', async () => {
    const proj = await createProjectForTest('Cascade Proj', aliceId);
    await createInvite(proj.slug, aliceId, { email: 'cascade-proj@test.com' }, workspaceSlug);

    await deleteProject(proj.slug, aliceId, { confirmation: `Delete ${proj.name}` }, workspaceSlug);

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
    const proj = await createProjectForTest('Members List Proj', aliceId);
    const members = await listMembers(proj.slug, aliceId, workspaceSlug);

    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(aliceId);
    expect(members[0].role).toBe('owner');
  });

  it('member can list members', async () => {
    const proj = await createProjectForTest('Members List Mem Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    const members = await listMembers(proj.slug, bobId, workspaceSlug);
    expect(members).toHaveLength(2);
  });

  it('non-member with no workspace override gets NOT_FOUND', async () => {
    // Create a workspace that bob is NOT in, and a project inside it
    const outsideWs = await createWorkspaceForTest('Outside Ws', aliceId);
    const proj = await createProjectForTest('Outside Proj', aliceId, { wsId: outsideWs.id });

    await expect(listMembers(proj.slug, bobId, outsideWs.slug)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('removeMember', () => {
  it('owner can remove a member', async () => {
    const proj = await createProjectForTest('Remove Test Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    await removeMember(proj.slug, aliceId, bobId, workspaceSlug);

    const members = await listMembers(proj.slug, aliceId, workspaceSlug);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(aliceId);
  });

  it('cannot self-remove (CONFLICT)', async () => {
    const proj = await createProjectForTest('Self Remove Proj', aliceId);
    await expect(removeMember(proj.slug, aliceId, aliceId, workspaceSlug)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('member cannot remove others (FORBIDDEN)', async () => {
    const proj = await createProjectForTest('Member Remove Forbid Proj', aliceId);
    await addProjectMember(proj.id, bobId, 'member');

    await expect(removeMember(proj.slug, bobId, aliceId, workspaceSlug)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('removing non-existent member throws NOT_FOUND', async () => {
    const proj = await createProjectForTest('Remove Ghost Proj', aliceId);
    await expect(
      removeMember(proj.slug, aliceId, 'no-such-user', workspaceSlug),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('workspace-scoped slug threading through service wrappers', () => {
  it('updateProject targets the project in the given workspace', async () => {
    const wsA = await createWorkspaceForTest('Svc Update Ws A', aliceId);
    const wsB = await createWorkspaceForTest('Svc Update Ws B', aliceId);
    const projA = await createProjectForTest('Svc Update Shared', aliceId, { wsId: wsA.id });
    const projB = await createProjectForTest('Svc Update Shared', aliceId, { wsId: wsB.id });

    const updated = await updateProject(projB.slug, aliceId, { name: 'Renamed In B' }, wsB.slug);
    expect(updated.id).toBe(projB.id);
    expect(updated.name).toBe('Renamed In B');

    const [aStill] = await db.select().from(projects).where(eq(projects.id, projA.id));
    expect(aStill.name).toBe('Svc Update Shared');
  });

  it('deleteProject deletes the project in the given workspace only', async () => {
    const wsA = await createWorkspaceForTest('Svc Delete Ws A', aliceId);
    const wsB = await createWorkspaceForTest('Svc Delete Ws B', aliceId);
    const projA = await createProjectForTest('Svc Delete Shared', aliceId, { wsId: wsA.id });
    const projB = await createProjectForTest('Svc Delete Shared', aliceId, { wsId: wsB.id });

    await deleteProject(projB.slug, aliceId, { confirmation: `Delete ${projB.name}` }, wsB.slug);

    const [bGone] = await db.select().from(projects).where(eq(projects.id, projB.id));
    const [aStill] = await db.select().from(projects).where(eq(projects.id, projA.id));
    expect(bGone).toBeUndefined();
    expect(aStill.id).toBe(projA.id);
  });

  it('listMembers resolves the project in the given workspace', async () => {
    const wsA = await createWorkspaceForTest('Svc Members Ws A', aliceId);
    const wsB = await createWorkspaceForTest('Svc Members Ws B', aliceId);
    const projA = await createProjectForTest('Svc Members Shared', aliceId, { wsId: wsA.id });
    const projB = await createProjectForTest('Svc Members Shared', aliceId, { wsId: wsB.id });
    await addProjectMember(projB.id, bobId, 'member');

    const membersB = await listMembers(projB.slug, aliceId, wsB.slug);
    const membersA = await listMembers(projA.slug, aliceId, wsA.slug);

    expect(membersB.map((m) => m.userId).sort()).toEqual([aliceId, bobId].sort());
    expect(membersA.map((m) => m.userId)).toEqual([aliceId]);
  });

  it('removeMember resolves the project in the given workspace', async () => {
    const wsA = await createWorkspaceForTest('Svc Remove Ws A', aliceId);
    const wsB = await createWorkspaceForTest('Svc Remove Ws B', aliceId);
    const projA = await createProjectForTest('Svc Remove Shared', aliceId, { wsId: wsA.id });
    const projB = await createProjectForTest('Svc Remove Shared', aliceId, { wsId: wsB.id });
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
  it('returns null when the user has no last-active project', async () => {
    await db.update(users).set({ lastActiveProjectId: null }).where(eq(users.id, bobId));

    await expect(getLastActiveProject(bobId)).resolves.toBeNull();
  });

  it('setLastActiveProject updates the user row', async () => {
    const proj = await createProjectForTest('Last Active Set', aliceId);
    await setLastActiveProject(aliceId, proj.id);

    const [user] = await db
      .select({ lastActiveProjectId: users.lastActiveProjectId })
      .from(users)
      .where(eq(users.id, aliceId));

    expect(user.lastActiveProjectId).toBe(proj.id);
  });

  it('getLastActiveProject returns the project when set and user has access', async () => {
    const proj = await createProjectForTest('Last Active Get', aliceId);
    await setLastActiveProject(aliceId, proj.id);

    const result = await getLastActiveProject(aliceId);
    expect(result).toEqual({
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      workspaceId,
      workspaceSlug,
      workspaceName: 'Projects Test Parent',
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      role: 'owner',
    });
  });

  it('returns null without throwing when the stored project is inaccessible', async () => {
    const workspace = await createWorkspaceForTest('Last Active Inaccessible Workspace', aliceId);
    const proj = await createProjectForTest('Last Active Inaccessible Project', aliceId, {
      wsId: workspace.id,
    });
    await setLastActiveProject(bobId, proj.id);

    await expect(getLastActiveProject(bobId)).resolves.toBeNull();
  });

  it('uses workspace-derived access for the stored project', async () => {
    const workspace = await createWorkspaceForTest('Last Active Workspace Access', aliceId);
    const proj = await createProjectForTest('Last Active Workspace Project', aliceId, {
      wsId: workspace.id,
    });
    await addWorkspaceMember(workspace.id, bobId, 'manager');
    await setLastActiveProject(bobId, proj.id);

    await expect(getLastActiveProject(bobId)).resolves.toMatchObject({
      id: proj.id,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
  });

  it('falls back to workspace access after direct access loss, then returns null', async () => {
    const workspace = await createWorkspaceForTest('Last Active Access Loss Workspace', aliceId);
    const proj = await createProjectForTest('Last Active Access Loss Project', aliceId, {
      wsId: workspace.id,
    });
    await addWorkspaceMember(workspace.id, bobId, 'member');
    await addProjectMember(proj.id, bobId, 'manager');
    await setLastActiveProject(bobId, proj.id);

    await db
      .delete(projectMemberships)
      .where(and(eq(projectMemberships.projectId, proj.id), eq(projectMemberships.userId, bobId)));
    await expect(getLastActiveProject(bobId)).resolves.toMatchObject({
      id: proj.id,
      role: 'member',
    });

    await db
      .delete(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspace.id),
          eq(workspaceMemberships.userId, bobId),
        ),
      );
    await expect(getLastActiveProject(bobId)).resolves.toBeNull();
  });

  it('returns null after the referenced project is deleted (FK SET NULL)', async () => {
    const proj = await createProjectForTest('Last Active Delete', aliceId);
    await setLastActiveProject(aliceId, proj.id);

    await deleteProject(proj.slug, aliceId, { confirmation: `Delete ${proj.name}` }, workspaceSlug);
    const result = await getLastActiveProject(aliceId);
    expect(result).toBeNull();
  });
});

describe('invites', () => {
  describe('createInvite', () => {
    it('owner can create invite with default member role', async () => {
      const proj = await createProjectForTest('Invite Create Proj', aliceId);
      const { invite, token } = await createInvite(
        proj.slug,
        aliceId,
        {
          email: 'invitee-p@test.com',
        },
        workspaceSlug,
      );

      expect(invite.email).toBe('invitee-p@test.com');
      expect(invite.status).toBe('pending');
      expect(invite.role).toBe('member');
      expect(token).toBeTruthy();
      expect(invite.tokenHash).not.toBe(token);
    });

    it('accepts manager role on invite creation', async () => {
      const proj = await createProjectForTest('Invite Manager Role', aliceId);
      const { invite } = await createInvite(
        proj.slug,
        aliceId,
        {
          email: 'manager-p@test.com',
          role: 'manager',
        },
        workspaceSlug,
      );

      expect(invite.role).toBe('manager');
    });

    it('normalizes email to lowercase', async () => {
      const proj = await createProjectForTest('Invite Normalize Proj', aliceId);
      const { invite } = await createInvite(
        proj.slug,
        aliceId,
        {
          email: '  UPPER@Test.COM  ',
        },
        workspaceSlug,
      );

      expect(invite.email).toBe('upper@test.com');
    });

    it('rejects if email is already a member', async () => {
      const proj = await createProjectForTest('Invite Already Member Proj', aliceId);
      const [alice] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, aliceId));

      await expect(
        createInvite(proj.slug, aliceId, { email: alice.email }, workspaceSlug),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('rejects if pending invite already exists', async () => {
      const proj = await createProjectForTest('Invite Dup Proj', aliceId);
      await createInvite(proj.slug, aliceId, { email: 'dup-p@test.com' }, workspaceSlug);

      await expect(
        createInvite(proj.slug, aliceId, { email: 'dup-p@test.com' }, workspaceSlug),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('member cannot create invite (FORBIDDEN)', async () => {
      const proj = await createProjectForTest('Invite Member Forbid Proj', aliceId);
      await addProjectMember(proj.id, bobId, 'member');

      await expect(
        createInvite(proj.slug, bobId, { email: 'someone-p@test.com' }, workspaceSlug),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('manager can create invite', async () => {
      const proj = await createProjectForTest('Invite Manager Create', aliceId);
      await addProjectMember(proj.id, bobId, 'manager');

      const { invite } = await createInvite(
        proj.slug,
        bobId,
        {
          email: 'mgr-created@test.com',
        },
        workspaceSlug,
      );
      expect(invite.email).toBe('mgr-created@test.com');
    });
  });

  describe('listInvites', () => {
    it('returns pending invites with inviter name', async () => {
      const proj = await createProjectForTest('Invite List Proj', aliceId);
      await createInvite(proj.slug, aliceId, { email: 'list-p@test.com' }, workspaceSlug);

      const list = await listInvites(proj.slug, aliceId, workspaceSlug);
      expect(list.length).toBeGreaterThanOrEqual(1);
      const found = list.find((i) => i.email === 'list-p@test.com');
      expect(found).toBeDefined();
      expect(found!.invitedByName).toBe('Alice');
    });

    it('non-member with no override gets NOT_FOUND', async () => {
      const outsideWs = await createWorkspaceForTest('List NonMem Ws', aliceId);
      const proj = await createProjectForTest('Invite List NonMem Proj', aliceId, {
        wsId: outsideWs.id,
      });

      await expect(listInvites(proj.slug, bobId, outsideWs.slug)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('revokeInvite', () => {
    it('owner can revoke a pending invite', async () => {
      const proj = await createProjectForTest('Invite Revoke Proj', aliceId);
      const { invite } = await createInvite(
        proj.slug,
        aliceId,
        { email: 'revoke-p@test.com' },
        workspaceSlug,
      );

      await revokeInvite(proj.slug, aliceId, invite.id, workspaceSlug);

      const list = await listInvites(proj.slug, aliceId, workspaceSlug);
      expect(list.find((i) => i.id === invite.id)).toBeUndefined();
    });

    it('member cannot revoke (FORBIDDEN)', async () => {
      const proj = await createProjectForTest('Invite Revoke Forbid Proj', aliceId);
      await addProjectMember(proj.id, bobId, 'member');
      const { invite } = await createInvite(
        proj.slug,
        aliceId,
        { email: 'revforbid-p@test.com' },
        workspaceSlug,
      );

      await expect(revokeInvite(proj.slug, bobId, invite.id, workspaceSlug)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('getInviteByToken', () => {
    it('returns invite summary for a valid pending token', async () => {
      const proj = await createProjectForTest('Token Lookup Proj', aliceId);
      const { token } = await createInvite(
        proj.slug,
        aliceId,
        { email: 'token-p@test.com' },
        workspaceSlug,
      );

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
      const proj = await createProjectForTest('Token Revoked Proj', aliceId);
      const { token, invite } = await createInvite(
        proj.slug,
        aliceId,
        {
          email: 'revtoken@test.com',
        },
        workspaceSlug,
      );

      await revokeInvite(proj.slug, aliceId, invite.id, workspaceSlug);
      const summary = await getInviteByToken(token);
      expect(summary.status).toBe('revoked');
      expect(summary.projectName).toBe('Token Revoked Proj');
    });

    it('returns metadata with past expiresAt for an expired invite', async () => {
      const proj = await createProjectForTest('Token Expired Proj', aliceId);
      const { token, invite } = await createInvite(
        proj.slug,
        aliceId,
        {
          email: 'exptoken@test.com',
        },
        workspaceSlug,
      );

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
      const proj = await createProjectForTest('Accept Test Proj', aliceId);
      const { token } = await createInvite(proj.slug, aliceId, { email: bobEmail }, workspaceSlug);

      const result = await acceptInvite(token, bobId);
      expect(result.projectSlug).toBe(proj.slug);

      const members = await listMembers(proj.slug, aliceId, workspaceSlug);
      const bobMember = members.find((m) => m.userId === bobId);
      expect(bobMember).toBeDefined();
      expect(bobMember!.role).toBe('member');

      const summary = await getInviteByToken(token);
      expect(summary.status).toBe('accepted');
    });

    it('manager-role invite grants manager membership on accept', async () => {
      const proj = await createProjectForTest('Accept Manager Proj', aliceId);
      const ts = Date.now();
      const carolEmail = `carol-accept-mgr-${ts}@test.com`;
      const carolId = (await signUp(app, carolEmail, 'Carol')).userId;

      const { token } = await createInvite(
        proj.slug,
        aliceId,
        {
          email: carolEmail,
          role: 'manager',
        },
        workspaceSlug,
      );

      await acceptInvite(token, carolId);

      const members = await listMembers(proj.slug, aliceId, workspaceSlug);
      const carolMember = members.find((m) => m.userId === carolId);
      expect(carolMember?.role).toBe('manager');
    });

    it('mismatched email throws FORBIDDEN', async () => {
      const proj = await createProjectForTest('Accept Mismatch Proj', aliceId);
      const { token } = await createInvite(
        proj.slug,
        aliceId,
        { email: 'stranger-p@test.com' },
        workspaceSlug,
      );

      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('accepting already-accepted invite throws CONFLICT', async () => {
      const proj = await createProjectForTest('Accept Twice Proj', aliceId);
      const { token } = await createInvite(proj.slug, aliceId, { email: bobEmail }, workspaceSlug);

      await acceptInvite(token, bobId);
      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('accepting revoked invite throws CONFLICT', async () => {
      const proj = await createProjectForTest('Accept Revoked Proj', aliceId);
      const { token, invite } = await createInvite(
        proj.slug,
        aliceId,
        { email: bobEmail },
        workspaceSlug,
      );

      await revokeInvite(proj.slug, aliceId, invite.id, workspaceSlug);
      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('accepting expired invite throws CONFLICT', async () => {
      const proj = await createProjectForTest('Accept Expired Proj', aliceId);
      const { token, invite } = await createInvite(
        proj.slug,
        aliceId,
        { email: bobEmail },
        workspaceSlug,
      );

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
      const wsA = await createWorkspaceForTest('Inv Cross Ws A', aliceId);
      const wsB = await createWorkspaceForTest('Inv Cross Ws B', aliceId);
      // Distinct names → distinct slugs, so projA's slug is genuinely absent from wsB.
      const projA = await createProjectForTest('Inv Cross A Only', aliceId, { wsId: wsA.id });
      await createProjectForTest('Inv Cross B Only', aliceId, { wsId: wsB.id });

      // projA.slug lives in wsA; resolving it under wsB must not find a row.
      await expect(
        createInvite(projA.slug, aliceId, { email: 'crossinv@test.com' }, wsB.slug),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('createInvite with the matching workspaceSlug resolves the correct project', async () => {
      const wsA = await createWorkspaceForTest('Inv Match Ws A', aliceId);
      const wsB = await createWorkspaceForTest('Inv Match Ws B', aliceId);
      const projA = await createProjectForTest('Inv Match Shared', aliceId, { wsId: wsA.id });
      const projB = await createProjectForTest('Inv Match Shared', aliceId, { wsId: wsB.id });

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
      const ws = await createWorkspaceForTest('Inv Forbid Ws', aliceId);
      const proj = await createProjectForTest('Inv Forbid Threaded', aliceId, { wsId: ws.id });
      await addProjectMember(proj.id, bobId, 'member');

      await expect(
        createInvite(proj.slug, bobId, { email: 'nope@test.com' }, ws.slug),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('listInvites resolves the project in the given workspace', async () => {
      const wsA = await createWorkspaceForTest('Inv List Ws A', aliceId);
      const wsB = await createWorkspaceForTest('Inv List Ws B', aliceId);
      // Distinct names so projA's slug is absent from wsB and the NOT_FOUND is real.
      const projA = await createProjectForTest('Inv List A Only', aliceId, { wsId: wsA.id });
      const projB = await createProjectForTest('Inv List B Only', aliceId, { wsId: wsB.id });
      await createInvite(projA.slug, aliceId, { email: 'ina-list@test.com' }, wsA.slug);
      await createInvite(projB.slug, aliceId, { email: 'inb-list@test.com' }, wsB.slug);

      const listB = await listInvites(projB.slug, aliceId, wsB.slug);
      expect(listB.map((i) => i.email)).toContain('inb-list@test.com');
      expect(listB.map((i) => i.email)).not.toContain('ina-list@test.com');

      // A slug that does not live in the named workspace resolves NOT_FOUND.
      await expect(listInvites(projA.slug, aliceId, wsB.slug)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('revokeInvite with a non-matching workspaceSlug resolves NOT_FOUND', async () => {
      const wsA = await createWorkspaceForTest('Inv Revoke Ws A', aliceId);
      const wsB = await createWorkspaceForTest('Inv Revoke Ws B', aliceId);
      // Distinct names so the NOT_FOUND comes from the (workspace, slug) project
      // lookup rather than falling through to the invite lookup.
      const projA = await createProjectForTest('Inv Revoke A Only', aliceId, { wsId: wsA.id });
      await createProjectForTest('Inv Revoke B Only', aliceId, { wsId: wsB.id });
      const { invite } = await createInvite(
        projA.slug,
        aliceId,
        { email: 'revcross@test.com' },
        wsA.slug,
      );

      await expect(revokeInvite(projA.slug, aliceId, invite.id, wsB.slug)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      // The invite is untouched and still pending under the correct workspace.
      const list = await listInvites(projA.slug, aliceId, wsA.slug);
      expect(list.find((i) => i.id === invite.id)).toBeDefined();
    });
  });
});

describe('requireProjectPermission workspace threading', () => {
  it('carries workspaceSlug to the resolver, selecting the same-slug project in the named workspace', async () => {
    const ts = Date.now();
    const { userId: guardId, cookie } = await signUp(app, `guard-${ts}@test.com`, 'Guard');
    const req = { headers: { cookie } } as unknown as FastifyRequest;

    const wsA = await createWorkspaceForTest('Guard Ws A', guardId);
    const wsB = await createWorkspaceForTest('Guard Ws B', guardId);
    const projA = await createProjectForTest('Guard Shared', guardId, { wsId: wsA.id });
    const projB = await createProjectForTest('Guard Shared', guardId, { wsId: wsB.id });

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
