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

const authorizedProjectColumns = {
  id: projects.id,
  name: projects.name,
  slug: projects.slug,
  workspaceId: projects.workspaceId,
  workspaceSlug: workspaces.slug,
  workspaceName: workspaces.name,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

function projectRoleFromWorkspaceRole(workspaceRole: string): ProjectRole {
  return workspaceRole === 'owner' || workspaceRole === 'manager' ? 'owner' : 'member';
}

async function findDirectProjectRole(
  projectId: string,
  actorUserId: string,
): Promise<ProjectRole | undefined> {
  const [membership] = await db
    .select({ role: projectMemberships.role })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.userId, actorUserId),
      ),
    );
  return membership?.role as ProjectRole | undefined;
}

async function findWorkspaceProjectRole(
  workspaceId: string,
  actorUserId: string,
): Promise<ProjectRole | undefined> {
  const [membership] = await db
    .select({ role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, actorUserId),
      ),
    );
  return membership ? projectRoleFromWorkspaceRole(membership.role) : undefined;
}

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
        const role = await findDirectProjectRole(project.id, actorUserId);
        return role ? { role } : undefined;
      },
      // Workspace access inherited by the project — creates no membership record.
      async (project) => {
        const role = await findWorkspaceProjectRole(project.workspaceId, actorUserId);
        return role ? { role, viaOverride: true } : undefined;
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

export async function findAuthorizedProjectById(
  projectId: string,
  actorUserId: string,
): Promise<AuthorizedProject | null> {
  const [project] = await db
    .select(authorizedProjectColumns)
    .from(projects)
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(eq(projects.id, projectId));
  if (!project) return null;

  const directRole = await findDirectProjectRole(project.id, actorUserId);
  if (directRole) return { ...project, role: directRole };

  const workspaceRole = await findWorkspaceProjectRole(project.workspaceId, actorUserId);
  return workspaceRole ? { ...project, role: workspaceRole } : null;
}

export async function listAuthorizedProjectsForUser(
  actorUserId: string,
  options: { workspaceSlug?: string } = {},
): Promise<AuthorizedProject[]> {
  const directWhere = options.workspaceSlug
    ? and(eq(projectMemberships.userId, actorUserId), eq(workspaces.slug, options.workspaceSlug))
    : eq(projectMemberships.userId, actorUserId);
  const directProjects = await db
    .select({ ...authorizedProjectColumns, role: projectMemberships.role })
    .from(projectMemberships)
    .innerJoin(projects, eq(projectMemberships.projectId, projects.id))
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(directWhere);

  const workspaceWhere = options.workspaceSlug
    ? and(eq(workspaceMemberships.userId, actorUserId), eq(workspaces.slug, options.workspaceSlug))
    : eq(workspaceMemberships.userId, actorUserId);
  const workspaceProjects = await db
    .select({ ...authorizedProjectColumns, workspaceRole: workspaceMemberships.role })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .innerJoin(projects, eq(projects.workspaceId, workspaces.id))
    .where(workspaceWhere);

  const projectsById = new Map<string, AuthorizedProject>();
  for (const project of directProjects) {
    projectsById.set(project.id, { ...project, role: project.role as ProjectRole });
  }
  for (const project of workspaceProjects) {
    if (projectsById.has(project.id)) continue;
    const { workspaceRole, ...authorizedProject } = project;
    projectsById.set(project.id, {
      ...authorizedProject,
      role: projectRoleFromWorkspaceRole(workspaceRole),
    });
  }

  return [...projectsById.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}
