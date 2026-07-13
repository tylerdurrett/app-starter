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

const migrationsFolder = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'db',
  'drizzle',
);

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
      migrationCount: 2,
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
      migrationCount: databaseState?.migrationCount,
      usersTable: 'users',
    });
  });

  it('leaves a disposable source sentinel unchanged through child provision, reset, and drop', async () => {
    const outerIdentity = inject('testDatabase');
    const source = postgres(outerIdentity.sourceUrl, { max: 1 });
    let child: Awaited<ReturnType<typeof provisionTestDatabase>> | undefined;

    try {
      await source`CREATE TEMP TABLE isolation_source_sentinel (value text NOT NULL)`;
      await source`INSERT INTO isolation_source_sentinel (value) VALUES ('unchanged')`;

      child = await provisionTestDatabase({
        sourceUrl: outerIdentity.sourceUrl,
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
          migrationCount: 2,
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
          migrationCount: initial?.migrationCount,
          usersTable: 'users',
        });
      } finally {
        await childClient.end();
      }

      expect(
        await source<{ value: string }[]>`SELECT value FROM isolation_source_sentinel`,
      ).toEqual([{ value: 'unchanged' }]);

      await dropTestDatabase(child, { nodeEnv: 'test' });
      const droppedDatabase = child.testDatabase;
      child = undefined;

      expect(
        await source<{ value: string }[]>`SELECT value FROM isolation_source_sentinel`,
      ).toEqual([{ value: 'unchanged' }]);
      const [database] = await source<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT FROM pg_database WHERE datname = ${droppedDatabase}) AS "exists"
      `;
      expect(database?.exists).toBe(false);
    } finally {
      try {
        if (child) await dropTestDatabase(child, { nodeEnv: 'test' });
      } finally {
        await source.end();
      }
    }
  });
});
