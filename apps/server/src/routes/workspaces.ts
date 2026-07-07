import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { requireUser } from '../auth/require-permission.js';
import {
  createWorkspace,
  listWorkspacesForUser,
  getWorkspaceBySlug,
  updateWorkspace,
  deleteWorkspace,
  listMembers,
  removeMember,
  listProjectsForWorkspace,
} from '../workspaces/service.js';
import { listInvites, createInvite, revokeInvite } from '../workspaces/invites.js';

interface WorkspaceSlugParams {
  workspaceSlug: string;
}

interface WorkspaceSlugUserIdParams {
  workspaceSlug: string;
  userId: string;
}

interface WorkspaceSlugInviteIdParams {
  workspaceSlug: string;
  inviteId: string;
}

const workspaceRoutes: FastifyPluginAsync = async (app) => {
  // --- Workspace CRUD ---

  app.post<{ Body: { name: string } }>('/api/workspaces', async (request, reply) => {
    const { user } = await requireUser(request);
    const workspace = await createWorkspace({ name: request.body.name, ownerUserId: user.id });
    return reply.status(201).send(workspace);
  });

  app.get('/api/workspaces', async (request) => {
    const { user } = await requireUser(request);
    return listWorkspacesForUser(user.id);
  });

  app.get<{ Params: WorkspaceSlugParams }>('/api/workspaces/:workspaceSlug', async (request) => {
    const { user } = await requireUser(request);
    const { workspaceSlug } = request.params;
    const { workspace, role } = await getWorkspaceBySlug(workspaceSlug, user.id);
    return { ...workspace, role };
  });

  app.patch<{ Params: WorkspaceSlugParams; Body: { name: string } }>(
    '/api/workspaces/:workspaceSlug',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug } = request.params;
      return updateWorkspace(workspaceSlug, user.id, { name: request.body.name });
    },
  );

  app.delete<{ Params: WorkspaceSlugParams; Body: { confirmation: string } }>(
    '/api/workspaces/:workspaceSlug',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug } = request.params;
      await deleteWorkspace(workspaceSlug, user.id, { confirmation: request.body.confirmation });
      return reply.status(204).send();
    },
  );

  // --- Members ---

  app.get<{ Params: WorkspaceSlugParams }>('/api/workspaces/:workspaceSlug/members', async (request) => {
    const { user } = await requireUser(request);
    const { workspaceSlug } = request.params;
    return listMembers(workspaceSlug, user.id);
  });

  app.delete<{ Params: WorkspaceSlugUserIdParams }>(
    '/api/workspaces/:workspaceSlug/members/:userId',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, userId } = request.params;
      await removeMember(workspaceSlug, user.id, userId);
      return reply.status(204).send();
    },
  );

  // --- Invites ---

  app.get<{ Params: WorkspaceSlugParams }>('/api/workspaces/:workspaceSlug/invites', async (request) => {
    const { user } = await requireUser(request);
    const { workspaceSlug } = request.params;
    return listInvites(workspaceSlug, user.id);
  });

  app.post<{ Params: WorkspaceSlugParams; Body: { email: string; role: 'manager' | 'member' } }>(
    '/api/workspaces/:workspaceSlug/invites',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug } = request.params;
      const { invite, token } = await createInvite(workspaceSlug, user.id, {
        email: request.body.email,
        role: request.body.role
      });
      const inviteUrl = `${config.webOrigin}/invite/workspace/${token}`;
      return reply.status(201).send({ invite, inviteUrl });
    },
  );

  app.post<{ Params: WorkspaceSlugInviteIdParams }>(
    '/api/workspaces/:workspaceSlug/invites/:inviteId/revoke',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, inviteId } = request.params;
      await revokeInvite(workspaceSlug, user.id, inviteId);
      return reply.status(204).send();
    },
  );

  // --- Projects ---

  app.get<{ Params: WorkspaceSlugParams }>('/api/workspaces/:workspaceSlug/projects', async (request) => {
    const { user } = await requireUser(request);
    const { workspaceSlug } = request.params;
    return listProjectsForWorkspace(workspaceSlug, user.id);
  });
};

export default workspaceRoutes;