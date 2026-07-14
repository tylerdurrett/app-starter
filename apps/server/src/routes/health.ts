import type { FastifyPluginAsync } from 'fastify';

export interface DbProbe {
  ping: () => Promise<void>;
}

interface HealthRouteOpts {
  dbProbe: DbProbe;
}

const DATABASE_UNAVAILABLE_MESSAGE = 'Database unavailable';

const healthRoutes: FastifyPluginAsync<HealthRouteOpts> = async (app, opts) => {
  app.get('/health', async (request, reply) => {
    try {
      await opts.dbProbe.ping();
      return { status: 'ok', db: 'connected' };
    } catch (err) {
      request.log.error({ err }, 'Database health probe failed');
      return reply.status(503).send({
        status: 'error',
        db: 'disconnected',
        error: DATABASE_UNAVAILABLE_MESSAGE,
      });
    }
  });
};

export default healthRoutes;
