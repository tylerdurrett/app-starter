import { db, workspaceInvites, workspaceMemberships, workspaces } from '@repo/db';
import { eq } from 'drizzle-orm';
import {
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
import { workspaceInviteMetadataSchema, type WorkspaceInviteMetadata } from '@repo/shared';

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
  WorkspaceInviteMetadata,
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
  buildTokenMetadata: (invite) =>
    workspaceInviteMetadataSchema.parse({
      inviteId: invite.id,
      email: invite.email,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      workspaceName: invite.workspaceName,
      workspaceSlug: invite.workspaceSlug,
    }),
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
  return sharedRevokeInvite(config, resolveWorkspace(slug, actorUserId), inviteId);
}

export function getInviteByToken(token: string) {
  return sharedGetInviteByToken(config, token);
}

export function acceptInvite(token: string, actorUserId: string) {
  return sharedAcceptInvite(config, token, actorUserId);
}
