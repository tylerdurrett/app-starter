/** Convert a name into a URL-safe slug. */
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
 * Return a slug guaranteed to be unique within some scope.
 *
 * The caller supplies `fetchTakenSlugs`, which returns the slugs already taken
 * in the relevant scope (global for workspaces, per-workspace for projects).
 * If `baseSlug` is taken, appends `-2`, `-3`, etc.
 */
export async function ensureUniqueSlug(
  baseSlug: string,
  fetchTakenSlugs: (base: string) => Promise<string[]>,
): Promise<string> {
  const taken = new Set(await fetchTakenSlugs(baseSlug));

  if (!taken.has(baseSlug)) return baseSlug;

  let n = 2;
  while (taken.has(`${baseSlug}-${n}`)) n++;
  return `${baseSlug}-${n}`;
}
