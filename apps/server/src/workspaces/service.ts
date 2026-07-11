import { db, workspaces, workspaceMemberships } from '@repo/db';
import { eq, and, asc } from 'drizzle-orm';
import { ensureUniqueSlug } from './slug.js';
import { can, type WorkspaceRole, type WorkspacePermission } from './permissions.js';

import {
  ServiceError,
  resolveEntityAndRole,
  createWithOwnerMembership,
  listMembers as sharedListMembers,
  removeMember as sharedRemoveMember,
  type MemberCrudConfig,
  type ResolveMemberEntity,
} from '../tenancy/index.js';
export { ServiceError };

/** Shared member-CRUD config for the workspace level. */
const memberConfig: MemberCrudConfig<WorkspacePermission> = {
  permissions: { list: 'workspace:members:list', remove: 'workspace:members:remove' },
  memberships: {
    table: workspaceMemberships,
    userId: workspaceMemberships.userId,
    role: workspaceMemberships.role,
    createdAt: workspaceMemberships.createdAt,
    entityId: workspaceMemberships.workspaceId,
  },
  selfRemovalError: { code: 'BAD_REQUEST', message: 'Cannot remove yourself' },
  // Manager cannot remove the owner (relational rule, not covered by permission matrix)
  ownerGuard(actorRole, targetRole) {
    if (actorRole === 'manager' && targetRole === 'owner') {
      throw new ServiceError('BAD_REQUEST', 'Manager cannot remove the workspace owner');
    }
  },
};

function resolveWorkspaceMember(
  slug: string,
  actorUserId: string,
): ResolveMemberEntity<WorkspacePermission> {
  return (permission) =>
    resolveWorkspaceAndRole(slug, actorUserId, permission).then((r) => ({
      id: r.workspace.id,
      role: r.role,
    }));
}

/**
 * Lookup workspace by slug, verify actor membership, and optionally check permission.
 * Returns NOT_FOUND for both missing workspaces and non-members (avoids leaking existence).
 *
 * Built on the shared role-resolution skeleton with a single resolver: direct
 * workspace membership. Missing workspace (lookup) and non-member (no resolver
 * match) both surface as NOT_FOUND.
 */
export async function resolveWorkspaceAndRole(
  slug: string,
  actorUserId: string,
  requiredPermission?: WorkspacePermission,
): Promise<{ workspace: typeof workspaces.$inferSelect; role: WorkspaceRole }> {
  const { entity, role } = await resolveEntityAndRole<
    typeof workspaces.$inferSelect,
    WorkspaceRole,
    WorkspacePermission
  >({
    lookup: async () => {
      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
      return workspace;
    },
    roleResolvers: [
      async (workspace) => {
        const [membership] = await db
          .select({ role: workspaceMemberships.role })
          .from(workspaceMemberships)
          .where(
            and(
              eq(workspaceMemberships.workspaceId, workspace.id),
              eq(workspaceMemberships.userId, actorUserId),
            ),
          );
        return membership ? { role: membership.role as WorkspaceRole } : undefined;
      },
    ],
    can,
    requiredPermission,
    notFoundMessage: 'Workspace not found',
  });

  return { workspace: entity, role };
}

export async function createWorkspace({ name, ownerUserId }: { name: string; ownerUserId: string }) {
  return createWithOwnerMembership<typeof workspaces.$inferSelect>({
    name,
    ownerUserId,
    slugFallbackPrefix: 'workspace',
    ensureUniqueSlug: (baseSlug) => ensureUniqueSlug(baseSlug),
    entity: { table: workspaces, extraFields: { createdByUserId: ownerUserId } },
    memberships: { table: workspaceMemberships, entityIdKey: 'workspaceId' },
  });
}

export async function listWorkspacesForUser(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

export async function getWorkspaceBySlug(slug: string, actorUserId: string) {
  return resolveWorkspaceAndRole(slug, actorUserId);
}

export async function updateWorkspace(
  slug: string,
  actorUserId: string,
  { name }: { name: string },
) {
  const { workspace } = await resolveWorkspaceAndRole(slug, actorUserId, 'workspace:edit');

  const [updated] = await db
    .update(workspaces)
    .set({ name, updatedAt: new Date() })
    .where(eq(workspaces.id, workspace.id))
    .returning();

  return updated;
}

export async function deleteWorkspace(
  slug: string,
  actorUserId: string,
  { confirmation }: { confirmation: string },
) {
  const { workspace } = await resolveWorkspaceAndRole(slug, actorUserId, 'workspace:delete');

  if (confirmation !== `Delete ${workspace.name}`) {
    throw new ServiceError('BAD_REQUEST', 'Confirmation text does not match');
  }

  await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
}

export async function listMembers(slug: string, actorUserId: string) {
  return sharedListMembers(memberConfig, resolveWorkspaceMember(slug, actorUserId));
}

export async function removeMember(slug: string, actorUserId: string, targetUserId: string) {
  return sharedRemoveMember(
    memberConfig,
    resolveWorkspaceMember(slug, actorUserId),
    actorUserId,
    targetUserId,
  );
}

