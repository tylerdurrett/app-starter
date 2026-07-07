// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, workspaces, workspaceMemberships, projects, projectMemberships } from '@repo/db';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { listWorkspacesForUser } from '../src/workspaces/service.js';
import { listProjectsForUser } from '../src/projects/service.js';

// ---- helpers ----

let app: FastifyInstance;
const createdUserIds: string[] = [];

/** Sign up a user and return their ID. */
async function signUp(email: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password: 'password123', name },
  });
  const body = JSON.parse(res.body);
  createdUserIds.push(body.user.id);
  return body.user.id;
}

// ---- setup / teardown ----

beforeAll(async () => {
  app = buildServer();
  await app.ready();
});

afterAll(async () => {
  // Clean up auto-created projects and workspaces for our test users (memberships cascade)
  if (createdUserIds.length > 0) {
    // First get all projects created by our test users
    const userProjects = await db
      .select({ projectId: projectMemberships.projectId })
      .from(projectMemberships)
      .where(inArray(projectMemberships.userId, createdUserIds));

    const projectIds = userProjects.map((r) => r.projectId);
    if (projectIds.length > 0) {
      await db.delete(projects).where(inArray(projects.id, projectIds)).catch(() => {});
    }

    // Then clean up workspaces
    const userWorkspaces = await db
      .select({ workspaceId: workspaceMemberships.workspaceId })
      .from(workspaceMemberships)
      .where(inArray(workspaceMemberships.userId, createdUserIds));

    const wsIds = userWorkspaces.map((r) => r.workspaceId);
    if (wsIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.id, wsIds)).catch(() => {});
    }
  }
  await app.close();
});

// ---- tests ----

describe('post-signup hook', () => {
  it('creates exactly one workspace and one project on signup', async () => {
    const ts = Date.now();
    const userId = await signUp(`postsignup-${ts}@test.com`, 'Alice');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList).toHaveLength(1);
    expect(workspaceList[0].role).toBe('owner');

    const projectList = await listProjectsForUser(userId);
    expect(projectList).toHaveLength(1);
    expect(projectList[0].role).toBe('owner');
    expect(projectList[0].name).toBe('Personal');
    expect(projectList[0].workspaceId).toBe(workspaceList[0].id);
  });

  it('uses the user first name for workspace name', async () => {
    const ts = Date.now();
    const userId = await signUp(`postsignup-name-${ts}@test.com`, 'Bob Builder');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList[0].name).toBe("Bob's Workspace");
    expect(workspaceList[0].slug).toMatch(/^bobs-workspace/);

    const projectList = await listProjectsForUser(userId);
    expect(projectList[0].name).toBe('Personal');
  });

  it('falls back to "Personal" when user name is whitespace-only', async () => {
    const ts = Date.now();
    const userId = await signUp(`postsignup-noname-${ts}@test.com`, '   ');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList).toHaveLength(1);
    expect(workspaceList[0].name).toBe('Personal');

    const projectList = await listProjectsForUser(userId);
    expect(projectList).toHaveLength(1);
    expect(projectList[0].name).toBe('Personal');
  });

  it('generates unique slugs for both workspaces and projects for same-name users', async () => {
    const ts = Date.now();
    const id1 = await signUp(`postsignup-dup1-${ts}@test.com`, 'Charlie');
    const id2 = await signUp(`postsignup-dup2-${ts}@test.com`, 'Charlie');

    const workspaceList1 = await listWorkspacesForUser(id1);
    const workspaceList2 = await listWorkspacesForUser(id2);

    expect(workspaceList1[0].slug).not.toBe(workspaceList2[0].slug);
    // One gets "charlies-workspace", the other gets "charlies-workspace-N"
    const wslugs = [workspaceList1[0].slug, workspaceList2[0].slug].sort();
    expect(wslugs[0]).toMatch(/^charlies-workspace/);
    expect(wslugs[1]).toMatch(/^charlies-workspace-\d+/);

    const projectList1 = await listProjectsForUser(id1);
    const projectList2 = await listProjectsForUser(id2);

    expect(projectList1[0].slug).not.toBe(projectList2[0].slug);
    // One gets "personal", the other gets "personal-N"
    const pslugs = [projectList1[0].slug, projectList2[0].slug].sort();
    expect(pslugs[0]).toMatch(/^personal/);
    expect(pslugs[1]).toMatch(/^personal-\d+/);
  });

  it('each user has owner role on both workspace and project', async () => {
    const ts = Date.now();
    const userId = await signUp(`postsignup-owner-${ts}@test.com`, 'Diana');

    const workspaceList = await listWorkspacesForUser(userId);
    expect(workspaceList[0].role).toBe('owner');

    const projectList = await listProjectsForUser(userId);
    expect(projectList[0].role).toBe('owner');
  });
});
