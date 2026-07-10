// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, projects } from '@repo/db';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { createWorkspace } from '../src/workspaces/service.js';
import { createProject } from '../src/projects/service.js';
import * as slug from '../src/projects/slug.js';

let app: FastifyInstance;
let ownerId: string;
let workspaceId: string;
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

async function createProjectIn(name: string, wsId: string) {
  const proj = await createProject({ name, workspaceId: wsId, ownerUserId: ownerId });
  createdProjectIds.push(proj!.id);
  return proj!;
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  ownerId = await signUp(`slug-race-owner-${ts}@test.com`, 'Slug Race Owner');

  const ws = await createWorkspace({ name: `Slug Race Workspace ${ts}`, ownerUserId: ownerId });
  workspaceId = ws.id;
});

afterEach(() => {
  vi.restoreAllMocks();
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

describe('createProject slug race retry', () => {
  it('retries the next suffix when the losing insert hits the unique violation', async () => {
    // "race" already exists in this workspace.
    const first = await createProjectIn('Race', workspaceId);
    expect(first.slug).toBe('race');

    // Simulate the race: the first ensureUniqueSlug call returns the taken
    // slug (as if a competing creation had not yet committed), forcing the
    // INSERT to hit the (workspace_id, slug) unique violation. Subsequent
    // calls fall through to the real implementation, which now sees "race"
    // taken and returns the next suffix.
    const spy = vi.spyOn(slug, 'ensureUniqueSlug');
    spy.mockImplementationOnce(async () => 'race');

    const raced = await createProjectIn('Race', workspaceId);

    // First (stubbed) attempt collided on "race"; retry landed "race-2".
    expect(raced.slug).toBe('race-2');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
