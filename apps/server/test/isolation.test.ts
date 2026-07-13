import { resolve } from 'node:path';

import { db, projects, users, workspaces } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { describe, expect, inject, it } from 'vitest';

import { resetTestDatabase } from './_setup.js';
import {
  closeTestServers,
  createProjectViaService,
  createTestServer,
  createWorkspaceViaService,
  signUp,
} from './helpers.js';
import { dropTestDatabase, provisionTestDatabase } from './test-database.js';
import migrationJournal from '../../../packages/db/drizzle/meta/_journal.json';

const migrationsFolder = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'db',
  'drizzle',
);
const expectedMigrationCount = migrationJournal.entries.length;

const expectedPublicTables = [
  'accounts',
  'integrations',
  'jwks',
  'oauth_access_tokens',
  'oauth_clients',
  'oauth_consents',
  'oauth_refresh_tokens',
  'project_invites',
  'project_memberships',
  'projects',
  'sessions',
  'users',
  'verifications',
  'workspace_invites',
  'workspace_memberships',
  'workspaces',
] as const;

describe('isolated server database', () => {
  it('runs HTTP and service fixtures against the migrated generated database and resets it', async () => {
    const identity = inject('testDatabase');
    const app = await createTestServer();
    await app.ready();

    const signedUp = await signUp(app, 'isolation-owner@test.com', 'Isolation Owner');
    expect(signedUp.statusCode).toBe(200);

    const workspace = await createWorkspaceViaService('Isolation Workspace', signedUp.userId);
    const project = await createProjectViaService(
      'Isolation Project',
      workspace.id,
      signedUp.userId,
    );

    const [databaseState] = (await db.execute(sql`
      SELECT
        current_database() AS "currentDatabase",
        to_regclass('public.users')::text AS "usersTable",
        to_regclass('public.workspaces')::text AS "workspacesTable",
        to_regclass('public.projects')::text AS "projectsTable",
        to_regclass('drizzle.__drizzle_migrations')::text AS "migrationsTable",
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS "migrationCount"
    `)) as unknown as {
      currentDatabase: string;
      usersTable: string;
      workspacesTable: string;
      projectsTable: string;
      migrationsTable: string;
      migrationCount: number;
    }[];

    expect(databaseState).toEqual({
      currentDatabase: identity.testDatabase,
      usersTable: 'users',
      workspacesTable: 'workspaces',
      projectsTable: 'projects',
      migrationsTable: 'drizzle.__drizzle_migrations',
      migrationCount: expectedMigrationCount,
    });
    expect(databaseState?.currentDatabase).not.toBe(identity.sourceDatabase);

    const publicTables = (await db.execute(sql`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)) as unknown as { tableName: string }[];
    expect(publicTables.map(({ tableName }) => tableName)).toEqual(expectedPublicTables);

    expect(
      await db.select({ id: users.id }).from(users).where(eq(users.id, signedUp.userId)),
    ).toEqual([{ id: signedUp.userId }]);
    expect(
      await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspace.id)),
    ).toEqual([{ id: workspace.id }]);
    expect(
      await db.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)),
    ).toEqual([{ id: project.id }]);

    await closeTestServers();
    await resetTestDatabase();

    const [resetState] = (await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS "userCount",
        (SELECT count(*)::int FROM workspaces) AS "workspaceCount",
        (SELECT count(*)::int FROM projects) AS "projectCount",
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS "migrationCount",
        to_regclass('public.users')::text AS "usersTable"
    `)) as unknown as {
      userCount: number;
      workspaceCount: number;
      projectCount: number;
      migrationCount: number;
      usersTable: string;
    }[];
    expect(resetState).toEqual({
      userCount: 0,
      workspaceCount: 0,
      projectCount: 0,
      migrationCount: expectedMigrationCount,
      usersTable: 'users',
    });
    expect(resetState?.migrationCount).toBe(databaseState?.migrationCount);
  });

  it('leaves a disposable source sentinel unchanged through child provision, reset, and drop', async () => {
    const outerIdentity = inject('testDatabase');
    const source = postgres(outerIdentity.testUrl, { max: 1 });
    const sentinel = {
      id: 'isolation-source-sentinel',
      email: 'isolation-source-sentinel@test.com',
      name: 'Isolation Source Sentinel',
    };
    let child: Awaited<ReturnType<typeof provisionTestDatabase>> | undefined;

    try {
      const [sourceIdentity] = await source<{ currentDatabase: string }[]>`
        SELECT current_database() AS "currentDatabase"
      `;
      expect(sourceIdentity?.currentDatabase).toBe(outerIdentity.testDatabase);
      expect(sourceIdentity?.currentDatabase).not.toBe(outerIdentity.sourceDatabase);

      await source`
        INSERT INTO users (id, email, name)
        VALUES (${sentinel.id}, ${sentinel.email}, ${sentinel.name})
      `;

      child = await provisionTestDatabase({
        sourceUrl: outerIdentity.testUrl,
        migrationsFolder,
        nodeEnv: 'test',
      });

      const childClient = postgres(child.testUrl, { max: 1 });
      try {
        const [initial] = await childClient<
          { currentDatabase: string; migrationCount: number; usersTable: string }[]
        >`
          SELECT
            current_database() AS "currentDatabase",
            (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS "migrationCount",
            to_regclass('public.users')::text AS "usersTable"
        `;
        expect(initial).toEqual({
          currentDatabase: child.testDatabase,
          migrationCount: expectedMigrationCount,
          usersTable: 'users',
        });
        expect(initial?.currentDatabase).not.toBe(child.sourceDatabase);

        await childClient`
          INSERT INTO users (id, name, email)
          VALUES ('child-reset-user', 'Child Reset User', 'child-reset@test.com')
        `;
        const tables = await childClient<{ qualifiedName: string }[]>`
          SELECT format('%I.%I', table_schema, table_name) AS "qualifiedName"
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `;
        await childClient.unsafe(
          `TRUNCATE TABLE ${tables.map(({ qualifiedName }) => qualifiedName).join(', ')} RESTART IDENTITY CASCADE`,
        );

        const [reset] = await childClient<
          { userCount: number; migrationCount: number; usersTable: string }[]
        >`
          SELECT
            (SELECT count(*)::int FROM users) AS "userCount",
            (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS "migrationCount",
            to_regclass('public.users')::text AS "usersTable"
        `;
        expect(reset).toEqual({
          userCount: 0,
          migrationCount: expectedMigrationCount,
          usersTable: 'users',
        });
        expect(reset?.migrationCount).toBe(initial?.migrationCount);
      } finally {
        await childClient.end();
      }

      expect(
        await source<{ id: string; email: string; name: string }[]>`
          SELECT id, email, name FROM users WHERE id = ${sentinel.id}
        `,
      ).toEqual([sentinel]);

      await dropTestDatabase(child, { nodeEnv: 'test' });
      const droppedDatabase = child.testDatabase;
      child = undefined;

      expect(
        await source<{ id: string; email: string; name: string }[]>`
          SELECT id, email, name FROM users WHERE id = ${sentinel.id}
        `,
      ).toEqual([sentinel]);
      const [database] = await source<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT FROM pg_database WHERE datname = ${droppedDatabase}) AS "exists"
      `;
      expect(database?.exists).toBe(false);
    } finally {
      try {
        if (child) await dropTestDatabase(child, { nodeEnv: 'test' });
      } finally {
        try {
          await source`DELETE FROM users WHERE id = ${sentinel.id}`;
        } finally {
          await source.end();
        }
      }
    }
  });
});
