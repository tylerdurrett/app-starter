import { randomBytes } from 'node:crypto';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const TEST_DATABASE_PREFIX = 'app_starter_test_';

const RUN_TOKEN_PATTERN = /^[0-9a-f]{24}$/;

export interface TestDatabaseIdentity {
  readonly sourceUrl: string;
  readonly sourceDatabase: string;
  readonly testUrl: string;
  readonly testDatabase: string;
  readonly runToken: string;
}

interface DatabaseClient {
  query<Row extends Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<Row[]>;
  migrate(migrationsFolder: string): Promise<void>;
  close(): Promise<void>;
}

export type DatabaseClientFactory = (databaseUrl: string) => DatabaseClient;

interface ProvisionTestDatabaseOptions {
  sourceUrl: string;
  migrationsFolder: string;
  nodeEnv?: string;
  runToken?: string;
  createClient?: DatabaseClientFactory;
}

interface DropTestDatabaseOptions {
  nodeEnv?: string;
  createClient?: DatabaseClientFactory;
}

interface CurrentDatabaseRow extends Record<string, unknown> {
  currentDatabase: string;
}

function databaseName(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Test database URL must be a valid URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Test database URL must use postgres:// or postgresql://');
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!name || name.includes('/')) {
    throw new Error('Test database URL must name exactly one database');
  }
  return name;
}

function databaseUrl(sourceUrl: string, targetDatabase: string): string {
  const parsed = new URL(sourceUrl);
  parsed.pathname = `/${targetDatabase}`;
  return parsed.toString();
}

function assertNotProduction(nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === 'production') {
    throw new Error('Refusing to manage a test database in production');
  }
}

export function assertSafeTestDatabaseIdentity(
  identity: TestDatabaseIdentity,
  nodeEnv = process.env.NODE_ENV,
): void {
  assertNotProduction(nodeEnv);

  if (!RUN_TOKEN_PATTERN.test(identity.runToken)) {
    throw new Error('Test database run token is invalid');
  }

  const expectedTestDatabase = `${TEST_DATABASE_PREFIX}${identity.runToken}`;
  if (identity.testDatabase !== expectedTestDatabase) {
    throw new Error('Test database name does not exactly match its run token');
  }
  if (databaseName(identity.sourceUrl) !== identity.sourceDatabase) {
    throw new Error('Source database identity does not match its URL');
  }
  if (databaseName(identity.testUrl) !== identity.testDatabase) {
    throw new Error('Test database identity does not match its URL');
  }
  if (
    identity.sourceDatabase === identity.testDatabase ||
    identity.sourceUrl === identity.testUrl
  ) {
    throw new Error('Test database must be distinct from the source database');
  }
  if (databaseUrl(identity.sourceUrl, identity.testDatabase) !== identity.testUrl) {
    throw new Error('Test database URL must be derived from the preserved source URL');
  }
}

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  const sql = postgres(databaseUrl, { max: 1 });
  const database = drizzle(sql);

  return {
    async query<Row extends Record<string, unknown>>(
      statement: string,
      parameters: readonly unknown[] = [],
    ): Promise<Row[]> {
      return (await sql.unsafe(statement, [...parameters])) as Row[];
    },
    async migrate(migrationsFolder: string): Promise<void> {
      await migrate(database, { migrationsFolder });
    },
    async close(): Promise<void> {
      await sql.end();
    },
  };
}

async function throwCollected(errors: unknown[], message: string): Promise<void> {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

async function withClient<T>(client: DatabaseClient, operation: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  const errors: unknown[] = [];

  try {
    result = await operation();
  } catch (error) {
    errors.push(error);
  }

  try {
    await client.close();
  } catch (error) {
    errors.push(error);
  }

  await throwCollected(errors, 'Database operation and client shutdown both failed');
  return result as T;
}

async function assertCurrentDatabase(client: DatabaseClient, expected: string): Promise<void> {
  const rows = await client.query<CurrentDatabaseRow>(
    'SELECT current_database() AS "currentDatabase"',
  );
  if (rows.length !== 1 || rows[0]?.currentDatabase !== expected) {
    throw new Error(`Connected database does not match the guarded target ${expected}`);
  }
}

export async function provisionTestDatabase({
  sourceUrl,
  migrationsFolder,
  nodeEnv = process.env.NODE_ENV,
  runToken = randomBytes(12).toString('hex'),
  createClient = createDatabaseClient,
}: ProvisionTestDatabaseOptions): Promise<Readonly<TestDatabaseIdentity>> {
  const testDatabase = `${TEST_DATABASE_PREFIX}${runToken}`;
  const identity = Object.freeze({
    sourceUrl,
    sourceDatabase: databaseName(sourceUrl),
    testUrl: databaseUrl(sourceUrl, testDatabase),
    testDatabase,
    runToken,
  });
  assertSafeTestDatabaseIdentity(identity, nodeEnv);

  let created = false;
  const errors: unknown[] = [];

  try {
    const sourceClient = createClient(identity.sourceUrl);
    await withClient(sourceClient, async () => {
      await assertCurrentDatabase(sourceClient, identity.sourceDatabase);
      await sourceClient.query(`CREATE DATABASE "${identity.testDatabase}"`);
      created = true;
    });

    const testClient = createClient(identity.testUrl);
    await withClient(testClient, async () => {
      await assertCurrentDatabase(testClient, identity.testDatabase);
      await testClient.migrate(migrationsFolder);
    });
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0 && created) {
    try {
      await dropTestDatabase(identity, { nodeEnv, createClient });
    } catch (error) {
      errors.push(error);
    }
  }

  await throwCollected(errors, 'Test database provisioning and rollback both failed');
  return identity;
}

export async function dropTestDatabase(
  identity: TestDatabaseIdentity,
  {
    nodeEnv = process.env.NODE_ENV,
    createClient = createDatabaseClient,
  }: DropTestDatabaseOptions = {},
): Promise<void> {
  // Validate every caller-provided identity component before opening a client,
  // much less issuing termination or DROP DATABASE statements.
  assertSafeTestDatabaseIdentity(identity, nodeEnv);

  const errors: unknown[] = [];
  let targetVerified = false;

  try {
    const targetClient = createClient(identity.testUrl);
    try {
      await assertCurrentDatabase(targetClient, identity.testDatabase);
      targetVerified = true;
    } catch (error) {
      errors.push(error);
    }
    try {
      await targetClient.close();
    } catch (error) {
      errors.push(error);
    }
  } catch (error) {
    errors.push(error);
  }

  // A close failure does not prevent cleanup: the source connection below can
  // terminate the target connection. A failed identity check always does.
  if (targetVerified) {
    try {
      const sourceClient = createClient(identity.sourceUrl);
      let sourceVerified = false;
      try {
        await assertCurrentDatabase(sourceClient, identity.sourceDatabase);
        sourceVerified = true;
      } catch (error) {
        errors.push(error);
      }

      if (sourceVerified) {
        try {
          await sourceClient.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [identity.testDatabase],
          );
        } catch (error) {
          errors.push(error);
        }
        try {
          await sourceClient.query(`DROP DATABASE "${identity.testDatabase}"`);
        } catch (error) {
          errors.push(error);
        }
      }

      try {
        await sourceClient.close();
      } catch (error) {
        errors.push(error);
      }
    } catch (error) {
      errors.push(error);
    }
  }

  await throwCollected(errors, 'Test database teardown failed');
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: Readonly<TestDatabaseIdentity>;
  }
}
