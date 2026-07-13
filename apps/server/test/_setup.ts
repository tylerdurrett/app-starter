import { afterAll, beforeAll, inject } from 'vitest';

import type { TestDatabaseIdentity } from './test-database.js';

const injectedTestDatabase = inject('testDatabase') as TestDatabaseIdentity;
export const testDatabase = Object.freeze({ ...injectedTestDatabase });
process.env.DATABASE_URL = testDatabase.testUrl;

const { assertSafeTestDatabaseIdentity } = await import('./test-database.js');
assertSafeTestDatabaseIdentity(testDatabase);

const [{ closeDb, db }, { sql }, { closeTestServers }] = await Promise.all([
  import('@repo/db'),
  import('drizzle-orm'),
  import('./helpers.js'),
]);

interface CurrentDatabaseRow extends Record<string, unknown> {
  currentDatabase: string;
}

interface DatabaseTableRow extends Record<string, unknown> {
  qualifiedName: string;
}

function collectError(errors: unknown[], error: unknown): void {
  if (error instanceof AggregateError) {
    for (const nestedError of error.errors) collectError(errors, nestedError);
    return;
  }
  errors.push(error);
}

function throwCollected(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

interface FixtureTeardownOptions {
  closeServers?: () => Promise<void>;
  closeDatabase?: () => Promise<void>;
}

export async function closeServerTestResources({
  closeServers = closeTestServers,
  closeDatabase = closeDb,
}: FixtureTeardownOptions = {}): Promise<void> {
  const errors: unknown[] = [];

  try {
    await closeServers();
  } catch (error) {
    collectError(errors, error);
  }

  try {
    await closeDatabase();
  } catch (error) {
    collectError(errors, error);
  }

  throwCollected(errors, 'Server test fixture teardown failed');
}

export async function resetTestDatabase(identity = testDatabase): Promise<void> {
  assertSafeTestDatabaseIdentity(identity);
  if (process.env.DATABASE_URL !== identity.testUrl) {
    throw new Error('DATABASE_URL does not match the injected test database');
  }

  const currentRows = (await db.execute(
    sql`SELECT current_database() AS "currentDatabase"`,
  )) as unknown as CurrentDatabaseRow[];
  if (currentRows.length !== 1 || currentRows[0]?.currentDatabase !== identity.testDatabase) {
    throw new Error(`Refusing to reset a database other than ${identity.testDatabase}`);
  }

  const tables = (await db.execute(sql`
    SELECT format('%I.%I', table_schema, table_name) AS "qualifiedName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '__drizzle_migrations'
    ORDER BY table_name
  `)) as unknown as DatabaseTableRow[];

  if (tables.length > 0) {
    const tableList = tables.map(({ qualifiedName }) => qualifiedName).join(', ');
    await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
  }
}

beforeAll(async () => {
  await resetTestDatabase();
});

afterAll(closeServerTestResources);
