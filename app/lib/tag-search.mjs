/**
 * Home tag search: strict `tags` / `match` parsing, canonical URLs, and the
 * membership mask math shared by the server count line and the page payload.
 * Tag ids, labels and order come from MENU_ATTRIBUTE_TAGS (tags.mjs) only.
 */

import { MENU_ATTRIBUTE_TAGS, MENU_ATTRIBUTE_TAG_IDS } from "./tags.mjs";

export const TAG_MATCH_ALL = "all";
export const TAG_MATCH_ANY = "any";
/** All is the default match. */
export const TAG_MATCH_DEFAULT = TAG_MATCH_ALL;
/** At most one of each fact tag can be selected. */
export const TAG_SEARCH_MAX_TAGS = MENU_ATTRIBUTE_TAGS.length;
/** Raw `tags` values / comma tokens read before the rest are dropped unread. */
export const TAG_SEARCH_MAX_TOKENS = 32;
/** A combined raw `tags` value longer than this is not parsed at all. */
export const TAG_SEARCH_MAX_RAW = 1024;

const ID_SET = new Set(MENU_ATTRIBUTE_TAG_IDS);
const TOKEN_RE = /^[a-z0-9_-]{1,64}$/;

function paramsOf(searchParams) {
  return searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || "");
}

/** `all` unless the value is exactly `any` (case-insensitive). */
export function parseTagMatch(raw) {
  return String(raw ?? "").trim().toLowerCase() === TAG_MATCH_ANY ? TAG_MATCH_ANY : TAG_MATCH_ALL;
}

/**
 * Strict parse of the fact-tag search. `tags` may be one comma list (`tags=a,b`,
 * the canonical URL) or repeated checkbox values (`tags=a&tags=b`, the no-JS form).
 * A token must be a known MENU_ATTRIBUTE_TAGS id (hyphen slug form accepted); anything
 * else is dropped and only counted. Duplicates collapse. Output is in menu
 * (MENU_ATTRIBUTE_TAGS) order, so one selection has one canonical URL.
 */
export function parseTagSearch(searchParams) {
  const src = paramsOf(searchParams);
  const values = src.getAll("tags").slice(0, TAG_SEARCH_MAX_TOKENS);
  const joined = values.join(",");
  const out = { tags: [], match: parseTagMatch(src.get("match")), ignored: 0, capped: false };
  if (!joined) return out;
  if (joined.length > TAG_SEARCH_MAX_RAW) {
    out.ignored = 1;
    out.capped = true;
    return out;
  }
  const tokens = joined.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length > TAG_SEARCH_MAX_TOKENS || src.getAll("tags").length > TAG_SEARCH_MAX_TOKENS) out.capped = true;
  const seen = new Set();
  for (const raw of tokens.slice(0, TAG_SEARCH_MAX_TOKENS)) {
    const low = raw.toLowerCase();
    const id = TOKEN_RE.test(low) ? low.replace(/-/g, "_") : "";
    if (!id || !ID_SET.has(id)) {
      out.ignored += 1;
      continue;
    }
    if (seen.has(id)) continue;
    if (out.tags.length >= TAG_SEARCH_MAX_TAGS) {
      out.capped = true;
      break;
    }
    seen.add(id);
    out.tags.push(id);
  }
  out.tags.sort((a, b) => MENU_ATTRIBUTE_TAG_IDS.indexOf(a) - MENU_ATTRIBUTE_TAG_IDS.indexOf(b));
  return out;
}

/**
 * Canonical query string: `q`, then `tags=a,b`, then `match`. `match` is written
 * only when tags are selected, so a keyword-only URL stays `/search?q=...`.
 */
export function tagSearchQuery({ q = "", tags = [], match = TAG_MATCH_DEFAULT } = {}) {
  const params = new URLSearchParams();
  const keyword = String(q || "").trim();
  if (keyword) params.set("q", keyword);
  const ids = (tags || []).filter((id) => ID_SET.has(id));
  if (ids.length) {
    params.set("tags", ids.join(","));
    params.set("match", parseTagMatch(match));
  }
  // Ids are [a-z0-9_], so a literal comma is unambiguous: /search?tags=a,b&match=all.
  return params.toString().replace(/%2C/g, ",");
}

export function tagSearchHref(basePath, state) {
  const qs = tagSearchQuery(state);
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Bit for each MENU_ATTRIBUTE_TAGS id, in menu order. */
export function tagBit(id) {
  const i = MENU_ATTRIBUTE_TAG_IDS.indexOf(id);
  return i < 0 ? 0 : 2 ** i;
}

export function tagsMask(tags) {
  let m = 0;
  for (const id of new Set(tags || [])) m += tagBit(id);
  return m;
}

/**
 * Mask histogram from per-tag member id lists: `{ save_act: ["a", "b"], ... }`.
 * Returns `[[mask, people], ...]`, sorted by mask. Only people with at least one tag appear.
 */
export function membershipMasks(membersByTag) {
  const byPerson = new Map();
  for (const id of MENU_ATTRIBUTE_TAG_IDS) {
    const bit = tagBit(id);
    for (const pid of new Set(membersByTag?.[id] || [])) {
      byPerson.set(pid, (byPerson.get(pid) || 0) + bit);
    }
  }
  const hist = new Map();
  for (const m of byPerson.values()) hist.set(m, (hist.get(m) || 0) + 1);
  return [...hist.entries()].sort((a, b) => a[0] - b[0]);
}

/** People in the histogram who match `tags` under `match`. Masks fit in 17 bits, so plain ints work. */
export function countTagMatches(masks, tags, match = TAG_MATCH_DEFAULT) {
  const want = tagsMask(tags);
  if (!want) return 0;
  const all = parseTagMatch(match) === TAG_MATCH_ALL;
  let n = 0;
  for (const [m, people] of masks || []) {
    const hit = m & want;
    if (all ? hit === want : hit !== 0) n += people;
  }
  return n;
}

/**
 * Person ids in the tag set from tagMembership().members (per-tag id Sets):
 * All is the intersection, Any the union. Same membership as listPeople({ tags, tagMatch })
 * for fact tags, which imply no event kinds. Null when the Sets are missing.
 */
export function memberIdSet(membership, tags, match = TAG_MATCH_DEFAULT) {
  const sets = (tags || []).map((id) => membership?.members?.[id]);
  if (!sets.length || sets.some((set) => !(set instanceof Set))) return null;
  if (parseTagMatch(match) === TAG_MATCH_ANY) {
    const out = new Set();
    for (const set of sets) for (const id of set) out.add(id);
    return out;
  }
  const [smallest, ...rest] = sets.slice().sort((a, b) => a.size - b.size);
  return new Set([...smallest].filter((id) => rest.every((set) => set.has(id))));
}
