// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { listWorkspacesForUser } from '../src/workspaces/service.js';
import { listAuthorizedProjectsForUser } from '../src/projects/resolver.js';
import { createTestServer, signUp } from './helpers.js';

// ---- helpers ----

let app: FastifyInstance;

// ---- setup / teardown ----

beforeAll(async () => {
  app = await createTestServer();
  await app.ready();
});

// ---- tests ----

describe('post-signup hook', () => {
  it('creates exactly one workspace and one project on signup', async () => {
    const ts = Date.now();
    const { userId } = await signUp(app, `postsignup-${ts}@test.com`, 'Alice');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList).toHaveLength(1);
    expect(workspaceList[0].role).toBe('owner');

    const projectList = await listAuthorizedProjectsForUser(userId);
    expect(projectList).toHaveLength(1);
    expect(projectList[0].role).toBe('owner');
    expect(projectList[0].name).toBe('Personal');
    expect(projectList[0].workspaceId).toBe(workspaceList[0].id);
  });

  it('uses the user first name for workspace name', async () => {
    const ts = Date.now();
    const { userId } = await signUp(app, `postsignup-name-${ts}@test.com`, 'Bob Builder');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList[0].name).toBe("Bob's Workspace");
    expect(workspaceList[0].slug).toMatch(/^bobs-workspace/);

    const projectList = await listAuthorizedProjectsForUser(userId);
    expect(projectList[0].name).toBe('Personal');
  });

  it('falls back to "Personal" when user name is whitespace-only', async () => {
    const ts = Date.now();
    const { userId } = await signUp(app, `postsignup-noname-${ts}@test.com`, '   ');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList).toHaveLength(1);
    expect(workspaceList[0].name).toBe('Personal');

    const projectList = await listAuthorizedProjectsForUser(userId);
    expect(projectList).toHaveLength(1);
    expect(projectList[0].name).toBe('Personal');
  });

  it('deduplicates workspace slugs globally but keeps project slugs clean per workspace for same-name users', async () => {
    const ts = Date.now();
    const { userId: id1 } = await signUp(app, `postsignup-dup1-${ts}@test.com`, 'Charlie');
    const { userId: id2 } = await signUp(app, `postsignup-dup2-${ts}@test.com`, 'Charlie');

    const workspaceList1 = await listWorkspacesForUser(id1);
    const workspaceList2 = await listWorkspacesForUser(id2);

    // Workspaces stay globally unique.
    expect(workspaceList1[0].slug).not.toBe(workspaceList2[0].slug);
    // One gets "charlies-workspace", the other gets "charlies-workspace-N"
    const wslugs = [workspaceList1[0].slug, workspaceList2[0].slug].sort();
    expect(wslugs[0]).toMatch(/^charlies-workspace/);
    expect(wslugs[1]).toMatch(/^charlies-workspace-\d+/);

    const projectList1 = await listAuthorizedProjectsForUser(id1);
    const projectList2 = await listAuthorizedProjectsForUser(id2);

    // Project slugs are unique only within a workspace, so each user's
    // "Personal" project — living in its own workspace — keeps the clean slug.
    expect(projectList1[0].slug).toBe('personal');
    expect(projectList2[0].slug).toBe('personal');
  });

  it('each user has owner role on both workspace and project', async () => {
    const ts = Date.now();
    const { userId } = await signUp(app, `postsignup-owner-${ts}@test.com`, 'Diana');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList[0].role).toBe('owner');

    const projectList = await listAuthorizedProjectsForUser(userId);
    expect(projectList[0].role).toBe('owner');
  });
});
