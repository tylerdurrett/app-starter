import type { FastifyPluginAsync } from 'fastify';
import type { McpConnector } from '@repo/shared';
import { config } from '../config.js';
import { requireUser } from '../auth/require-permission.js';

const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/me/mcp-connector', async (request) => {
    await requireUser(request);
    // Annotated against the shared contract so a drifting field breaks the build.
    const reply: McpConnector = { url: config.mcpCanonicalUrl };
    return reply;
  });
};

export default meRoutes;
