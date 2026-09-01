/** Person identity tags — independent of event kind. Multi-tag is allowed. */

export const IDENTITY_TAGS = [
  { id: "civilian", nav: "Civilians" },
  { id: "non_civilian", nav: "Non-civilians" },
  { id: "celebrity", nav: "Celebrities" },
  { id: "official", nav: "Officials" },
  { id: "ceo", nav: "CEOs" },
];

export const IDENTITY_TAG_IDS = IDENTITY_TAGS.map((t) => t.id);

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

const TAG_SET = new Set(IDENTITY_TAG_IDS);

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

/** Union of stored tags plus tags implied by event kinds / primary category. */
export function personTags(row) {
  const kinds = [
    ...((row?.events || []).map((ev) => ev.kind).filter(Boolean)),
    row?.category,
  ];
  return normalizeTags([...(row?.tags || []), ...tagsFromKinds(kinds)]);
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

export function parseTagFilter(searchParams, pathname) {
  const src =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams || "");
  const fromQuery = src.has("tags") ? normalizeTags(src.get("tags")) : null;
  const fromPath = PATH_TAGS[String(pathname || "").split("?")[0]] || [];
  return fromQuery || fromPath.slice();
}

export function catalogMainPath(pathname) {
  const p = String(pathname || "").split("?")[0];
  if (p.startsWith("/deaths")) return "/deaths";
  if (p.startsWith("/indictments")) return "/indictments";
  if (p === "/government") return "/government";
  return p;
}

export function filterQuery({ tags, minAge, maxAge } = {}) {
  const params = new URLSearchParams();
  const selected = normalizeTags(tags);
  if (selected.length) params.set("tags", selected.join(","));
  if (minAge != null) params.set("min_age", String(minAge));
  if (maxAge != null) params.set("max_age", String(maxAge));
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

export function filterPath(basePath, filter) {
  const selected = normalizeTags(filter?.tags);
  const path = pathForTagFilter(catalogMainPath(basePath), selected);
  const q = filterQuery({
    tags:
      PATH_TAGS[path] &&
      PATH_TAGS[path].length === selected.length &&
      PATH_TAGS[path].every((id) => selected.includes(id))
        ? []
        : selected,
    minAge: filter?.minAge,
    maxAge: filter?.maxAge,
  });
  if (!q) return path;
  return `${path}?${q}`;
}

export function identityTagById(id) {
  return IDENTITY_TAGS.find((t) => t.id === id) || null;
}
