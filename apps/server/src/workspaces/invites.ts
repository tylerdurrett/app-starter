import { db, workspaceInvites, workspaceMemberships, workspaces, users } from '@repo/db';
import { eq, and } from 'drizzle-orm';
import {
  ServiceError,
  listInvites as sharedListInvites,
  createInvite as sharedCreateInvite,
  revokeInvite as sharedRevokeInvite,
  getInviteByToken as sharedGetInviteByToken,
  acceptInvite as sharedAcceptInvite,
  type InviteLifecycleConfig,
  type ResolveEntity,
} from '../tenancy/index.js';
import { resolveWorkspaceAndRole } from './service.js';
import type { WorkspacePermission } from './permissions.js';

/** Token-metadata projection returned by getInviteByToken for the workspace level. */
interface WorkspaceInviteTokenMeta {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  workspaceName: string;
  workspaceSlug: string;
}

interface WorkspaceAcceptResult {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}

const config: InviteLifecycleConfig<
  WorkspacePermission,
  WorkspaceInviteTokenMeta,
  WorkspaceAcceptResult
> = {
  entityLabel: 'workspace',
  permissions: {
    list: 'workspace:invites:list',
    invite: 'workspace:members:invite',
    revoke: 'workspace:invites:revoke',
  },
  invites: {
    table: workspaceInvites,
    id: workspaceInvites.id,
    email: workspaceInvites.email,
    role: workspaceInvites.role,
    status: workspaceInvites.status,
    expiresAt: workspaceInvites.expiresAt,
    createdAt: workspaceInvites.createdAt,
    invitedByUserId: workspaceInvites.invitedByUserId,
    entityId: workspaceInvites.workspaceId,
    entityIdKey: 'workspaceId',
  },
  memberships: {
    table: workspaceMemberships,
    userId: workspaceMemberships.userId,
    entityId: workspaceMemberships.workspaceId,
    entityIdKey: 'workspaceId',
  },
  async selectByTokenHash(tokenHash) {
    const [invite] = await db
      .select({
        id: workspaceInvites.id,
        workspaceId: workspaceInvites.workspaceId,
        email: workspaceInvites.email,
        role: workspaceInvites.role,
        status: workspaceInvites.status,
        expiresAt: workspaceInvites.expiresAt,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
      })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
      .where(eq(workspaceInvites.tokenHash, tokenHash));
    return invite;
  },
  // Workspace revoke: fetch by (id, workspaceId) with NO status filter, throw
  // NOT_FOUND when absent and CONFLICT when non-pending, then a VOID update.
  async revoke(workspaceId, inviteId) {
    const [invite] = await db
      .select()
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, workspaceId)));

    if (!invite) throw new ServiceError('NOT_FOUND', 'Invite not found');

    if (invite.status !== 'pending') {
      throw new ServiceError('CONFLICT', 'Invite is not pending');
    }

    await db
      .update(workspaceInvites)
      .set({ status: 'revoked' })
      .where(eq(workspaceInvites.id, inviteId));
  },
  // Workspace email guard: load the actor, throw NOT_FOUND for a missing user,
  // then compare the normalized stored email against the invite.
  async emailGuard(userId, inviteEmail) {
    const [actor] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));

    if (!actor) throw new ServiceError('NOT_FOUND', 'User not found');

    if (actor.email.toLowerCase().trim() !== inviteEmail) {
      throw new ServiceError('FORBIDDEN', 'This invite is for a different email address');
    }
  },
  membershipEntityId: (invite) => invite.workspaceId,
  buildAcceptResult: (invite) => ({
    workspaceId: invite.workspaceId,
    workspaceSlug: invite.workspaceSlug,
    workspaceName: invite.workspaceName,
  }),
};

function resolveWorkspace(slug: string, actorUserId: string): ResolveEntity<WorkspacePermission> {
  return (permission) =>
    resolveWorkspaceAndRole(slug, actorUserId, permission).then((r) => r.workspace);
}

export function listInvites(slug: string, actorUserId: string) {
  return sharedListInvites(config, resolveWorkspace(slug, actorUserId));
}

export function createInvite(
  slug: string,
  actorUserId: string,
  input: { email: string; role?: 'manager' | 'member' },
) {
  return sharedCreateInvite(config, resolveWorkspace(slug, actorUserId), actorUserId, input);
}

export function revokeInvite(slug: string, actorUserId: string, inviteId: string): Promise<void> {
  return sharedRevokeInvite(config, resolveWorkspace(slug, actorUserId), inviteId).then(
    () => undefined,
  );
}

export function getInviteByToken(token: string) {
  return sharedGetInviteByToken(config, token);
}

export function acceptInvite(token: string, actorUserId: string) {
  return sharedAcceptInvite(config, token, actorUserId);
}
