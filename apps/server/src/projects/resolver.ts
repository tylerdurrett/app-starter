import { db, projects, projectMemberships, workspaceMemberships } from '@repo/db';
import { eq, and } from 'drizzle-orm';
import { ServiceError } from './service.js';
import { can, type ProjectRole, type ProjectPermission } from './permissions.js';

/**
 * Resolves project access with workspace access inherited by every project.
 *
 * 1. Direct project membership takes precedence
 * 2. Workspace owner/manager gets synthetic owner role on all projects
 * 3. Workspace member gets synthetic member role on all projects
 */
export async function resolveProjectWithOverride(
  projectSlug: string,
  actorUserId: string,
  requiredPermission?: ProjectPermission,
): Promise<{
  project: typeof projects.$inferSelect;
  role: ProjectRole;
  viaWorkspaceOverride?: boolean;
}> {
  // First, get the project
  const [project] = await db.select().from(projects).where(eq(projects.slug, projectSlug));

  if (!project) {
    throw new ServiceError('NOT_FOUND', 'Project not found');
  }

  // Check for direct project membership
  const [projectMember] = await db
    .select({ role: projectMemberships.role })
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, project.id), eq(projectMemberships.userId, actorUserId)),
    );

  if (projectMember) {
    const role = projectMember.role as ProjectRole;

    if (requiredPermission && !can(role, requiredPermission)) {
      throw new ServiceError('FORBIDDEN', `Missing permission: ${requiredPermission}`);
    }

    return { project, role };
  }

  // Check for workspace access inherited by the project
  const [workspaceMember] = await db
    .select({ role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, project.workspaceId),
        eq(workspaceMemberships.userId, actorUserId),
      ),
    );

  if (workspaceMember) {
    const workspaceRole = workspaceMember.role as 'owner' | 'manager' | 'member';

    const role: ProjectRole =
      workspaceRole === 'owner' || workspaceRole === 'manager' ? 'owner' : 'member';

    if (requiredPermission && !can(role, requiredPermission)) {
      throw new ServiceError('FORBIDDEN', `Missing permission: ${requiredPermission}`);
    }

    return { project, role, viaWorkspaceOverride: true };
  }

  // No access
  throw new ServiceError('NOT_FOUND', 'Project not found');
}
