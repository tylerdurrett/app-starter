import { db, projects, projectMemberships, workspaceMemberships, workspaces } from '@repo/db';
import { eq, and, getTableColumns } from 'drizzle-orm';
import { resolveEntityAndRole } from '../tenancy/index.js';
import { can, type ProjectRole, type ProjectPermission } from './permissions.js';

/**
 * Resolves project access with workspace access inherited by every project.
 *
 * 1. Direct project membership takes precedence
 * 2. Workspace owner/manager gets synthetic owner role on all projects
 * 3. Workspace member gets synthetic member role on all projects
 *
 * The initial lookup keys on the composite (workspace, slug) identity via a
 * NON-AUTHORIZING join to `workspaces` — a slug living only in a different
 * workspace therefore returns no row and surfaces as NOT_FOUND. The join is
 * authorization-free on purpose: it must not filter out a user with direct
 * project access who is not a member of the parent workspace.
 *
 * Built on the shared role-resolution skeleton: the ordered resolvers express
 * "direct membership beats workspace override", and both a missing project and
 * a no-access actor surface as NOT_FOUND (404, never 403).
 */
export async function resolveProjectWithOverride(
  projectSlug: string,
  actorUserId: string,
  requiredPermission: ProjectPermission | undefined,
  workspaceSlug: string,
): Promise<{
  project: typeof projects.$inferSelect;
  role: ProjectRole;
  viaWorkspaceOverride?: boolean;
}> {
  const { entity, role, viaOverride } = await resolveProjectAccess(
    workspaceSlug,
    projectSlug,
    actorUserId,
    requiredPermission,
  );

  const project: typeof projects.$inferSelect = {
    id: entity.id,
    name: entity.name,
    slug: entity.slug,
    workspaceId: entity.workspaceId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };

  return viaOverride
    ? { project, role, viaWorkspaceOverride: true }
    : { project, role };
}

export interface AuthorizedProject {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  createdAt: Date;
  updatedAt: Date;
  role: ProjectRole;
}

type ProjectAccessEntity = Omit<AuthorizedProject, 'role'>;

async function resolveProjectAccess(
  workspaceSlug: string,
  projectSlug: string,
  actorUserId: string,
  requiredPermission: ProjectPermission | undefined,
) {
  return resolveEntityAndRole<ProjectAccessEntity, ProjectRole, ProjectPermission>({
    lookup: async () => {
      const [project] = await db
        .select({
          ...getTableColumns(projects),
          workspaceSlug: workspaces.slug,
          workspaceName: workspaces.name,
        })
        .from(projects)
        .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .where(and(eq(workspaces.slug, workspaceSlug), eq(projects.slug, projectSlug)));
      return project;
    },
    roleResolvers: [
      // Direct project membership takes precedence over any workspace override.
      async (project) => {
        const [projectMember] = await db
          .select({ role: projectMemberships.role })
          .from(projectMemberships)
          .where(
            and(
              eq(projectMemberships.projectId, project.id),
              eq(projectMemberships.userId, actorUserId),
            ),
          );
        return projectMember ? { role: projectMember.role as ProjectRole } : undefined;
      },
      // Workspace access inherited by the project — creates no membership record.
      async (project) => {
        const [workspaceMember] = await db
          .select({ role: workspaceMemberships.role })
          .from(workspaceMemberships)
          .where(
            and(
              eq(workspaceMemberships.workspaceId, project.workspaceId),
              eq(workspaceMemberships.userId, actorUserId),
            ),
          );
        if (!workspaceMember) return undefined;

        const workspaceRole = workspaceMember.role as 'owner' | 'manager' | 'member';
        const role: ProjectRole =
          workspaceRole === 'owner' || workspaceRole === 'manager' ? 'owner' : 'member';
        return { role, viaOverride: true };
      },
    ],
    can,
    requiredPermission,
    notFoundMessage: 'Project not found',
  });
}

export async function getAuthorizedProjectBySlug(
  workspaceSlug: string,
  projectSlug: string,
  actorUserId: string,
): Promise<AuthorizedProject> {
  const { entity, role } = await resolveProjectAccess(
    workspaceSlug,
    projectSlug,
    actorUserId,
    undefined,
  );
  return { ...entity, role };
}
