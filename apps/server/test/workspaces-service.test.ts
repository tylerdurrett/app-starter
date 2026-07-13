// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll } from 'vitest';
import { db, workspaces, workspaceMemberships, workspaceInvites, users } from '@repo/db';
import { eq } from 'drizzle-orm';
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
    it('owner can create invite and receives raw token', async () => {
      const ws = await createWorkspaceForTest('Invite Create', aliceId);
      const { invite, token } = await createInvite(ws.slug, aliceId, {
        email: 'invitee@test.com',
      });

      expect(invite.email).toBe('invitee@test.com');
      expect(invite.status).toBe('pending');
      expect(invite.role).toBe('member');
      expect(token).toBeTruthy();
      expect(invite.tokenHash).not.toBe(token); // hash !== raw token
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
      const [alice] = await db.select({ email: users.email }).from(users).where(eq(users.id, aliceId));

      await expect(
        createInvite(ws.slug, aliceId, { email: alice.email }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects if pending invite already exists', async () => {
      const ws = await createWorkspaceForTest('Invite Dup', aliceId);
      await createInvite(ws.slug, aliceId, { email: 'dup@test.com' });

      await expect(
        createInvite(ws.slug, aliceId, { email: 'dup@test.com' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
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

      await revokeInvite(ws.slug, aliceId, invite.id);

      const list = await listInvites(ws.slug, aliceId);
      expect(list).toHaveLength(0); // revoked invites are excluded from pending list
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
    });

    it('throws NOT_FOUND for invalid token', async () => {
      await expect(getInviteByToken('bad-token')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('acceptInvite', () => {
    it('correct email user can accept and gets membership', async () => {
      const ws = await createWorkspaceForTest('Accept Test', aliceId);
      const { token } = await createInvite(ws.slug, aliceId, { email: bobEmail });

      const result = await acceptInvite(token, bobId);
      expect(result.workspaceId).toBe(ws.id);

      // Verify membership was created
      const members = await listMembers(ws.slug, aliceId);
      const bobMember = members.find((m) => m.userId === bobId);
      expect(bobMember).toBeDefined();
      expect(bobMember!.role).toBe('member');

      const summary = await getInviteByToken(token);
      expect(summary.status).toBe('accepted');
    });

    it('mismatched email throws FORBIDDEN', async () => {
      const ws = await createWorkspaceForTest('Accept Mismatch', aliceId);
      const { token } = await createInvite(ws.slug, aliceId, { email: 'stranger@test.com' });

      await expect(acceptInvite(token, bobId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
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
