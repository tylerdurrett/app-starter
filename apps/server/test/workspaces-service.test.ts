// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll } from 'vitest';
import { db, workspaces, workspaceMemberships, workspaceInvites, users } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import {
  listWorkspacesForUser,
  getWorkspaceBySlug,
  updateWorkspace,
  deleteWorkspace,
  listMembers,
  removeMember,
} from '../src/workspaces/service.js';

import {
  createInvite,
  listInvites,
  revokeInvite,
  getInviteByToken,
  acceptInvite,
} from '../src/workspaces/invites.js';
import { createTestServer, createWorkspaceViaService, signUp } from './helpers.js';
import { hashToken } from '../src/tenancy/invites.js';

// ---- helpers ----

let app: FastifyInstance;
let aliceId: string;
let bobId: string;
let bobEmail: string;

async function createWorkspaceForTest(name: string, ownerUserId: string) {
  return createWorkspaceViaService(name, ownerUserId);
}

/** Add a user as a member of a workspace. */
async function addMember(workspaceId: string, userId: string) {
  await db.insert(workspaceMemberships).values({
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    userId,
    role: 'member',
  });
}

// ---- setup / teardown ----

beforeAll(async () => {
  app = await createTestServer();
  await app.ready();

  const ts = Date.now();
  aliceId = (await signUp(app, `alice-svc-${ts}@test.com`, 'Alice')).userId;
  bobId = (await signUp(app, `bob-svc-${ts}@test.com`, 'Bob')).userId;
  bobEmail = `bob-svc-${ts}@test.com`;
});

// ---- tests ----

describe('createWorkspace', () => {
  it('creates a workspace with correct slug and owner membership', async () => {
    const ws = await createWorkspaceForTest('Acme Corp', aliceId);

    expect(ws.name).toBe('Acme Corp');
    expect(ws.slug).toMatch(/^acme-corp/);

    const [membership] = await db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, ws.id));

    expect(membership.userId).toBe(aliceId);
    expect(membership.role).toBe('owner');
  });

  it('creates a unique slug when duplicate name exists', async () => {
    const ws1 = await createWorkspaceForTest('Duplicate Test', aliceId);
    const ws2 = await createWorkspaceForTest('Duplicate Test', aliceId);

    expect(ws1.slug).toBe('duplicate-test');
    expect(ws2.slug).toBe('duplicate-test-2');
  });

  it('handles special-character names with a fallback slug', async () => {
    const ws = await createWorkspaceForTest('!@#$%', aliceId);
    expect(ws.slug).toMatch(/^workspace-/);
  });
});

describe('listWorkspacesForUser', () => {
  it('returns only workspaces the user is a member of', async () => {
    const ws = await createWorkspaceForTest('Alice Only', aliceId);
    const aliceList = await listWorkspacesForUser(aliceId);
    const bobList = await listWorkspacesForUser(bobId);

    expect(aliceList.some((w) => w.id === ws.id)).toBe(true);
    expect(bobList.some((w) => w.id === ws.id)).toBe(false);
  });

  it('returns workspaces ordered by createdAt asc', async () => {
    const list = await listWorkspacesForUser(aliceId);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].createdAt.getTime()).toBeGreaterThanOrEqual(list[i - 1].createdAt.getTime());
    }
  });
});

describe('getWorkspaceBySlug', () => {
  it('returns workspace and role for a member', async () => {
    const ws = await createWorkspaceForTest('Get Test', aliceId);
    const result = await getWorkspaceBySlug(ws.slug, aliceId);

    expect(result.workspace.id).toBe(ws.id);
    expect(result.role).toBe('owner');
  });

  it('throws NOT_FOUND for non-existent slug', async () => {
    await expect(getWorkspaceBySlug('no-such-slug', aliceId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND for non-member', async () => {
    const ws = await createWorkspaceForTest('No Bob', aliceId);
    await expect(getWorkspaceBySlug(ws.slug, bobId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('updateWorkspace', () => {
  it('owner can update name', async () => {
    const ws = await createWorkspaceForTest('Before Update', aliceId);
    const updated = await updateWorkspace(ws.slug, aliceId, { name: 'After Update' });

    expect(updated.name).toBe('After Update');
    expect(updated.slug).toBe(ws.slug); // slug does not change
  });

  it('member cannot update name (FORBIDDEN)', async () => {
    const ws = await createWorkspaceForTest('Member Update Test', aliceId);
    await addMember(ws.id, bobId);

    await expect(updateWorkspace(ws.slug, bobId, { name: 'Nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('non-member gets NOT_FOUND', async () => {
    const ws = await createWorkspaceForTest('NonMem Update', aliceId);
    await expect(updateWorkspace(ws.slug, bobId, { name: 'Nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('deleteWorkspace', () => {
  it('owner can delete with correct confirmation', async () => {
    const ws = await createWorkspaceForTest('Delete Me', aliceId);
    await deleteWorkspace(ws.slug, aliceId, { confirmation: `Delete ${ws.name}` });

    const [gone] = await db.select().from(workspaces).where(eq(workspaces.id, ws.id));
    expect(gone).toBeUndefined();
  });

  it('rejects incorrect confirmation', async () => {
    const ws = await createWorkspaceForTest('Keep Me', aliceId);
    await expect(
      deleteWorkspace(ws.slug, aliceId, { confirmation: 'wrong' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('member cannot delete (FORBIDDEN)', async () => {
    const ws = await createWorkspaceForTest('Member Delete Test', aliceId);
    await addMember(ws.id, bobId);

    await expect(
      deleteWorkspace(ws.slug, bobId, { confirmation: `Delete ${ws.name}` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cascade deletes memberships and invites', async () => {
    const ws = await createWorkspaceForTest('Cascade Test', aliceId);
    // Create an invite so we can verify cascade
    await createInvite(ws.slug, aliceId, { email: 'cascade@test.com' });

    await deleteWorkspace(ws.slug, aliceId, { confirmation: `Delete ${ws.name}` });

    const memberships = await db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, ws.id));
    const invites = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, ws.id));

    expect(memberships).toHaveLength(0);
    expect(invites).toHaveLength(0);
  });
});

describe('listMembers', () => {
  it('owner can list members', async () => {
    const ws = await createWorkspaceForTest('Members List', aliceId);
    const members = await listMembers(ws.slug, aliceId);

    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(aliceId);
    expect(members[0].role).toBe('owner');
  });

  it('member can list members', async () => {
    const ws = await createWorkspaceForTest('Members List Member', aliceId);
    await addMember(ws.id, bobId);

    const members = await listMembers(ws.slug, bobId);
    expect(members).toHaveLength(2);
  });

  it('non-member gets NOT_FOUND', async () => {
    const ws = await createWorkspaceForTest('Members List NonMem', aliceId);
    await expect(listMembers(ws.slug, bobId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('removeMember', () => {
  it('owner can remove a member', async () => {
    const ws = await createWorkspaceForTest('Remove Test', aliceId);
    await addMember(ws.id, bobId);

    await removeMember(ws.slug, aliceId, bobId);

    const members = await listMembers(ws.slug, aliceId);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(aliceId);
  });

  it('owner cannot self-remove', async () => {
    const ws = await createWorkspaceForTest('Self Remove', aliceId);
    await expect(removeMember(ws.slug, aliceId, aliceId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('member cannot remove (FORBIDDEN)', async () => {
    const ws = await createWorkspaceForTest('Member Remove Forbid', aliceId);
    await addMember(ws.id, bobId);

    await expect(removeMember(ws.slug, bobId, aliceId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('removing non-existent member throws NOT_FOUND', async () => {
    const ws = await createWorkspaceForTest('Remove Ghost', aliceId);
    await expect(removeMember(ws.slug, aliceId, 'no-such-user')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('manager cannot remove the workspace owner (BAD_REQUEST)', async () => {
    const ws = await createWorkspaceForTest('Manager Vs Owner', aliceId);
    // Bob is a manager (has members:remove) but must not remove the owner.
    await db.insert(workspaceMemberships).values({
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspaceId: ws.id,
      userId: bobId,
      role: 'manager',
    });

    await expect(removeMember(ws.slug, bobId, aliceId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('invites', () => {
  describe('createInvite', () => {
    it('returns the exact safe invite and persists only its token hash and entity FK', async () => {
      const ws = await createWorkspaceForTest('Invite Create', aliceId);
      const { invite, token } = await createInvite(ws.slug, aliceId, {
        email: 'invitee@test.com',
      });

      expect(Object.keys(invite).sort()).toEqual([
        'createdAt',
        'email',
        'expiresAt',
        'id',
        'invitedByName',
        'role',
        'status',
      ]);
      expect(invite).toMatchObject({
        email: 'invitee@test.com',
        status: 'pending',
        role: 'member',
        invitedByName: 'Alice',
      });
      expect(new Date(invite.createdAt).toISOString()).toBe(invite.createdAt);
      expect(new Date(invite.expiresAt).toISOString()).toBe(invite.expiresAt);

      const [stored] = await db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.id, invite.id));
      expect(stored.workspaceId).toBe(ws.id);
      expect(stored.invitedByUserId).toBe(aliceId);
      expect(stored.tokenHash).toBe(hashToken(token));
      expect(stored.tokenHash).not.toBe(token);
    });

    it('rejects a null-name inviter without inserting an invite', async () => {
      const ts = Date.now();
      const inviter = await signUp(app, `nameless-w-${ts}@test.com`, 'Temporary');
      const ws = await createWorkspaceForTest('Nameless Inviter', inviter.userId);
      await db.update(users).set({ name: null }).where(eq(users.id, inviter.userId));

      await expect(
        createInvite(ws.slug, inviter.userId, { email: 'not-created-w@test.com' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const rows = await db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.workspaceId, ws.id));
      expect(rows).toHaveLength(0);
    });

    it('returns NOT_FOUND for a missing inviter without inserting an invite', async () => {
      const ws = await createWorkspaceForTest('Missing Inviter', aliceId);
      await expect(
        createInvite(ws.slug, 'missing-inviter-id', { email: 'not-created-missing-w@test.com' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const rows = await db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.workspaceId, ws.id));
      expect(rows).toHaveLength(0);
    });

    it('normalizes email to lowercase', async () => {
      const ws = await createWorkspaceForTest('Invite Normalize', aliceId);
      const { invite } = await createInvite(ws.slug, aliceId, {
        email: '  UPPER@Test.COM  ',
      });

      expect(invite.email).toBe('upper@test.com');
    });

    it('rejects if email is already a member', async () => {
      const ws = await createWorkspaceForTest('Invite Already Member', aliceId);
      // Alice's email is already a member (owner)
      const [alice] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, aliceId));

      await expect(createInvite(ws.slug, aliceId, { email: alice.email })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('rejects if pending invite already exists', async () => {
      const ws = await createWorkspaceForTest('Invite Dup', aliceId);
      await createInvite(ws.slug, aliceId, { email: 'dup@test.com' });

      await expect(createInvite(ws.slug, aliceId, { email: 'dup@test.com' })).rejects.toMatchObject(
        { code: 'CONFLICT' },
      );
    });

    it('member cannot create invite (FORBIDDEN)', async () => {
      const ws = await createWorkspaceForTest('Invite Member Forbid', aliceId);
      await addMember(ws.id, bobId);

      await expect(
        createInvite(ws.slug, bobId, { email: 'someone@test.com' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('listInvites', () => {
    it('returns pending invites with inviter name', async () => {
      const ws = await createWorkspaceForTest('Invite List', aliceId);
      await createInvite(ws.slug, aliceId, { email: 'list@test.com' });

      const list = await listInvites(ws.slug, aliceId);
      expect(list).toHaveLength(1);
      expect(list[0].email).toBe('list@test.com');
      expect(list[0].invitedByName).toBe('Alice');
    });

    it('member can list invites', async () => {
      const ws = await createWorkspaceForTest('Invite List Member', aliceId);
      await addMember(ws.id, bobId);
      await createInvite(ws.slug, aliceId, { email: 'listmem@test.com' });

      const list = await listInvites(ws.slug, bobId);
      expect(list).toHaveLength(1);
    });

    it('non-member gets NOT_FOUND', async () => {
      const ws = await createWorkspaceForTest('Invite List NonMem', aliceId);
      await expect(listInvites(ws.slug, bobId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('revokeInvite', () => {
    it('owner can revoke a pending invite', async () => {
      const ws = await createWorkspaceForTest('Invite Revoke', aliceId);
      const { invite } = await createInvite(ws.slug, aliceId, { email: 'revoke@test.com' });

      await expect(revokeInvite(ws.slug, aliceId, invite.id)).resolves.toBeUndefined();

      const list = await listInvites(ws.slug, aliceId);
      expect(list).toHaveLength(0); // revoked invites are excluded from pending list
    });

    it('revoking a missing invite throws NOT_FOUND', async () => {
      const ws = await createWorkspaceForTest('Invite Revoke Missing', aliceId);
      await expect(revokeInvite(ws.slug, aliceId, 'missing-invite')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('revoking a non-pending invite throws CONFLICT', async () => {
      const ws = await createWorkspaceForTest('Invite Revoke NonPend', aliceId);
      const { invite } = await createInvite(ws.slug, aliceId, { email: 'revoked-twice@test.com' });

      await revokeInvite(ws.slug, aliceId, invite.id);
      await expect(revokeInvite(ws.slug, aliceId, invite.id)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('member cannot revoke (FORBIDDEN)', async () => {
      const ws = await createWorkspaceForTest('Invite Revoke Forbid', aliceId);
      await addMember(ws.id, bobId);
      const { invite } = await createInvite(ws.slug, aliceId, { email: 'revforbid@test.com' });

      await expect(revokeInvite(ws.slug, bobId, invite.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('getInviteByToken', () => {
    it('returns invite summary for a valid token', async () => {
      const ws = await createWorkspaceForTest('Token Lookup', aliceId);
      const { token } = await createInvite(ws.slug, aliceId, { email: 'token@test.com' });

      const summary = await getInviteByToken(token);
      expect(summary.email).toBe('token@test.com');
      expect(summary.workspaceName).toBe('Token Lookup');
      expect(summary.status).toBe('pending');
      expect(Object.keys(summary).sort()).toEqual([
        'email',
        'expiresAt',
        'inviteId',
        'status',
        'workspaceName',
        'workspaceSlug',
      ]);
      expect(new Date(summary.expiresAt).toISOString()).toBe(summary.expiresAt);
    });

    it.each(['accepted', 'revoked'] as const)(
      'returns safe %s terminal metadata',
      async (status) => {
        const ws = await createWorkspaceForTest(`Token ${status} Workspace`, aliceId);
        const ts = Date.now();
        const email = `token-${status}-w-${ts}@test.com`;
        const actor = await signUp(app, email, `Token ${status}`);
        const { token, invite } = await createInvite(ws.slug, aliceId, { email });

        if (status === 'accepted') await acceptInvite(token, actor.userId);
        else await revokeInvite(ws.slug, aliceId, invite.id);

        const summary = await getInviteByToken(token);
        expect(summary.status).toBe(status);
        expect(Object.keys(summary)).not.toContain('workspaceId');
      },
    );

    it('returns safe metadata with an ISO expiry for an expired invite', async () => {
      const ws = await createWorkspaceForTest('Token Expired Workspace', aliceId);
      const { token, invite } = await createInvite(ws.slug, aliceId, {
        email: 'expired-metadata-w@test.com',
      });
      await db
        .update(workspaceInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceInvites.id, invite.id));

      const summary = await getInviteByToken(token);
      expect(new Date(summary.expiresAt).getTime()).toBeLessThan(Date.now());
      expect(Object.keys(summary)).not.toContain('tokenHash');
    });

    it('throws NOT_FOUND for invalid token', async () => {
      await expect(getInviteByToken('bad-token')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('acceptInvite', () => {
    it('normalizes both stored user and invite emails before accepting', async () => {
      const ws = await createWorkspaceForTest('Accept Test', aliceId);
      const { token, invite } = await createInvite(ws.slug, aliceId, {
        email: `  ${bobEmail.toUpperCase()}  `,
      });
      await db
        .update(users)
        .set({ email: `  ${bobEmail.toUpperCase()}  ` })
        .where(eq(users.id, bobId));

      const result = await acceptInvite(token, bobId);
      expect(result).toEqual({
        workspaceId: ws.id,
        workspaceSlug: ws.slug,
        workspaceName: 'Accept Test',
      });

      const [storedInvite] = await db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.id, invite.id));
      expect(storedInvite.email).toBe(bobEmail);
      expect(storedInvite.status).toBe('accepted');

      // Verify membership was created
      const members = await listMembers(ws.slug, aliceId);
      const bobMember = members.find((m) => m.userId === bobId);
      expect(bobMember).toBeDefined();
      expect(bobMember!.role).toBe('member');

      const summary = await getInviteByToken(token);
      expect(summary.status).toBe('accepted');

      await db.update(users).set({ email: bobEmail }).where(eq(users.id, bobId));
    });

    it('mismatched email throws FORBIDDEN', async () => {
      const ws = await createWorkspaceForTest('Accept Mismatch', aliceId);
      const { token } = await createInvite(ws.slug, aliceId, { email: 'stranger@test.com' });

      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('missing accepting user throws NOT_FOUND without membership or status changes', async () => {
      const ws = await createWorkspaceForTest('Accept Missing User', aliceId);
      const { token, invite } = await createInvite(ws.slug, aliceId, {
        email: 'missing-user-w@test.com',
      });

      await expect(acceptInvite(token, 'missing-user-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const memberships = await db
        .select()
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, ws.id),
            eq(workspaceMemberships.userId, 'missing-user-id'),
          ),
        );
      const [stored] = await db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.id, invite.id));
      expect(memberships).toHaveLength(0);
      expect(stored.status).toBe('pending');
    });

    it('accepted invite cannot be revoked and remains accepted', async () => {
      const ws = await createWorkspaceForTest('Accept Then Revoke', aliceId);
      const ts = Date.now();
      const email = `accepted-revoke-w-${ts}@test.com`;
      const actor = await signUp(app, email, 'Accepted Revoke');
      const { token, invite } = await createInvite(ws.slug, aliceId, { email });
      await acceptInvite(token, actor.userId);

      await expect(revokeInvite(ws.slug, aliceId, invite.id)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect((await getInviteByToken(token)).status).toBe('accepted');
    });

    it('accepting already-accepted invite throws CONFLICT', async () => {
      const ws = await createWorkspaceForTest('Accept Twice', aliceId);
      const { token } = await createInvite(ws.slug, aliceId, { email: bobEmail });

      await acceptInvite(token, bobId);
      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('accepting revoked invite throws CONFLICT', async () => {
      const ws = await createWorkspaceForTest('Accept Revoked', aliceId);
      const { token, invite } = await createInvite(ws.slug, aliceId, { email: bobEmail });

      await revokeInvite(ws.slug, aliceId, invite.id);
      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('accepting expired invite throws CONFLICT', async () => {
      const ws = await createWorkspaceForTest('Accept Expired', aliceId);
      const { token, invite } = await createInvite(ws.slug, aliceId, { email: bobEmail });

      // Manually expire the invite
      await db
        .update(workspaceInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceInvites.id, invite.id));

      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });
});
