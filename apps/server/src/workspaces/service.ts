import { db, workspaces, workspaceMemberships, users, projects, projectMemberships } from '@repo/db';
import { eq, and, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { slugify, ensureUniqueSlug } from './slug.js';
import { can, type WorkspaceRole, type WorkspacePermission } from './permissions.js';

import { ServiceError } from '../tenancy/index.js';
export { ServiceError };

/**
 * Lookup workspace by slug, verify actor membership, and optionally check permission.
 * Returns NOT_FOUND for both missing workspaces and non-members (avoids leaking existence).
 */
export async function resolveWorkspaceAndRole(
  slug: string,
  actorUserId: string,
  requiredPermission?: WorkspacePermission,
): Promise<{ workspace: typeof workspaces.$inferSelect; role: WorkspaceRole }> {
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      createdByUserId: workspaces.createdByUserId,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      role: workspaceMemberships.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, workspaces.id),
        eq(workspaceMemberships.userId, actorUserId),
      ),
    )
    .where(eq(workspaces.slug, slug));

  if (!row) throw new ServiceError('NOT_FOUND', 'Workspace not found');

  const role = row.role as WorkspaceRole;

  if (requiredPermission && !can(role, requiredPermission)) {
    throw new ServiceError('FORBIDDEN', `Missing permission: ${requiredPermission}`);
  }

  const { role: _role, ...workspace } = row;
  return { workspace, role };
}

export async function createWorkspace({ name, ownerUserId }: { name: string; ownerUserId: string }) {
  let baseSlug = slugify(name);
  // Fallback for names that produce an empty slug (e.g. all special chars)
  if (!baseSlug) baseSlug = `workspace-${randomUUID().slice(0, 8)}`;

  const slug = await ensureUniqueSlug(baseSlug);
  const id = randomUUID();

  const [created] = await db.transaction(async (tx) => {
    const rows = await tx.insert(workspaces).values({
      id,
      name,
      slug,
      createdByUserId: ownerUserId
    }).returning();
    await tx.insert(workspaceMemberships).values({
      id: randomUUID(),
      workspaceId: id,
      userId: ownerUserId,
      role: 'owner',
    });
    return rows;
  });

  if (!created) {
    throw new Error('createWorkspace: insert returned no rows');
  }
  return created;
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
  const { workspace } = await resolveWorkspaceAndRole(slug, actorUserId, 'workspace:members:list');

  return db
    .select({
      userId: workspaceMemberships.userId,
      role: workspaceMemberships.role,
      createdAt: workspaceMemberships.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(workspaceMemberships)
    .innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .where(eq(workspaceMemberships.workspaceId, workspace.id));
}

export async function removeMember(
  slug: string,
  actorUserId: string,
  targetUserId: string,
) {
  const { workspace, role: actorRole } = await resolveWorkspaceAndRole(
    slug,
    actorUserId,
    'workspace:members:remove',
  );

  if (actorUserId === targetUserId) {
    throw new ServiceError('BAD_REQUEST', 'Cannot remove yourself');
  }

  const [target] = await db
    .select()
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspace.id),
        eq(workspaceMemberships.userId, targetUserId),
      ),
    );

  if (!target) throw new ServiceError('NOT_FOUND', 'Member not found');

  // Manager cannot remove the owner (relational rule, not covered by permission matrix)
  if (actorRole === 'manager' && target.role === 'owner') {
    throw new ServiceError('BAD_REQUEST', 'Manager cannot remove the workspace owner');
  }

  await db.delete(workspaceMemberships).where(eq(workspaceMemberships.id, target.id));
}

/**
 * List projects in a workspace, filtered by visibility.
 * - Workspace admin (owner/manager) sees all projects
 * - Workspace member sees only projects they belong to
 */
export async function listProjectsForWorkspace(slug: string, actorUserId: string) {
  const { workspace, role } = await resolveWorkspaceAndRole(slug, actorUserId);

  // Workspace owner or manager sees all projects
  if (role === 'owner' || role === 'manager') {
    return db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        workspaceId: projects.workspaceId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.workspaceId, workspace.id))
      .orderBy(asc(projects.createdAt));
  }

  // Workspace member sees only projects they have explicit access to
  return db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      workspaceId: projects.workspaceId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      role: projectMemberships.role,
    })
    .from(projects)
    .innerJoin(
      projectMemberships,
      and(
        eq(projectMemberships.projectId, projects.id),
        eq(projectMemberships.userId, actorUserId)
      )
    )
    .where(eq(projects.workspaceId, workspace.id))
    .orderBy(asc(projects.createdAt));
}

