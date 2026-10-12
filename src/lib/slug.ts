/**
 * Slug helpers shared by the server (repository names, panel input) and the
 * browser (previewing the address of a new item before it is saved).
 *
 * Latin letters, digits and dashes only: predictable URLs that survive being
 * pasted into chat apps and search engines.
 */
export function slugify(input: string, fallback = 'item'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
  return slug || fallback;
}

/** Appends `-2`, `-3`, ... until the slug is not in `taken`. */
export function uniqueSlug(base: string, taken: Iterable<string>, fallback = 'item'): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  const root = slugify(base, fallback);
  if (!set.has(root)) return root;
  let counter = 2;
  while (set.has(`${root}-${counter}`)) counter += 1;
  return `${root}-${counter}`;
}

export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
