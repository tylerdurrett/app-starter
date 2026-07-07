#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../apps/server/src/index.js';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

// Test user credentials
const TEST_USER = {
  email: 'test@test.com',
  password: 'password',
  name: 'Test User',
};

/** Extract the session cookie from a set-cookie header. */
function extractCookie(res: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = res.headers['set-cookie'] as string | undefined;
  if (!raw) throw new Error('No set-cookie header in response');
  return raw.split(';')[0];
}

/** Sign in and return the session cookie, or null if the user doesn't exist. */
async function signIn(app: FastifyInstance): Promise<string | null> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json' },
    payload: { email: TEST_USER.email, password: TEST_USER.password },
  });
  if (res.statusCode === 200) return extractCookie(res);
  return null;
}

/** Sign up and return the session cookie. Handles USER_ALREADY_EXISTS by signing in. */
async function signUp(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: TEST_USER,
  });

  if (res.statusCode === 200) {
    console.log(`✓ Created user: ${TEST_USER.email}`);
    return extractCookie(res);
  }

  const body = JSON.parse(res.body);
  if (res.statusCode === 422 && body.code === 'USER_ALREADY_EXISTS') {
    // Race condition: user was created between our sign-in check and sign-up
    const cookie = await signIn(app);
    if (!cookie) throw new Error('User exists but sign-in failed');
    return cookie;
  }

  throw new Error(`Failed to create user: ${res.statusCode} - ${res.body}`);
}

/** Ensure the user has at least one workspace; create one if missing. */
async function ensureWorkspace(app: FastifyInstance, cookie: string): Promise<{ id: string; slug: string; name: string }> {
  const listRes = await app.inject({
    method: 'GET',
    url: '/api/workspaces',
    headers: { cookie },
  });

  if (listRes.statusCode !== 200) {
    throw new Error(`Failed to list workspaces: ${listRes.statusCode} - ${listRes.body}`);
  }

  const workspaces = JSON.parse(listRes.body);
  if (workspaces.length > 0) {
    console.log(`✓ User has ${workspaces.length} workspace(s): ${workspaces.map((w: { slug: string }) => w.slug).join(', ')}`);
    return workspaces[0];
  }

  // No workspaces — create one (e.g. user was created before post-signup hook existed)
  const workspaceName = TEST_USER.name.split(' ')[0] + "'s Workspace";
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/workspaces',
    headers: { 'content-type': 'application/json', cookie },
    payload: { name: workspaceName },
  });

  if (createRes.statusCode !== 201) {
    throw new Error(`Failed to create workspace: ${createRes.statusCode} - ${createRes.body}`);
  }

  const ws = JSON.parse(createRes.body);
  console.log(`✓ Created workspace: ${ws.name} (slug: ${ws.slug})`);
  return ws;
}

/** Ensure a second workspace exists for MCP smoke testing (list_workspaces needs >1). */
async function ensureSecondWorkspace(app: FastifyInstance, cookie: string): Promise<void> {
  const listRes = await app.inject({
    method: 'GET',
    url: '/api/workspaces',
    headers: { cookie },
  });

  if (listRes.statusCode !== 200) {
    throw new Error(`Failed to list workspaces: ${listRes.statusCode} - ${listRes.body}`);
  }

  const workspaces = JSON.parse(listRes.body);
  if (workspaces.length >= 2) {
    console.log(`✓ User already has ${workspaces.length} workspaces (no second needed)`);
    return;
  }

  const createRes = await app.inject({
    method: 'POST',
    url: '/api/workspaces',
    headers: { 'content-type': 'application/json', cookie },
    payload: { name: 'Acme Co' },
  });

  if (createRes.statusCode !== 201) {
    throw new Error(`Failed to create second workspace: ${createRes.statusCode} - ${createRes.body}`);
  }

  const ws = JSON.parse(createRes.body);
  console.log(`✓ Created second workspace: ${ws.name} (slug: ${ws.slug})`);
}

/** Ensure the workspace has at least one project; create one if missing. */
async function ensureProject(app: FastifyInstance, cookie: string, workspace: { id: string; slug: string }): Promise<void> {
  const listRes = await app.inject({
    method: 'GET',
    url: '/api/projects',
    headers: { cookie },
  });

  if (listRes.statusCode !== 200) {
    throw new Error(`Failed to list projects: ${listRes.statusCode} - ${listRes.body}`);
  }

  const projects = JSON.parse(listRes.body);
  const workspaceProjects = projects.filter((p: { workspaceId: string }) => p.workspaceId === workspace.id);

  if (workspaceProjects.length > 0) {
    console.log(`✓ Workspace has ${workspaceProjects.length} project(s): ${workspaceProjects.map((p: { slug: string }) => p.slug).join(', ')}`);
    return;
  }

  // No projects in this workspace — create one
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': 'application/json', cookie },
    payload: {
      workspaceSlug: workspace.slug,
      name: 'Personal',
    },
  });

  if (createRes.statusCode !== 201) {
    throw new Error(`Failed to create project: ${createRes.statusCode} - ${createRes.body}`);
  }

  const project = JSON.parse(createRes.body);
  console.log(`✓ Created project: ${project.name} (slug: ${project.slug})`);
}

async function seed() {
  let app: FastifyInstance | null = null;

  try {
    console.log('Starting seed process...');

    // Build the server (no need to listen on a port, inject works without it)
    app = buildServer();
    await app.ready();
    console.log('✓ Server initialized');

    // Sign in (existing user) or sign up (new user) — always get a session cookie
    const existing = await signIn(app);
    if (existing) console.log(`✓ User ${TEST_USER.email} already exists (idempotent)`);
    const cookie = existing ?? await signUp(app);

    // Ensure the user has at least one workspace
    const workspace = await ensureWorkspace(app, cookie);

    // Ensure a second workspace exists (for MCP list_workspaces smoke testing)
    await ensureSecondWorkspace(app, cookie);

    // Ensure the workspace has at least one project
    await ensureProject(app, cookie, workspace);

    console.log('\nSeed completed successfully!');
    console.log(`You can now log in with:`);
    console.log(`  Email: ${TEST_USER.email}`);
    console.log(`  Password: ${TEST_USER.password}`);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    // Clean shutdown
    if (app) {
      await app.close();
      console.log('✓ Server closed');
    }
    process.exit(0);
  }
}

// Run the seed
seed();