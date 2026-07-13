// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { ensureUniqueSlug } from '../src/projects/slug.js';
import {
  createProjectViaService,
  createTestServer,
  createWorkspaceViaService,
  signUp,
} from './helpers.js';

let app: FastifyInstance;
let ownerId: string;
let workspaceA: string;
let workspaceB: string;

async function createProjectIn(name: string, workspaceId: string) {
  return createProjectViaService(name, workspaceId, ownerId);
}

beforeAll(async () => {
  app = await createTestServer();
  await app.ready();

  const ts = Date.now();
  ownerId = (await signUp(app, `slug-owner-${ts}@test.com`, 'Slug Owner')).userId;

  const wsA = await createWorkspaceViaService(`Slug Workspace A ${ts}`, ownerId);
  const wsB = await createWorkspaceViaService(`Slug Workspace B ${ts}`, ownerId);
  workspaceA = wsA.id;
  workspaceB = wsB.id;
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
