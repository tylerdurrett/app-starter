import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../auth/require-permission.js';
import {
  listIntegrations,
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegration,
} from '../integrations/service.js';

interface IntegrationParams {
  workspaceSlug: string;
  integrationId: string;
}

interface WorkspaceSlugParams {
  workspaceSlug: string;
}

const integrationRoutes: FastifyPluginAsync = async (app) => {
  // List integrations
  app.get<{ Params: WorkspaceSlugParams }>(
    '/api/workspaces/:workspaceSlug/integrations',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug } = request.params;
      return listIntegrations(workspaceSlug, user.id);
    },
  );

  // Create integration
  app.post<{
    Params: WorkspaceSlugParams;
    Body: {
      type: string;
      name: string;
      config: Record<string, unknown>;
    };
  }>(
    '/api/workspaces/:workspaceSlug/integrations',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug } = request.params;
      const integration = await createIntegration(workspaceSlug, user.id, request.body);
      return reply.status(201).send(integration);
    },
  );

  // Get integration
  app.get<{ Params: IntegrationParams }>(
    '/api/workspaces/:workspaceSlug/integrations/:integrationId',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, integrationId } = request.params;
      return getIntegration(workspaceSlug, integrationId, user.id);
    },
  );

  // Update integration
  app.patch<{
    Params: IntegrationParams;
    Body: {
      name?: string;
      config?: Record<string, unknown>;
    };
  }>(
    '/api/workspaces/:workspaceSlug/integrations/:integrationId',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, integrationId } = request.params;
      return updateIntegration(workspaceSlug, integrationId, user.id, request.body);
    },
  );

  // Delete integration
  app.delete<{ Params: IntegrationParams }>(
    '/api/workspaces/:workspaceSlug/integrations/:integrationId',
    async (request, reply) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, integrationId } = request.params;
      await deleteIntegration(workspaceSlug, integrationId, user.id);
      return reply.status(204).send();
    },
  );

  // Test integration
  app.post<{ Params: IntegrationParams }>(
    '/api/workspaces/:workspaceSlug/integrations/:integrationId/test',
    async (request) => {
      const { user } = await requireUser(request);
      const { workspaceSlug, integrationId } = request.params;
      return testIntegration(workspaceSlug, integrationId, user.id);
    },
  );
};

export default integrationRoutes;