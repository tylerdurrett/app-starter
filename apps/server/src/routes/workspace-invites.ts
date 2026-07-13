import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../auth/require-permission.js';
import { getInviteByToken, acceptInvite } from '../workspaces/invites.js';

interface TokenParams {
  token: string;
}

const workspaceInviteRoutes: FastifyPluginAsync = async (app) => {
  // Unauthenticated: invite landing page needs metadata before login
  app.get<{ Params: TokenParams }>('/api/workspace-invites/:token', async (request) => {
    const { token } = request.params;
    return getInviteByToken(token);
  });

  app.post<{ Params: TokenParams }>('/api/workspace-invites/:token/accept', async (request) => {
    const { user } = await requireUser(request);
    const { token } = request.params;
    return acceptInvite(token, user.id);
  });
};

export default workspaceInviteRoutes;
