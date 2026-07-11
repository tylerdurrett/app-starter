import { db, projectInvites, projectMemberships, projects, users, workspaces } from '@repo/db';
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
import { resolveProjectAndRole } from './service.js';
import type { ProjectPermission } from './permissions.js';

/** Token-metadata projection returned by getInviteByToken for the project level. */
interface ProjectInviteTokenMeta {
  id: string;
  projectId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  projectName: string;
  projectSlug: string;
  workspaceName: string;
  workspaceSlug: string;
}

interface ProjectAcceptResult {
  projectId: string;
  projectSlug: string;
}

const config: InviteLifecycleConfig<
  ProjectPermission,
  ProjectInviteTokenMeta,
  ProjectAcceptResult
> = {
  entityLabel: 'project',
  permissions: {
    list: 'project:invites:list',
    invite: 'project:members:invite',
    revoke: 'project:invites:revoke',
  },
  invites: {
    table: projectInvites,
    id: projectInvites.id,
    email: projectInvites.email,
    role: projectInvites.role,
    status: projectInvites.status,
    expiresAt: projectInvites.expiresAt,
    createdAt: projectInvites.createdAt,
    invitedByUserId: projectInvites.invitedByUserId,
    entityId: projectInvites.projectId,
    entityIdKey: 'projectId',
  },
  memberships: {
    table: projectMemberships,
    userId: projectMemberships.userId,
    entityId: projectMemberships.projectId,
    entityIdKey: 'projectId',
  },
  async selectByTokenHash(tokenHash) {
    const [invite] = await db
      .select({
        id: projectInvites.id,
        projectId: projectInvites.projectId,
        email: projectInvites.email,
        role: projectInvites.role,
        status: projectInvites.status,
        expiresAt: projectInvites.expiresAt,
        projectName: projects.name,
        projectSlug: projects.slug,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
      })
      .from(projectInvites)
      .innerJoin(projects, eq(projectInvites.projectId, projects.id))
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(eq(projectInvites.tokenHash, tokenHash));
    return invite;
  },
  // Project revoke: fetch by (id, projectId, status='pending'), throw NOT_FOUND
  // when missing-or-non-pending, then return the updated row via `.returning()`.
  async revoke(projectId, inviteId) {
    const [invite] = await db
      .select()
      .from(projectInvites)
      .where(
        and(
          eq(projectInvites.id, inviteId),
          eq(projectInvites.projectId, projectId),
          eq(projectInvites.status, 'pending'),
        ),
      );

    if (!invite) {
      throw new ServiceError('NOT_FOUND', 'Invite not found');
    }

    const [updated] = await db
      .update(projectInvites)
      .set({ status: 'revoked' })
      .where(eq(projectInvites.id, inviteId))
      .returning();

    return updated;
  },
  // Project email guard: compare the raw stored email, folding a missing user
  // into the FORBIDDEN branch (no distinct NOT_FOUND).
  async emailGuard(userId, inviteEmail) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!user || user.email !== inviteEmail) {
      throw new ServiceError('FORBIDDEN', 'This invite is for a different email address');
    }
  },
  membershipEntityId: (invite) => invite.projectId,
  buildAcceptResult: (invite) => ({
    projectId: invite.projectId,
    projectSlug: invite.projectSlug,
  }),
};

function resolveProject(
  slug: string,
  actorUserId: string,
  workspaceSlug: string,
): ResolveEntity<ProjectPermission> {
  return (permission) =>
    resolveProjectAndRole(slug, actorUserId, permission, workspaceSlug).then((r) => r.project);
}

export function listInvites(slug: string, actorUserId: string, workspaceSlug: string) {
  return sharedListInvites(config, resolveProject(slug, actorUserId, workspaceSlug));
}

export function createInvite(
  slug: string,
  actorUserId: string,
  input: { email: string; role?: 'manager' | 'member' },
  workspaceSlug: string,
) {
  return sharedCreateInvite(
    config,
    resolveProject(slug, actorUserId, workspaceSlug),
    actorUserId,
    input,
  );
}

export function revokeInvite(
  slug: string,
  actorUserId: string,
  inviteId: string,
  workspaceSlug: string,
) {
  return sharedRevokeInvite(
    config,
    resolveProject(slug, actorUserId, workspaceSlug),
    inviteId,
  ) as Promise<typeof projectInvites.$inferSelect | undefined>;
}

export function getInviteByToken(token: string) {
  return sharedGetInviteByToken(config, token);
}

export function acceptInvite(token: string, userId: string) {
  return sharedAcceptInvite(config, token, userId);
}
