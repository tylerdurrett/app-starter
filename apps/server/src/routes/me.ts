import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { requireUser } from '../auth/require-permission.js';

const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/me/mcp-connector', async (request) => {
    await requireUser(request);
    return { url: config.mcpCanonicalUrl };
  });
};

export default meRoutes;
