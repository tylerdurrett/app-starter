import { db } from '@repo/db';
import type { PgTable } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { slugify } from './slug.js';

/**
 * Per-call configuration for the shared create-with-owner-membership helper.
 * Covers the slug-fallback + transactional (entity insert + owner-membership
 * insert) core shared by `createWorkspace` and `createProject`. Everything that
 * differs per level is expressed here: the fallback prefix for empty slugs, the
 * scope-aware unique-slug computation, the entity/memberships tables, any extra
 * entity insert fields (e.g. `createdByUserId` for workspaces, `workspaceId`
 * for projects), and the membership FK insert key.
 */
export interface CreateWithOwnerConfig {
  /** Entity display name; also the slug source. */
  name: string;
  /** User who becomes the entity's `owner` member. */
  ownerUserId: string;
  /** Prefix for the fallback slug when `name` produces an empty slug. */
  slugFallbackPrefix: string;
  /** Compute a slug unique within the level's scope (global | per-workspace). */
  ensureUniqueSlug: (baseSlug: string) => Promise<string>;
  /** The entity table plus any extra insert fields beyond {id, name, slug}. */
  entity: { table: PgTable; extraFields?: Record<string, unknown> };
  /** The memberships table plus the insert-model key for the entity FK. */
  memberships: { table: PgTable; entityIdKey: string };
}

/**
 * Insert an entity and its owner membership in one transaction, computing a
 * unique slug (with an empty-slug fallback) first. The project level wraps this
 * in its slug-unique-violation retry; the workspace level calls it directly.
 */
export async function createWithOwnerMembership(config: CreateWithOwnerConfig) {
  let baseSlug = slugify(config.name);
  // Fallback for names that produce an empty slug (e.g. all special chars)
  if (!baseSlug) baseSlug = `${config.slugFallbackPrefix}-${randomUUID().slice(0, 8)}`;

  const slug = await config.ensureUniqueSlug(baseSlug);
  const id = randomUUID();

  const [created] = await db.transaction(async (tx) => {
    const entityValues = {
      id,
      name: config.name,
      slug,
      ...config.entity.extraFields,
    } as typeof config.entity.table.$inferInsert;
    const rows = await tx.insert(config.entity.table).values(entityValues).returning();

    const membershipValues = {
      id: randomUUID(),
      [config.memberships.entityIdKey]: id,
      userId: config.ownerUserId,
      role: 'owner',
    } as typeof config.memberships.table.$inferInsert;
    await tx.insert(config.memberships.table).values(membershipValues);

    return rows;
  });

  if (!created) {
    throw new Error('createWithOwnerMembership: insert returned no rows');
  }
  return created;
}
