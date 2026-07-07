import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../auth/require-permission.js';
import { getInviteByToken, acceptInvite } from '../projects/invites.js';

interface TokenParams {
  token: string;
}

const projectInviteRoutes: FastifyPluginAsync = async (app) => {
  // Unauthenticated: invite landing page needs metadata before login
  app.get<{ Params: TokenParams }>('/api/project-invites/:token', async (request) => {
    const { token } = request.params;
    return getInviteByToken(token);
  });

  app.post<{ Params: TokenParams }>('/api/project-invites/:token/accept', async (request) => {
    const { user } = await requireUser(request);
    const { token } = request.params;
    return acceptInvite(token, user.id);
  });
};

export default projectInviteRoutes;