// Slug of a module: lowercase words joined by single hyphens (SPEC-010). The server has the last
// word; these helpers only let the form say so before sending.

export const SLUG_MIN = 3;
export const SLUG_MAX = 60;
const PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SlugProblem = "short" | "long" | "format";

/** A slug as it would be stored: trimmed and in lower case. */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

/** Turns a title into a slug: no accents, lower case, words joined by hyphens. */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** What is wrong with a slug, or null. An empty slug is fine: the slug is optional. */
export function slugProblem(value: string): SlugProblem | null {
  const slug = normalizeSlug(value);
  if (slug === "") return null;
  if (slug.length < SLUG_MIN) return "short";
  if (slug.length > SLUG_MAX) return "long";
  return PATTERN.test(slug) ? null : "format";
}
