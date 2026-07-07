import type { FastifyPluginAsync } from 'fastify';

export interface DbProbe {
  ping: () => Promise<void>;
}

interface HealthRouteOpts {
  dbProbe: DbProbe;
}

const healthRoutes: FastifyPluginAsync<HealthRouteOpts> = async (app, opts) => {
  app.get('/health', async (_request, reply) => {
    try {
      await opts.dbProbe.ping();
      return { status: 'ok', db: 'connected' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(503).send({
        status: 'error',
        db: 'disconnected',
        error: message,
      });
    }
  });
};

export default healthRoutes;
