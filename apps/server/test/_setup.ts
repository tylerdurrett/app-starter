import '../src/config.js';

import { beforeAll, afterAll } from 'vitest';
import {
  db,
  users,
  workspaces,
  workspaceMemberships,
  workspaceInvites,
  projectMemberships,
  projectInvites,
  integrations,
  sessions,
  accounts,
} from '@repo/db';
import { inArray, notInArray } from 'drizzle-orm';

/**
 * Global test teardown — deletes users (and their dependent rows) that were
 * created during the test file's execution. Runs after each test file's own
 * afterAll, catching what explicit cleanups missed.
 *
 * Why: nearly every test file signs up users via /api/auth/sign-up/email, and
 * the post-signup hook auto-creates a "<Name>'s Workspace" + "Personal" project
 * for each. Most test files clean up workspaces they *explicitly* insert but
 * not the auth user row or the hook-created workspace. Without this global
 * teardown, every `pnpm test` run leaked ~70 users / ~70 workspaces into the
 * dev DB (which in this project is the same Postgres instance the UI uses).
 *
 * How: snapshot user IDs before the test file runs; after it runs, delete
 * every user NOT in the snapshot and cascade their dependents. Pre-existing
 * real users are untouched.
 *
 * Safety rails:
 *   - If the snapshot is empty, skip cleanup entirely. A catastrophic wipe of
 *     the DB (e.g. from a buggy test's unscoped DELETE) would also empty the
 *     snapshot — detecting that and bailing avoids amplifying the damage.
 *   - All FKs to users are RESTRICT or NO ACTION (verified via pg_constraint),
 *     so rows are deleted in dependency order: workspaces (cascades projects/
 *     memberships/integrations) → remaining memberships/invites
 *     → sessions/accounts → users.
 */

let preexistingUserIds: string[] = [];

beforeAll(async () => {
  const rows = await db.select({ id: users.id }).from(users);
  preexistingUserIds = rows.map((r) => r.id);
});

afterAll(async () => {
  if (preexistingUserIds.length === 0) return;

  const newUserIds = (await db
    .select({ id: users.id })
    .from(users)
    .where(notInArray(users.id, preexistingUserIds))).map((r) => r.id);

  if (newUserIds.length === 0) return;

  await db.delete(workspaces).where(inArray(workspaces.createdByUserId, newUserIds)).catch(() => {});

  await db.delete(integrations).where(inArray(integrations.createdByUserId, newUserIds)).catch(() => {});
  await db.delete(projectInvites).where(inArray(projectInvites.invitedByUserId, newUserIds)).catch(() => {});
  await db.delete(projectMemberships).where(inArray(projectMemberships.userId, newUserIds)).catch(() => {});
  await db.delete(workspaceInvites).where(inArray(workspaceInvites.invitedByUserId, newUserIds)).catch(() => {});
  await db.delete(workspaceMemberships).where(inArray(workspaceMemberships.userId, newUserIds)).catch(() => {});

  await db.delete(sessions).where(inArray(sessions.userId, newUserIds)).catch(() => {});
  await db.delete(accounts).where(inArray(accounts.userId, newUserIds)).catch(() => {});

  await db.delete(users).where(inArray(users.id, newUserIds)).catch(() => {});
});
