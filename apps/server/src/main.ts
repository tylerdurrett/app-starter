import { config } from './config.js';
import { buildServer } from './index.js';
import { closeDb } from '@repo/db';

const app = buildServer();

app.addHook('onClose', async () => {
  // Close the shared Postgres pool so SIGTERM/SIGINT can actually exit after
  // Fastify drains; otherwise deploy shutdowns hang on idle DB sockets.
  await closeDb();
});

let closing = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    app.close().catch((err) => {
      app.log.error(err, 'error during shutdown');
      process.exit(1);
    });
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  await app.close().catch(() => {});
  process.exit(1);
}
