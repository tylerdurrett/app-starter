import type { FastifyPluginAsync } from 'fastify';
import type { ProjectInviteMetadata } from '@repo/shared';
import { requireUser } from '../auth/require-permission.js';
import { getInviteByToken, acceptInvite } from '../projects/invites.js';

interface TokenParams {
  token: string;
}

const projectInviteRoutes: FastifyPluginAsync = async (app) => {
  // Unauthenticated: invite landing page needs metadata before login
  app.get<{ Params: TokenParams }>('/api/project-invites/:token', async (request) => {
    const { token } = request.params;
    const invite = await getInviteByToken(token);
    // Project the token-metadata row onto the shared contract: the client keys
    // the invite by `inviteId`, and internal columns (projectId) are dropped.
    const metadata: ProjectInviteMetadata = {
      inviteId: invite.id,
      email: invite.email,
      status: invite.status as ProjectInviteMetadata['status'],
      expiresAt: invite.expiresAt.toISOString(),
      projectName: invite.projectName,
      projectSlug: invite.projectSlug,
      workspaceName: invite.workspaceName,
      workspaceSlug: invite.workspaceSlug,
    };
    return metadata;
  });

  app.post<{ Params: TokenParams }>('/api/project-invites/:token/accept', async (request) => {
    const { user } = await requireUser(request);
    const { token } = request.params;
    return acceptInvite(token, user.id);
  });
};

export default projectInviteRoutes;
