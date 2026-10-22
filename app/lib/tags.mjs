import { personCareer } from "./career.mjs";
import { normalizeClearances } from "./clearances.mjs";

/** Person identity tags — independent of event kind. Multi-tag is allowed. */

export const IDENTITY_TAGS = [
  { id: "civilian", nav: "Civilians" },
  { id: "non_civilian", nav: "Non-civilians" },
  { id: "celebrity", nav: "Celebrities" },
  { id: "official", nav: "Officials" },
  { id: "ceo", nav: "Executives" },
];

export const IDENTITY_TAG_IDS = IDENTITY_TAGS.map((t) => t.id);

/**
 * Fact tags. Not identity, and not implied by an event kind. A fact tag can imply
 * another fact tag (IMPLIED_TAGS).
 * The catalog menu has a letterless Tags section. Each row links to the people who already store that fact.
 * They are not catalog hotkeys.
 */
/** Person category for a flight-log card that has no other catalog entry. Not a nav page. */
export const EPSTEIN_CLIENTS_CATEGORY = "epstein_clients";

export const ATTRIBUTE_TAGS = [
  {
    id: "clearance_revoked",
    nav: "Revoked clearances",
    path: "/tags/clearance-revoked",
    lede:
      "People with a stored security-clearance revocation.",
  },
  {
    id: "trump_nickname",
    nav: "Trump nicknames",
    path: "/tags/trump-nicknames",
    lede:
      "People with a stored Trump nickname.",
  },
  {
    id: "epstein_clients",
    nav: "Epstein Clients",
    path: "/tags/epstein-clients",
    lede:
      "People named on the Epstein flight log.",
  },
  {
    id: "epstein_files",
    nav: "Epstein files",
    path: "/tags/epstein-files",
    lede:
      "People named in a stored Epstein-files document.",
  },
  {
    id: "masks",
    nav: "Masks",
    path: "/tags/masks",
    lede:
      "People stored with a mask, body-double, or impersonation claim. Impersonation is part of what this tag records.",
  },
  {
    id: "epstein_transparency_act",
    nav: "Transparency Act",
    path: "/tags/transparency-act",
    lede:
      "People with a stored vote against the Epstein Files Transparency Act, H.R. 4405, or against a House Rules Committee motion to consider it. The House passed the bill 427-1 on November 18, 2025.",
  },
  {
    id: "endorsements",
    nav: "Endorsements",
    path: "/tags/endorsements",
    lede:
      "People with a stored endorsement from Donald Trump.",
  },
  {
    id: "harassment_records",
    nav: "Harassment records",
    path: "/tags/harassment-records",
    lede:
      "People who voted yea on March 4, 2026 to refer H. Res. 1100 to the House Committee on Ethics. Roll Call 83 passed 357-65, with 1 present. The resolution would have directed the committee to preserve and publicly release records of its reviews of sexual harassment and of clause 18 of House Rule XXIII.",
  },
  {
    id: "ukraine_aid_flags",
    nav: "Ukraine aid",
    path: "/tags/ukraine-aid",
    lede:
      "People who voted yea on April 20, 2024, on H.R. 8035, the Ukraine Security Supplemental Appropriations Act, 2024. Roll Call 151 passed 311-112, with 1 present.",
  },
  {
    id: "former_intel_agency_personnel",
    nav: "Former intel",
    path: "/tags/former-intel-agency-personnel",
    lede:
      "People with stored former employment at a U.S. intelligence agency.",
  },
];

export const ATTRIBUTE_TAG_IDS = ATTRIBUTE_TAGS.map((t) => t.id);

const FORMER_INTEL_TAG = "former_intel_agency_personnel";

/**
 * Card ids that never served at an intel agency. Adding an id here is how an
 * operator blocks the Former intel tag for a non-intel card: the auto-tag
 * never adds it, and the store write path / gap-upsert drop a stored
 * former_intel_agency_personnel so a stale import, seed, or gap-upsert cannot
 * reintroduce it.
 */
export const FORMER_INTEL_EXCLUDE = Object.freeze(["john-bolton"]);

/**
 * Agency / role phrases that count as intelligence-agency service. Word
 * boundaries so "National Security Advisor" does not match NSA. Congressional
 * committee text is excluded in isIntelAgencyText.
 * INTEL_AGENCY_PATTERNS is the frozen source list. INTEL_AGENCY_RE is those
 * same alternatives compiled once; each alternative keeps its own boundaries.
 */
export const INTEL_AGENCY_PATTERNS = Object.freeze([
  /\bcia\b/,
  /\bcentral intelligence agency\b/,
  /\bnsa\b/,
  /\bnational security agency\b/,
  /\bdia\b/,
  /\bdefense intelligence agency\b/,
  /\bodni\b/,
  /\bdni\b/,
  /\bdirector(?:ate)? of national intelligence\b/,
  /\boffice of the director of national intelligence\b/,
  /\bnational counterterrorism center\b/,
  /\bnctc\b/,
  /\bnational intelligence council\b/,
  /\bnational intelligence officer\b/,
  /\bnga\b/,
  /\bnational geospatial-?intelligence agency\b/,
  /\bnro\b/,
  /\bnational reconnaissance office\b/,
  /\bstate\b.{0,20}\binr\b/,
  /\bbureau of intelligence and research\b/,
  /\bfbi intelligence branch\b/,
  /\bfbi national security branch\b/,
  /\bunder secretary of defense for intelligence(?: and security)?\b/,
  /\bmilitary intelligence\b/,
  /\barmy intelligence\b/,
  /\boffice of naval intelligence\b/,
  /\bair force intelligence\b/,
  /\bair force\b.{0,40}\bisr\b/,
  /\bmarine corps intelligence\b/,
  /\bintelligence official\b/,
  /\bintelligence officer\b/,
  /\bintelligence agenc(?:y|ies)\b/,
  /\bintelligence community\b/,
]);

export const INTEL_AGENCY_RE = new RegExp(
  INTEL_AGENCY_PATTERNS.map((re) => `(?:${re.source})`).join("|"),
);

export function isIntelAgencyText(text) {
  const folded = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!folded) return false;
  if (/\bcommittee\b/.test(folded)) return false;
  return INTEL_AGENCY_RE.test(folded);
}

function jsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function cardHasIntelAgencyRole(row) {
  if (!row || typeof row !== "object") return false;
  for (const item of personCareer({ career: jsonArray(row.career ?? row.service_history ?? row.person_career) })) {
    if (
      isIntelAgencyText(item.title) ||
      isIntelAgencyText(item.organization) ||
      isIntelAgencyText(item.branch)
    ) {
      return true;
    }
  }
  for (const item of normalizeClearances(row.clearances)) {
    if (isIntelAgencyText(item.role)) return true;
  }
  return false;
}

function formerIntelExcluded(row) {
  const id = String(row?.id || "")
    .trim()
    .toLowerCase();
  return Boolean(id) && FORMER_INTEL_EXCLUDE.includes(id);
}

/**
 * Fact tags that imply other fact tags. A revoked clearance implies former
 * intel-agency personnel only when the card itself records an intelligence-
 * agency role (career title / organization / branch, or a clearance row role)
 * and the id is not in FORMER_INTEL_EXCLUDE (standing rule, 2026-10-22). The
 * store writes the implied tag into people.tags on every insert and update, so
 * tag filters and tag lists see it as a stored tag. personTags and the public
 * gap-upsert apply it again as an idempotent guard. Add-only for everyone else:
 * a stored Former intel tag is never stripped from a non-excluded card.
 * A filter query is not expanded: asking for Former intel does not also select
 * revoked clearances. Former intel alone never implies a revoked clearance.
 */
export const IMPLIED_TAGS = Object.freeze({
  clearance_revoked: Object.freeze([FORMER_INTEL_TAG]),
});

/**
 * Stored tag list plus Former intel when IMPLIED_TAGS and the card's recorded
 * intel-agency role allow it. `row` is optional: { id, career, clearances }.
 * With no row this is a pure copy of the list — no additions. Excluded ids
 * never gain Former intel, and a stored copy is dropped so write paths cannot
 * reintroduce it. Non-excluded cards are add-only.
 * Unknown values are kept as-is (normalizeTags drops them where needed).
 */
export function withImpliedTags(raw, row) {
  const list = Array.isArray(raw) ? raw.slice() : [];
  if (!row || typeof row !== "object") return list;
  if (formerIntelExcluded(row)) {
    return list.filter((item) => normalizeTag(item) !== FORMER_INTEL_TAG);
  }
  const have = new Set(list.map((item) => normalizeTag(item)).filter(Boolean));
  // Career/clearance scan only when a tag implies Former intel and the list
  // does not already have it. Cached so one call inspects the row at most once.
  let allowFormerIntel;
  for (let i = 0; i < list.length; i += 1) {
    for (const implied of IMPLIED_TAGS[normalizeTag(list[i])] || []) {
      if (have.has(implied)) continue;
      if (implied === FORMER_INTEL_TAG) {
        if (allowFormerIntel === undefined) allowFormerIntel = cardHasIntelAgencyRole(row);
        if (!allowFormerIntel) continue;
      }
      have.add(implied);
      list.push(implied);
    }
  }
  return list;
}

/** Event kinds that imply an identity tag. Gold rows often have only the kind. */
export const KIND_TAGS = {
  death_celebrity: ["celebrity"],
  death_official: ["official"],
  death_ceo: ["ceo"],
  indictment_civilian: ["civilian"],
  indictment_non_civilian: ["non_civilian"],
  government_stepdowns: ["official"],
};

export const PATH_TAGS = {
  "/deaths/celebrities": ["celebrity"],
  "/deaths/officials": ["official"],
  "/deaths/ceos": ["ceo"],
  "/indictments/civilians": ["civilian"],
  "/indictments/non-civilians": ["non_civilian"],
  "/government": ["official"],
};

const TAG_SET = new Set([...IDENTITY_TAG_IDS, ...ATTRIBUTE_TAG_IDS]);

/**
 * Event filter token for indictment lists. Not an identity tag and not a KEEP kind.
 * Stored as person_events.unsealed / people.events[].unsealed, not people.tags.
 */
export const UNSEALED_FILTER = "unsealed";

function searchParamsOf(searchParams) {
  return searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || "");
}

function rawTagTokens(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return list
    .map((item) =>
      String(item || "")
        .trim()
        .toLowerCase()
        .replace(/-/g, "_"),
    )
    .filter(Boolean);
}

export function normalizeTag(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return TAG_SET.has(id) ? id : null;
}

export function normalizeTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = normalizeTag(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function tagsFromKinds(kinds) {
  const out = [];
  const seen = new Set();
  for (const kind of kinds || []) {
    for (const id of KIND_TAGS[kind] || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Union of stored tags, tags implied by event kinds / primary category, and IMPLIED_TAGS. */
export function personTags(row) {
  const kinds = [
    ...((row?.events || []).map((ev) => ev.kind).filter(Boolean)),
    row?.category,
  ];
  return normalizeTags(withImpliedTags([...(row?.tags || []), ...tagsFromKinds(kinds)], row));
}

export function kindsImplyingTags(tags) {
  const want = new Set(normalizeTags(tags));
  if (!want.size) return [];
  const kinds = [];
  for (const [kind, implied] of Object.entries(KIND_TAGS)) {
    if (implied.some((id) => want.has(id))) kinds.push(kind);
  }
  return kinds;
}

/** OR: a person matches if they have any of the selected tags. */
export function matchesTags(row, tags) {
  const want = normalizeTags(tags);
  if (!want.length) return true;
  const have = new Set(personTags(row));
  return want.some((id) => have.has(id));
}

/** True when the tags query includes the indictment event token `unsealed`. */
export function parseUnsealedFilter(searchParams) {
  const src = searchParamsOf(searchParams);
  if (!src.has("tags")) return false;
  return rawTagTokens(src.get("tags")).includes(UNSEALED_FILTER);
}

export function parseTagFilter(searchParams, pathname) {
  const src = searchParamsOf(searchParams);
  const fromPath = PATH_TAGS[String(pathname || "").split("?")[0]] || [];
  if (!src.has("tags")) return fromPath.slice();
  const identity = normalizeTags(
    rawTagTokens(src.get("tags")).filter((id) => id !== UNSEALED_FILTER),
  );
  // `?tags=unsealed` is an event filter. Keep the path's identity slice.
  if (!identity.length && parseUnsealedFilter(src)) return fromPath.slice();
  return identity;
}

export function catalogMainPath(pathname) {
  const p = String(pathname || "").split("?")[0];
  if (p.startsWith("/deaths")) return "/deaths";
  if (p.startsWith("/indictments")) return "/indictments";
  if (p.startsWith("/group-operations")) return "/group-operations";
  if (p === "/government") return "/government";
  return p;
}

export function filterQuery({ tags, unsealed = false } = {}) {
  const params = new URLSearchParams();
  const parts = normalizeTags(tags);
  if (unsealed) parts.push(UNSEALED_FILTER);
  if (parts.length) params.set("tags", parts.join(","));
  return params.toString();
}

export function pathForTagFilter(mainPath, tags) {
  const selected = normalizeTags(tags);
  if (selected.length === 1) {
    const only = selected[0];
    const child = {
      "/deaths": {
        celebrity: "/deaths/celebrities",
        official: "/deaths/officials",
        ceo: "/deaths/ceos",
      },
      "/indictments": {
        civilian: "/indictments/civilians",
        non_civilian: "/indictments/non-civilians",
      },
    }[mainPath];
    if (child && child[only]) return child[only];
  }
  return catalogMainPath(mainPath) || "/";
}

/**
 * Indictment list dropdown rows for the event token. Same paths as the
 * `?tags=unsealed` filter: identity stays on the civilian child route,
 * unsealed stays a query token. Not a route and not an identity tag.
 */
export function indictmentUnsealedSelectOptions() {
  return [
    { tags: [], label: "Unsealed" },
    { tags: ["civilian"], label: "Unsealed·Civilians" },
    { tags: ["non_civilian"], label: "Unsealed·Non-civilians" },
  ].map(({ tags, label }) => ({
    label,
    href: filterPath("/indictments", { tags, unsealed: true }),
  }));
}

export function filterPath(basePath, filter) {
  const selected = normalizeTags(filter?.tags);
  const unsealed = filter?.unsealed === true;
  const main = catalogMainPath(basePath);
  const here = String(basePath || "").split("?")[0];
  const path =
    here === "/deaths/unconfirmed" && !selected.length
      ? here
      : main === "/group-operations" &&
          here.startsWith("/group-operations/") &&
          !selected.length
        ? here
        : pathForTagFilter(main, selected);
  const q = filterQuery({
    tags:
      PATH_TAGS[path] &&
      PATH_TAGS[path].length === selected.length &&
      PATH_TAGS[path].every((id) => selected.includes(id))
        ? []
        : selected,
    unsealed,
  });
  if (!q) return path;
  return `${path}?${q}`;
}

export function identityTagById(id) {
  return IDENTITY_TAGS.find((t) => t.id === id) || null;
}

export function attributeTagById(id) {
  return ATTRIBUTE_TAGS.find((t) => t.id === id) || null;
}

export function attributeTagByPath(pathname) {
  const p = String(pathname || "").split("?")[0];
  return ATTRIBUTE_TAGS.find((t) => t.path === p) || null;
}
