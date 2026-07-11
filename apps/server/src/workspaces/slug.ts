import { db, workspaces } from '@repo/db';
import { like } from 'drizzle-orm';
import { slugify, ensureUniqueSlug as ensureUniqueSlugForScope } from '../tenancy/slug.js';

export { slugify };

/**
 * Return a slug guaranteed to be unique in the workspaces table.
 * If `baseSlug` is taken, appends `-2`, `-3`, etc.
 */
export async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  return ensureUniqueSlugForScope(baseSlug, async (base) => {
    const existing = await db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(like(workspaces.slug, `${base}%`));
    return existing.map((r) => r.slug);
  });
}
