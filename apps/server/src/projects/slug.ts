import { db, projects } from '@repo/db';
import { and, eq, like } from 'drizzle-orm';
import { slugify, ensureUniqueSlug as ensureUniqueSlugForScope } from '../tenancy/slug.js';

export { slugify };

/**
 * Return a slug guaranteed to be unique within the given workspace.
 * If `baseSlug` is taken by another project in the same workspace, appends
 * `-2`, `-3`, etc. Slugs in other workspaces are ignored.
 */
export async function ensureUniqueSlug(baseSlug: string, workspaceId: string): Promise<string> {
  return ensureUniqueSlugForScope(baseSlug, async (base) => {
    const existing = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), like(projects.slug, `${base}%`)));
    return existing.map((r) => r.slug);
  });
}
