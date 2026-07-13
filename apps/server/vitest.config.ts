import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/_setup.ts'],
    sequence: {
      // Setup-file hooks register first. Stack order lets each file close its
      // apps and finish legacy cleanup before _setup closes the shared DB pool.
      // If a local hook rejects, Vitest stops the remaining file hooks; global
      // setup remains the final safety net and force-drops the generated DB.
      hooks: 'stack',
    },
  },
});
