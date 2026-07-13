import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';

import { dropTestDatabase, provisionTestDatabase } from './test-database.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDirectory, '..', '..', '..');

export default async function setup({ provide }: GlobalSetupContext) {
  loadEnv({ path: resolve(repoRoot, '.env') });

  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('DATABASE_URL is required to provision the server test database');
  }

  const identity = await provisionTestDatabase({
    sourceUrl,
    migrationsFolder: resolve(repoRoot, 'packages', 'db', 'drizzle'),
  });

  process.env.DATABASE_URL = identity.testUrl;
  provide('testDatabase', identity);

  return async () => {
    process.env.DATABASE_URL = identity.sourceUrl;
    await dropTestDatabase(identity);
  };
}
