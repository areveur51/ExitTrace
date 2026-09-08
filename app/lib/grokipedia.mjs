/** Local encyclopedia context from stored person summaries. Not a cite. No live fetch. */

export const GROKIPEDIA_PATH = "/grokipedia";
export const GROKIPEDIA_KEY = "k";

export function grokipediaSlug(row) {
  const id = String(row?.id || "").trim();
  if (id && /^[a-z0-9][a-z0-9-]*$/i.test(id)) return id;
  return String(row?.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function grokipediaHref(row) {
  const slug = grokipediaSlug(row);
  return slug ? `${GROKIPEDIA_PATH}/${slug}` : GROKIPEDIA_PATH;
}

export function grokipediaText(row) {
  return String(row?.summary || "").trim();
}

export function grokipediaEntry(row) {
  if (!row || typeof row !== "object") return null;
  const slug = grokipediaSlug(row);
  const name = String(row.name || "").trim() || slug;
  if (!slug || !name) return null;
  return {
    id: String(row.id || slug),
    slug,
    name,
    text: grokipediaText(row),
    href: grokipediaHref(row),
    personHref: row.id ? `/people/${row.id}` : "",
  };
}

export function grokipediaIndex(people) {
  return (Array.isArray(people) ? people : [])
    .map(grokipediaEntry)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findGrokipediaEntry(people, slug) {
  const needle = String(slug || "").trim();
  if (!needle) return null;
  return grokipediaIndex(people).find((entry) => entry.slug === needle) || null;
}
