import {
  db,
  projects,
  projectMemberships,
  users,
  workspaces,
  workspaceMemberships,
} from '@repo/db';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { slugify, ensureUniqueSlug } from './slug.js';
import { type ProjectRole, type ProjectPermission } from './permissions.js';
import { resolveProjectWithOverride } from './resolver.js';

export class ServiceError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'BAD_REQUEST',
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Lookup project by slug, verify actor membership, and optionally check permission.
 * Now uses the resolver with workspace admin override.
 */
export async function resolveProjectAndRole(
  slug: string,
  actorUserId: string,
  requiredPermission?: ProjectPermission,
): Promise<{ project: typeof projects.$inferSelect; role: ProjectRole }> {
  const result = await resolveProjectWithOverride(slug, actorUserId, requiredPermission);
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
  let baseSlug = slugify(name);
  // Fallback for names that produce an empty slug (e.g. all special chars)
  if (!baseSlug) baseSlug = `project-${randomUUID().slice(0, 8)}`;

  const slug = await ensureUniqueSlug(baseSlug, workspaceId);
  const id = randomUUID();

  const [created] = await db.transaction(async (tx) => {
    const rows = await tx.insert(projects).values({ id, name, slug, workspaceId }).returning();
    await tx.insert(projectMemberships).values({
      id: randomUUID(),
      projectId: id,
      userId: ownerUserId,
      role: 'owner',
    });
    return rows;
  });

  return created;
}

export async function listProjectsForUser(userId: string) {
  const accessibleProjects = await listAccessibleProjectsForUser(userId);

  return accessibleProjects
    .map(({ workspace, access: _access, ...project }) => ({
      ...project,
      workspaceId: workspace.id,
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

export async function getProjectBySlug(slug: string, actorUserId: string) {
  return resolveProjectAndRole(slug, actorUserId);
}

export async function updateProject(
  slug: string,
  actorUserId: string,
  { name }: { name?: string },
) {
  const { project } = await resolveProjectAndRole(slug, actorUserId, 'project:edit');

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
) {
  const { project } = await resolveProjectAndRole(slug, actorUserId, 'project:delete');

  if (confirmation !== `Delete ${project.name}`) {
    throw new ServiceError('BAD_REQUEST', 'Confirmation text does not match');
  }

  await db.delete(projects).where(eq(projects.id, project.id));
}

export async function listMembers(slug: string, actorUserId: string) {
  const { project } = await resolveProjectAndRole(slug, actorUserId, 'project:members:list');

  return db
    .select({
      userId: projectMemberships.userId,
      role: projectMemberships.role,
      createdAt: projectMemberships.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(projectMemberships)
    .innerJoin(users, eq(projectMemberships.userId, users.id))
    .where(eq(projectMemberships.projectId, project.id));
}

export async function removeMember(slug: string, actorUserId: string, targetUserId: string) {
  const { project } = await resolveProjectAndRole(slug, actorUserId, 'project:members:remove');

  if (targetUserId === actorUserId) {
    throw new ServiceError('CONFLICT', 'You cannot remove yourself from the project');
  }

  // Check the target's current role
  const [target] = await db
    .select({ role: projectMemberships.role })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, project.id),
        eq(projectMemberships.userId, targetUserId),
      ),
    );

  if (!target) {
    throw new ServiceError('NOT_FOUND', 'Member not found');
  }

  await db
    .delete(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, project.id),
        eq(projectMemberships.userId, targetUserId),
      ),
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
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      role: projectMemberships.role,
    })
    .from(projects)
    .innerJoin(
      projectMemberships,
      and(eq(projectMemberships.projectId, projects.id), eq(projectMemberships.userId, userId)),
    )
    .where(eq(projects.id, user.lastActiveProjectId));

  return membership || null;
}
