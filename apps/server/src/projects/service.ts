import {
  db,
  projects,
  projectMemberships,
  users,
  workspaces,
  workspaceMemberships,
} from '@repo/db';
import { eq, and } from 'drizzle-orm';
import { ensureUniqueSlug } from './slug.js';
import { type ProjectRole, type ProjectPermission } from './permissions.js';
import { resolveProjectWithOverride } from './resolver.js';
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

export async function listProjectsForUser(userId: string) {
  const accessibleProjects = await listAccessibleProjectsForUser(userId);

  return accessibleProjects
    .map(({ workspace, access: _access, ...project }) => ({
      ...project,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export interface AccessibleProject {
  id: string;
  name: string;
  slug: string;
  role: ProjectRole;
  access: 'project_membership' | 'workspace_admin' | 'workspace_member';
  createdAt: Date;
  updatedAt: Date;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
}

interface AccessibleProjectRow extends AccessibleProject {
  workspaceCreatedAt: Date;
}

/**
 * List every project the user can read through workspace or project access.
 * Direct project membership keeps the same precedence as
 * resolveProjectWithOverride().
 */
export async function listAccessibleProjectsForUser(
  userId: string,
  opts: { workspaceSlug?: string } = {},
): Promise<AccessibleProject[]> {
  const directWhere = opts.workspaceSlug
    ? and(eq(projectMemberships.userId, userId), eq(workspaces.slug, opts.workspaceSlug))
    : eq(projectMemberships.userId, userId);

  const directProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      role: projectMemberships.role,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      workspaceCreatedAt: workspaces.createdAt,
    })
    .from(projectMemberships)
    .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(directWhere);

  const workspaceWhere = opts.workspaceSlug
    ? and(eq(workspaceMemberships.userId, userId), eq(workspaces.slug, opts.workspaceSlug))
    : eq(workspaceMemberships.userId, userId);

  const workspaceProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      workspaceRole: workspaceMemberships.role,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      workspaceCreatedAt: workspaces.createdAt,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .innerJoin(projects, eq(projects.workspaceId, workspaces.id))
    .where(workspaceWhere);

  const rowsByProjectId = new Map<string, AccessibleProjectRow>();

  for (const project of directProjects) {
    rowsByProjectId.set(project.id, {
      id: project.id,
      name: project.name,
      slug: project.slug,
      role: project.role as ProjectRole,
      access: 'project_membership',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      workspaceCreatedAt: project.workspaceCreatedAt,
      workspace: {
        id: project.workspaceId,
        name: project.workspaceName,
        slug: project.workspaceSlug,
      },
    });
  }

  for (const project of workspaceProjects) {
    if (rowsByProjectId.has(project.id)) continue;
    const hasAdminAccess = project.workspaceRole === 'owner' || project.workspaceRole === 'manager';
    rowsByProjectId.set(project.id, {
      id: project.id,
      name: project.name,
      slug: project.slug,
      role: hasAdminAccess ? 'owner' : 'member',
      access: hasAdminAccess ? 'workspace_admin' : 'workspace_member',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      workspaceCreatedAt: project.workspaceCreatedAt,
      workspace: {
        id: project.workspaceId,
        name: project.workspaceName,
        slug: project.workspaceSlug,
      },
    });
  }

  return [...rowsByProjectId.values()]
    .sort(
      (a, b) =>
        a.workspaceCreatedAt.getTime() - b.workspaceCreatedAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map(({ workspaceCreatedAt: _workspaceCreatedAt, ...project }) => project);
}

export async function getProjectBySlug(slug: string, actorUserId: string, workspaceSlug: string) {
  return resolveProjectAndRole(slug, actorUserId, undefined, workspaceSlug);
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

  // Check if the user still has access to that project
  const [membership] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      workspaceId: projects.workspaceId,
      workspaceSlug: workspaces.slug,
      workspaceName: workspaces.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      role: projectMemberships.role,
    })
    .from(projects)
    .innerJoin(
      projectMemberships,
      and(eq(projectMemberships.projectId, projects.id), eq(projectMemberships.userId, userId)),
    )
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(eq(projects.id, user.lastActiveProjectId));

  return membership || null;
}
