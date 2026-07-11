import {
  db,
  projects,
  projectMemberships,
  users,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { ensureUniqueSlug } from './slug.js';
import { type ProjectRole, type ProjectPermission } from './permissions.js';
import { findAuthorizedProjectById, resolveProjectWithOverride } from './resolver.js';
import {
  ServiceError,
  createWithOwnerMembership,
  listMembers as sharedListMembers,
  removeMember as sharedRemoveMember,
  type MemberCrudConfig,
  type ResolveMemberEntity,
} from '../tenancy/index.js';

export { ServiceError };

/** Shared member-CRUD config for the project level (no owner guard). */
const memberConfig: MemberCrudConfig<ProjectPermission> = {
  permissions: { list: 'project:members:list', remove: 'project:members:remove' },
  memberships: {
    table: projectMemberships,
    userId: projectMemberships.userId,
    role: projectMemberships.role,
    createdAt: projectMemberships.createdAt,
    entityId: projectMemberships.projectId,
  },
  selfRemovalError: { code: 'CONFLICT', message: 'You cannot remove yourself from the project' },
};

function resolveProjectMember(
  slug: string,
  actorUserId: string,
  workspaceSlug: string,
): ResolveMemberEntity<ProjectPermission> {
  return (permission) =>
    resolveProjectAndRole(slug, actorUserId, permission, workspaceSlug).then((r) => ({
      id: r.project.id,
      role: r.role,
    }));
}

/**
 * Lookup project by slug, verify actor membership, and optionally check permission.
 * Now uses the resolver with workspace admin override.
 */
export async function resolveProjectAndRole(
  slug: string,
  actorUserId: string,
  requiredPermission: ProjectPermission | undefined,
  workspaceSlug: string,
): Promise<{ project: typeof projects.$inferSelect; role: ProjectRole }> {
  const result = await resolveProjectWithOverride(
    slug,
    actorUserId,
    requiredPermission,
    workspaceSlug,
  );
  return { project: result.project, role: result.role };
}

export async function createProject({
  name,
  workspaceId,
  ownerUserId,
}: {
  name: string;
  workspaceId: string;
  ownerUserId: string;
}) {
  // Retry to close the check-then-insert race: ensureUniqueSlug runs in a
  // SELECT separate from the INSERT, so two concurrent creations in the same
  // workspace can compute the same suffix and collide on the
  // (workspace_id, slug) unique constraint. On that specific violation we
  // recompute the slug (a fresh SELECT now sees the winner's row) and retry.
  const MAX_ATTEMPTS = 5;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await createWithOwnerMembership<typeof projects.$inferSelect>({
        name,
        ownerUserId,
        slugFallbackPrefix: 'project',
        ensureUniqueSlug: (baseSlug) => ensureUniqueSlug(baseSlug, workspaceId),
        entity: { table: projects, extraFields: { workspaceId } },
        memberships: { table: projectMemberships, entityIdKey: 'projectId' },
      });
    } catch (err) {
      if (isSlugUniqueViolation(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * True only for the projects (workspace_id, slug) unique violation — the race
 * we retry. Any other error (including the projectMemberships insert) must not
 * be swallowed. Drizzle wraps the driver error in a DrizzleQueryError, so the
 * postgres.js fields (code, constraint_name) live on the `cause` chain, not the
 * top-level error.
 */
function isSlugUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  while (typeof current === 'object' && current !== null) {
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505' && e.constraint_name === 'projects_workspace_id_slug_unique') {
      return true;
    }
    current = e.cause;
  }
  return false;
}

export async function updateProject(
  slug: string,
  actorUserId: string,
  { name }: { name?: string },
  workspaceSlug: string,
) {
  const { project } = await resolveProjectAndRole(slug, actorUserId, 'project:edit', workspaceSlug);

  const updateData: { updatedAt: Date; name?: string } = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;

  const [updated] = await db
    .update(projects)
    .set(updateData)
    .where(eq(projects.id, project.id))
    .returning();

  return updated;
}

export async function deleteProject(
  slug: string,
  actorUserId: string,
  { confirmation }: { confirmation: string },
  workspaceSlug: string,
) {
  const { project } = await resolveProjectAndRole(
    slug,
    actorUserId,
    'project:delete',
    workspaceSlug,
  );

  if (confirmation !== `Delete ${project.name}`) {
    throw new ServiceError('BAD_REQUEST', 'Confirmation text does not match');
  }

  await db.delete(projects).where(eq(projects.id, project.id));
}

export async function listMembers(slug: string, actorUserId: string, workspaceSlug: string) {
  return sharedListMembers(memberConfig, resolveProjectMember(slug, actorUserId, workspaceSlug));
}

export async function removeMember(
  slug: string,
  actorUserId: string,
  targetUserId: string,
  workspaceSlug: string,
) {
  return sharedRemoveMember(
    memberConfig,
    resolveProjectMember(slug, actorUserId, workspaceSlug),
    actorUserId,
    targetUserId,
  );
}

export async function setLastActiveProject(userId: string, projectId: string) {
  await db.update(users).set({ lastActiveProjectId: projectId }).where(eq(users.id, userId));
}

export async function getLastActiveProject(userId: string) {
  const [user] = await db
    .select({ lastActiveProjectId: users.lastActiveProjectId })
    .from(users)
    .where(eq(users.id, userId));

  if (!user?.lastActiveProjectId) return null;
  return findAuthorizedProjectById(user.lastActiveProjectId, userId);
}
