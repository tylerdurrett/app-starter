import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
});
