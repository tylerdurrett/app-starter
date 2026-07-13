import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';

import { dropTestDatabase, provisionTestDatabase } from './test-database.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDirectory, '..', '..', '..');

interface GlobalSetupDependencies {
  validateEnvironment?: () => Promise<unknown>;
  provisionDatabase?: typeof provisionTestDatabase;
  dropDatabase?: typeof dropTestDatabase;
}

export async function setupTestDatabase(
  { provide }: GlobalSetupContext,
  {
    validateEnvironment = async () => import('../src/config.js'),
    provisionDatabase = provisionTestDatabase,
    dropDatabase = dropTestDatabase,
  }: GlobalSetupDependencies = {},
) {
  loadEnv({ path: resolve(repoRoot, '.env') });

  // Validate imports that every server test needs before creating anything.
  // Vitest cannot run a returned teardown if global setup itself throws.
  await validateEnvironment();

  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error('DATABASE_URL is required to provision the server test database');
  }

  const identity = await provisionDatabase({
    sourceUrl,
    migrationsFolder: resolve(repoRoot, 'packages', 'db', 'drizzle'),
  });

  try {
    process.env.DATABASE_URL = identity.testUrl;
    provide('testDatabase', identity);
  } catch (error) {
    process.env.DATABASE_URL = identity.sourceUrl;
    try {
      await dropDatabase(identity);
    } catch (dropError) {
      throw new AggregateError(
        [error, dropError],
        'Server test global setup and database rollback both failed',
      );
    }
    throw error;
  }

  return async () => {
    process.env.DATABASE_URL = identity.sourceUrl;
    await dropDatabase(identity);
  };
}

export default setupTestDatabase;
