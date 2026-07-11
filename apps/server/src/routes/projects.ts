import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { requireUser } from '../auth/require-permission.js';
import {
  createProject,
  listProjectsForUser,
  getProjectBySlug,
  updateProject,
  deleteProject,
  listMembers,
  removeMember,
  setLastActiveProject,
  getLastActiveProject,
  ServiceError,
} from '../projects/service.js';
import { listInvites, createInvite, revokeInvite } from '../projects/invites.js';
import { resolveWorkspaceAndRole } from '../workspaces/service.js';
import { db, workspaces } from '@repo/db';
import { eq } from 'drizzle-orm';
import type { ProjectInvite, ProjectInviteCreateResult } from '@repo/shared';

interface ProjectSlugParams {
  workspaceSlug: string;
  projectSlug: string;
}

interface ProjectSlugUserIdParams {
  workspaceSlug: string;
  projectSlug: string;
  userId: string;
}

interface ProjectSlugInviteIdParams {
  workspaceSlug: string;
  projectSlug: string;
  inviteId: string;
}

const projectRoutes: FastifyPluginAsync = async (app) => {
  // --- Project CRUD ---

  app.post<{ Body: { workspaceSlug: string; name: string } }>('/api/projects', async (request, reply) => {
    const { user } = await requireUser(request);
    // Verify user has permission to create projects in the workspace
    const { workspace } = await resolveWorkspaceAndRole(request.body.workspaceSlug, user.id, 'projects:create');
    const project = await createProject({
      name: request.body.name,
      workspaceId: workspace.id,
      ownerUserId: user.id,
    });
    // Enrich with workspace slug/name so the reply satisfies the shared Project
    // contract (the raw project row carries only workspaceId).
    return reply.status(201).send({
      ...project,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
    });
  });

  app.get('/api/projects', async (request) => {
    const { user } = await requireUser(request);
    return listProjectsForUser(user.id);
  });

  // Register last-active BEFORE :projectSlug so Fastify doesn't treat "last-active" as a slug param
  app.get('/api/projects/last-active', async (request) => {
    const { user } = await requireUser(request);
    return getLastActiveProject(user.id);
  });

  app.get<{ Params: ProjectSlugParams }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug } = request.params;
      const { project, role } = await getProjectBySlug(projectSlug, user.id, workspaceSlug);
      // Fire-and-forget: failure to update last-active preference is non-critical
      setLastActiveProject(user.id, project.id).catch(() => {});
      // Enrich with workspace slug/name so the client can render workspace context
      // on project pages (needed by 4.1 switcher, including project-only access)
      const [workspace] = await db
        .select({ slug: workspaces.slug, name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, project.workspaceId));
      // The project's workspaceId FK guarantees this row exists; a missing row
      // is an invariant violation, so fail loudly rather than emit null fields.
      if (!workspace) {
        throw new ServiceError('NOT_FOUND', 'Workspace not found for project');
      }
      return {
        ...project,
        role,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
      };
    },
  );

  app.patch<{ Params: ProjectSlugParams; Body: { name?: string } }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug } = request.params;
      const project = await updateProject(
        projectSlug,
        user.id,
        {
          name: request.body.name,
        },
        workspaceSlug,
      );
      // resolveProjectAndRole (inside updateProject) already verified the row
      // exists; a missing return means it was deleted concurrently.
      if (!project) {
        throw new ServiceError('NOT_FOUND', 'Project not found');
      }
      // Enrich with workspace slug/name so the reply satisfies the shared
      // Project contract (the raw updated row carries only workspaceId).
      const [workspace] = await db
        .select({ slug: workspaces.slug, name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, project.workspaceId));
      if (!workspace) {
        throw new ServiceError('NOT_FOUND', 'Workspace not found for project');
      }
      return {
        ...project,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
      };
    },
  );

  app.delete<{ Params: ProjectSlugParams; Body: { confirmation: string } }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug } = request.params;
      await deleteProject(
        projectSlug,
        user.id,
        { confirmation: request.body.confirmation },
        workspaceSlug,
      );
      return reply.status(204).send();
    },
  );

  // --- Members ---

  app.get<{ Params: ProjectSlugParams }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug/members',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug } = request.params;
      return listMembers(projectSlug, user.id, workspaceSlug);
    },
  );

  app.delete<{ Params: ProjectSlugUserIdParams }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug/members/:userId',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug, userId } = request.params;
      await removeMember(projectSlug, user.id, userId, workspaceSlug);
      return reply.status(204).send();
    },
  );

  // --- Invites (project-scoped) ---

  app.get<{ Params: ProjectSlugParams }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug/invites',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug } = request.params;
      return listInvites(projectSlug, user.id, workspaceSlug);
    },
  );

  app.post<{ Params: ProjectSlugParams; Body: { email: string; role?: 'manager' | 'member' } }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug/invites',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug } = request.params;
      const { invite, token } = await createInvite(
        projectSlug,
        user.id,
        {
          email: request.body.email,
          role: request.body.role,
        },
        workspaceSlug,
      );
      const inviteUrl = `${config.webOrigin}/invite/project/${token}`;
      // The shared invite lifecycle types its tables as bare PgTable (#66), so
      // the returned row is loosely typed; narrow it to the columns we project.
      const row = invite as unknown as {
        id: string;
        email: string;
        role: string;
        status: string;
        expiresAt: Date;
        createdAt: Date;
      };
      // Project onto the shared contract: the raw row omits invitedByName (the
      // actor created it) and carries internal columns (tokenHash, FKs) that
      // must not leak to the client.
      const result: ProjectInviteCreateResult = {
        invite: {
          id: row.id,
          email: row.email,
          role: row.role as ProjectInvite['role'],
          status: row.status as ProjectInvite['status'],
          expiresAt: row.expiresAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          invitedByName: user.name,
        },
        inviteUrl,
      };
      return reply.status(201).send(result);
    },
  );

  app.post<{ Params: ProjectSlugInviteIdParams }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug/invites/:inviteId/revoke',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug, inviteId } = request.params;
      await revokeInvite(projectSlug, user.id, inviteId, workspaceSlug);
      return reply.status(204).send();
    },
  );
};

export default projectRoutes;