// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, projects } from '@repo/db';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { createWorkspace } from '../src/workspaces/service.js';
import { createProject } from '../src/projects/service.js';
import { ensureUniqueSlug } from '../src/projects/slug.js';

let app: FastifyInstance;
let ownerId: string;
let workspaceA: string;
let workspaceB: string;
const createdProjectIds: string[] = [];

async function signUp(email: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password: 'password123', name },
  });
  return JSON.parse(res.body).user.id;
}

async function createProjectIn(name: string, workspaceId: string) {
  const proj = await createProject({ name, workspaceId, ownerUserId: ownerId });
  createdProjectIds.push(proj!.id);
  return proj!;
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  ownerId = await signUp(`slug-owner-${ts}@test.com`, 'Slug Owner');

  const wsA = await createWorkspace({ name: `Slug Workspace A ${ts}`, ownerUserId: ownerId });
  const wsB = await createWorkspace({ name: `Slug Workspace B ${ts}`, ownerUserId: ownerId });
  workspaceA = wsA.id;
  workspaceB = wsB.id;
});

afterAll(async () => {
  if (createdProjectIds.length > 0) {
    await db
      .delete(projects)
      .where(inArray(projects.id, createdProjectIds))
      .catch(() => {});
  }
  await app.close();
});

describe('workspace-scoped slug uniqueness', () => {
  it('keeps a clean slug for the same name across different workspaces', async () => {
    const inA = await createProjectIn('Marketing', workspaceA);
    const inB = await createProjectIn('Marketing', workspaceB);

    expect(inA.slug).toBe('marketing');
    expect(inB.slug).toBe('marketing');
  });

  it('suffixes -2/-3 for repeated names within the same workspace', async () => {
    const first = await createProjectIn('Sales', workspaceA);
    const second = await createProjectIn('Sales', workspaceA);
    const third = await createProjectIn('Sales', workspaceA);

    expect(first.slug).toBe('sales');
    expect(second.slug).toBe('sales-2');
    expect(third.slug).toBe('sales-3');
  });

  it('ensureUniqueSlug ignores collisions in other workspaces', async () => {
    // "engineering" exists in workspace A only.
    await createProjectIn('Engineering', workspaceA);

    // Same base slug in workspace B is untaken → returned verbatim.
    expect(await ensureUniqueSlug('engineering', workspaceB)).toBe('engineering');
    // In workspace A it is taken → suffixed.
    expect(await ensureUniqueSlug('engineering', workspaceA)).toBe('engineering-2');
  });

  it('falls back to project-<uuid8> for all-special-character names', async () => {
    const proj = await createProjectIn('!@#$%', workspaceA);
    expect(proj.slug).toMatch(/^project-[0-9a-f]{8}$/);
  });
});
