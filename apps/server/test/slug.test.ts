// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { slugify, ensureUniqueSlug } from '../src/workspaces/slug.js';
import { db, workspaces, users } from '@repo/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

describe('slugify', () => {
  it('converts a simple name to lowercase slug', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('replaces consecutive special characters with a single dash', () => {
    expect(slugify('hello---world')).toBe('hello-world');
    expect(slugify('foo & bar')).toBe('foo-bar');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('  hello  ')).toBe('hello');
    expect(slugify('--hello--')).toBe('hello');
  });

  it('strips diacritics', () => {
    expect(slugify('Ünïcödé Tëst')).toBe('unicode-test');
    expect(slugify('café')).toBe('cafe');
  });

  it('handles all-special-character input', () => {
    expect(slugify('!@#$%')).toBe('');
  });

  it('preserves numbers', () => {
    expect(slugify('Project 42')).toBe('project-42');
  });
});

describe('ensureUniqueSlug', () => {
  // Track workspace IDs created during tests so we can clean up
  const createdIds: string[] = [];
  const testUserId = 'test-user-' + randomUUID();

  beforeAll(async () => {
    // Create a test user for workspace creation
    await db.insert(users).values({
      id: testUserId,
      email: 'slug-test@example.com',
      emailVerified: false,
    });
  });

  async function insertWorkspace(slug: string) {
    const id = randomUUID();
    createdIds.push(id);
    await db.insert(workspaces).values({
      id,
      name: slug,
      slug,
      createdByUserId: testUserId,
    });
  }

  // Clean up after all tests in this describe block
  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('returns the base slug when no conflict exists', async () => {
    const slug = `unique-test-${Date.now()}`;
    const result = await ensureUniqueSlug(slug);
    expect(result).toBe(slug);
  });

  it('appends -2 when the base slug is taken', async () => {
    const base = `taken-${Date.now()}`;
    await insertWorkspace(base);

    const result = await ensureUniqueSlug(base);
    expect(result).toBe(`${base}-2`);
  });

  it('appends -3 when both base and -2 are taken', async () => {
    const base = `double-taken-${Date.now()}`;
    await insertWorkspace(base);
    await insertWorkspace(`${base}-2`);

    const result = await ensureUniqueSlug(base);
    expect(result).toBe(`${base}-3`);
  });
});
