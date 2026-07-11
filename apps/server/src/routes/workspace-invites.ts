import type { FastifyPluginAsync } from 'fastify';
import type { WorkspaceInviteMetadata } from '@repo/shared';
import { requireUser } from '../auth/require-permission.js';
import { getInviteByToken, acceptInvite } from '../workspaces/invites.js';

interface TokenParams {
  token: string;
}

const workspaceInviteRoutes: FastifyPluginAsync = async (app) => {
  // Unauthenticated: invite landing page needs metadata before login
  app.get<{ Params: TokenParams }>('/api/workspace-invites/:token', async (request) => {
    const { token } = request.params;
    const invite = await getInviteByToken(token);
    // Project the token-metadata row onto the shared contract: the client keys
    // the invite by `inviteId`, and internal columns (workspaceId) are dropped.
    const metadata: WorkspaceInviteMetadata = {
      inviteId: invite.id,
      email: invite.email,
      status: invite.status as WorkspaceInviteMetadata['status'],
      expiresAt: invite.expiresAt.toISOString(),
      workspaceName: invite.workspaceName,
      workspaceSlug: invite.workspaceSlug,
    };
    return metadata;
  });

  app.post<{ Params: TokenParams }>('/api/workspace-invites/:token/accept', async (request) => {
    const { user } = await requireUser(request);
    const { token } = request.params;
    return acceptInvite(token, user.id);
  });
};

export default workspaceInviteRoutes;