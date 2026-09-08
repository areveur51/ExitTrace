/** Fill-empty Grokipedia helpers. Not a standalone catalog. No live fetch. */

export const GROKIPEDIA_PATH = "/grokipedia";
export const GROKIPEDIA_CITE_ORIGIN = "https://grokipedia.com";

/** Person fields Grokipedia may fill when empty. Never guessed from prose. */
export const GROKIPEDIA_PERSON_FIELDS = ["birth_date", "country_of_origin"];

/** Event fields Grokipedia may fill when empty. Comments/synopsis stay off this list. */
export const GROKIPEDIA_EVENT_FIELDS = ["position", "organization", "country", "branch"];

export function grokipediaSlug(row) {
  const id = String(row?.id || "").trim();
  if (id && /^[a-z0-9][a-z0-9-]*$/i.test(id)) return id;
  return String(row?.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function grokipediaPageUrl(row) {
  const name = String(row?.name || "").trim();
  if (!name) return "";
  return `${GROKIPEDIA_CITE_ORIGIN}/page/${encodeURIComponent(name.replace(/\s+/g, "_"))}`;
}

export function grokipediaSource(row) {
  const src = row?.grokipedia;
  return src && typeof src === "object" && !Array.isArray(src) ? src : null;
}

export function grokipediaText(row) {
  const src = grokipediaSource(row);
  const structured = src ? String(src.text || src.summary || "").trim() : "";
  return structured || String(row?.summary || "").trim();
}

function fieldValue(src, key) {
  if (!src || typeof src !== "object") return "";
  return String(src[key] || "").trim();
}

export function newsCitesCoverStory(row) {
  if (!row || typeof row !== "object") return false;
  const top = Array.isArray(row.sources) ? row.sources : [];
  if (top.length) return true;
  const events = Array.isArray(row.events) ? row.events : [];
  return events.some((ev) => Array.isArray(ev?.sources) && ev.sources.length > 0);
}

export function grokipediaCite(row, { filled = [] } = {}) {
  const url = grokipediaPageUrl(row);
  if (!url) return null;
  const useful = Boolean(grokipediaText(row) || filled.length || grokipediaSource(row));
  if (!useful) return null;
  return {
    publisher: "Grokipedia",
    title: "Grokipedia",
    url,
  };
}

/**
 * Copy structured Grokipedia attrs onto empty person/event fields only.
 * Never overwrites gold/news values. Never parses synopsis prose.
 */
export function fillEmptyFromGrokipedia(row) {
  if (!row || typeof row !== "object") {
    return { row, filled: [], cite: null };
  }
  const src = grokipediaSource(row);
  const next = { ...row };
  const filled = [];
  if (src) {
    for (const key of GROKIPEDIA_PERSON_FIELDS) {
      if (String(next[key] || "").trim()) continue;
      const val = fieldValue(src, key);
      if (!val) continue;
      next[key] = val;
      filled.push(key);
    }
    if (Array.isArray(next.events) && next.events.length) {
      next.events = next.events.map((ev, i) => {
        if (i !== 0 || !ev || typeof ev !== "object") return ev;
        const copy = { ...ev };
        for (const key of GROKIPEDIA_EVENT_FIELDS) {
          if (String(copy[key] || "").trim()) continue;
          const val = fieldValue(src, key);
          if (!val) continue;
          copy[key] = val;
          filled.push(`events.0.${key}`);
        }
        return copy;
      });
    }
  }
  return { row: next, filled, cite: grokipediaCite(next, { filled }) };
}

export function grokipediaIndexRedirect() {
  return "/search";
}

export function grokipediaEntryRedirect(row, slug) {
  const id = String(row?.id || "").trim();
  if (id) return `/people/${id}`;
  const q = String(slug || "").trim().replace(/-/g, " ");
  return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
}

export function grokipediaEntry(row) {
  if (!row || typeof row !== "object") return null;
  const slug = grokipediaSlug(row);
  const name = String(row.name || "").trim() || slug;
  if (!slug || !name) return null;
  const { filled, cite } = fillEmptyFromGrokipedia(row);
  return {
    id: String(row.id || slug),
    slug,
    name,
    text: grokipediaText(row),
    href: grokipediaPageUrl(row),
    personHref: row.id ? `/people/${row.id}` : "",
    cite,
    filled,
    redundant: newsCitesCoverStory(row),
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
