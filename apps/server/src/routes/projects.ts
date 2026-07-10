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
} from '../projects/service.js';
import { listInvites, createInvite, revokeInvite } from '../projects/invites.js';
import { resolveWorkspaceAndRole } from '../workspaces/service.js';
import { db, workspaces } from '@repo/db';
import { eq } from 'drizzle-orm';

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
    return reply.status(201).send(project);
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
      return {
        ...project,
        role,
        workspaceSlug: workspace?.slug ?? null,
        workspaceName: workspace?.name ?? null,
      };
    },
  );

  app.patch<{ Params: ProjectSlugParams; Body: { name?: string } }>(
    '/api/workspaces/:workspaceSlug/projects/:projectSlug',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, projectSlug } = request.params;
      return updateProject(
        projectSlug,
        user.id,
        {
          name: request.body.name,
        },
        workspaceSlug,
      );
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
      return reply.status(201).send({ invite, inviteUrl });
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