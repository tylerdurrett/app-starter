import { resolve } from 'node:path';

import postgres from 'postgres';
import { describe, expect, inject, it } from 'vitest';

import {
  TEST_DATABASE_PREFIX,
  dropTestDatabase,
  provisionTestDatabase,
  type DatabaseClientFactory,
  type TestDatabaseIdentity,
} from './test-database.js';

const migrationsFolder = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'db',
  'drizzle',
);

function identity(overrides: Partial<TestDatabaseIdentity> = {}): TestDatabaseIdentity {
  const runToken = '0123456789abcdef01234567';
  const testDatabase = `${TEST_DATABASE_PREFIX}${runToken}`;
  return {
    sourceUrl: 'postgresql://postgres:postgres@127.0.0.1:5151/postgres',
    sourceDatabase: 'postgres',
    testUrl: `postgresql://postgres:postgres@127.0.0.1:5151/${testDatabase}`,
    testDatabase,
    runToken,
    ...overrides,
  };
}

describe('test database destructive guards', () => {
  it('refuses production before opening a database client', async () => {
    let clientsCreated = 0;
    const createClient = (() => {
      clientsCreated += 1;
      throw new Error('client must not be created');
    }) as DatabaseClientFactory;

    await expect(
      dropTestDatabase(identity(), { nodeEnv: 'production', createClient }),
    ).rejects.toThrow('Refusing to manage a test database in production');
    expect(clientsCreated).toBe(0);
  });

  it.each([
    ['token', { runToken: 'wrong' }],
    ['prefix', { testDatabase: 'postgres' }],
    [
      'source',
      {
        testUrl:
          'postgresql://elsewhere:secret@127.0.0.1:5151/app_starter_test_0123456789abcdef01234567',
      },
    ],
  ])(
    'rejects a mismatched %s identity before opening a database client',
    async (_label, override) => {
      let clientsCreated = 0;
      const createClient = (() => {
        clientsCreated += 1;
        throw new Error('client must not be created');
      }) as DatabaseClientFactory;

      await expect(
        dropTestDatabase(identity(override), { nodeEnv: 'test', createClient }),
      ).rejects.toThrow();
      expect(clientsCreated).toBe(0);
    },
  );

  it('checks current_database before issuing connection termination or DROP DATABASE', async () => {
    const statements: string[] = [];
    const createClient: DatabaseClientFactory = () => ({
      async query<Row extends Record<string, unknown>>(statement: string): Promise<Row[]> {
        statements.push(statement);
        return [{ currentDatabase: 'the_wrong_database' }] as Row[];
      },
      async migrate() {},
      async close() {},
    });

    await expect(dropTestDatabase(identity(), { nodeEnv: 'test', createClient })).rejects.toThrow(
      'Connected database does not match',
    );
    expect(statements).toEqual(['SELECT current_database() AS "currentDatabase"']);
  });

  it('attempts the guarded drop and propagates every teardown failure', async () => {
    const statements: string[] = [];
    let clientNumber = 0;
    const createClient: DatabaseClientFactory = () => {
      const isTarget = clientNumber++ === 0;
      return {
        async query<Row extends Record<string, unknown>>(statement: string): Promise<Row[]> {
          statements.push(statement);
          if (statement.startsWith('SELECT current_database')) {
            return [{ currentDatabase: isTarget ? identity().testDatabase : 'postgres' }] as Row[];
          }
          throw new Error(
            statement.startsWith('SELECT pg_terminate') ? 'terminate failed' : 'drop failed',
          );
        },
        async migrate() {},
        async close() {
          if (!isTarget) throw new Error('source close failed');
        },
      };
    };

    const rejection = dropTestDatabase(identity(), { nodeEnv: 'test', createClient });
    await expect(rejection).rejects.toBeInstanceOf(AggregateError);
    await expect(rejection).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'terminate failed' }),
        expect.objectContaining({ message: 'drop failed' }),
        expect.objectContaining({ message: 'source close failed' }),
      ],
    });
    expect(statements.some((statement) => statement.startsWith('DROP DATABASE'))).toBe(true);
  });
});

describe('test database lifecycle', () => {
  it('creates, migrates, identifies, and drops a real isolated Postgres database', async () => {
    const outerIdentity = inject('testDatabase');
    expect(process.env.DATABASE_URL).toBe(outerIdentity.testUrl);
    expect(outerIdentity.sourceUrl).not.toBe(outerIdentity.testUrl);

    const nestedIdentity = await provisionTestDatabase({
      sourceUrl: outerIdentity.sourceUrl,
      migrationsFolder,
      nodeEnv: 'test',
    });

    try {
      expect(nestedIdentity.sourceUrl).toBe(outerIdentity.sourceUrl);
      expect(nestedIdentity.testDatabase).toBe(`${TEST_DATABASE_PREFIX}${nestedIdentity.runToken}`);

      const testClient = postgres(nestedIdentity.testUrl, { max: 1 });
      try {
        const [row] = await testClient<
          {
            currentDatabase: string;
            usersTable: string | null;
            migrationsTable: string | null;
          }[]
        >`
          SELECT
            current_database() AS "currentDatabase",
            to_regclass('public.users')::text AS "usersTable",
            to_regclass('drizzle.__drizzle_migrations')::text AS "migrationsTable"
        `;
        expect(row).toEqual({
          currentDatabase: nestedIdentity.testDatabase,
          usersTable: 'users',
          migrationsTable: 'drizzle.__drizzle_migrations',
        });
      } finally {
        await testClient.end();
      }
    } finally {
      await dropTestDatabase(nestedIdentity, { nodeEnv: 'test' });
    }

    const sourceClient = postgres(nestedIdentity.sourceUrl, { max: 1 });
    try {
      const rows = await sourceClient<{ exists: boolean }[]>`
        SELECT EXISTS(
          SELECT FROM pg_database WHERE datname = ${nestedIdentity.testDatabase}
        ) AS "exists"
      `;
      expect(rows[0]?.exists).toBe(false);
    } finally {
      await sourceClient.end();
    }
  });
});
