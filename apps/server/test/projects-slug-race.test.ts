// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import * as slug from '../src/projects/slug.js';
import {
  createProjectViaService,
  createTestServer,
  createWorkspaceViaService,
  signUp,
} from './helpers.js';

let app: FastifyInstance;
let ownerId: string;
let workspaceId: string;

async function createProjectIn(name: string, wsId: string) {
  return createProjectViaService(name, wsId, ownerId);
}

beforeAll(async () => {
  app = await createTestServer();
  await app.ready();

  const ts = Date.now();
  ownerId = (await signUp(app, `slug-race-owner-${ts}@test.com`, 'Slug Race Owner')).userId;

  const ws = await createWorkspaceViaService(`Slug Race Workspace ${ts}`, ownerId);
  workspaceId = ws.id;
});

afterEach(() => {
  vi.restoreAllMocks();
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
