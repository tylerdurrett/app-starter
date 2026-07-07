import { db, projects } from '@repo/db';
import { like } from 'drizzle-orm';

/** Convert a project name into a URL-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/['’]/g, '') // drop apostrophes so "bob's" → "bobs", not "bob-s"
    .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric runs with dash
    .replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}

/**
 * Return a slug guaranteed to be unique in the projects table.
 * If `baseSlug` is taken, appends `-2`, `-3`, etc.
 */
export async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const existing = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(like(projects.slug, `${baseSlug}%`));

  const taken = new Set(existing.map((r) => r.slug));

  if (!taken.has(baseSlug)) return baseSlug;

  let n = 2;
  while (taken.has(`${baseSlug}-${n}`)) n++;
  return `${baseSlug}-${n}`;
}
