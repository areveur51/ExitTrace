/** Shared catalog kinds that store official-post stills (dog / red-folder).
 *  Not person KEEP tags. Table names are allowlisted here — never interpolating caller input.
 *
 *  Central Casting (Riker DESIGN LOCK AMEND ~1:26am ET, MIGRATION ~1:27am ET)
 *  supersedes sense and glossary. Live a0a8470 keeps the 7 person memberships,
 *  strips the retired field only, and deletes the JTitor + Warsh glossary rows.
 *  Parent `/central-casting` is one unique-person card (corona list pattern). Membership
 *  is cite URLs on the existing person — no sense split, no second person-kind, no
 *  clip cards. Harvest rows attach under that person as cites and X media. Detail
 *  reuses the red-folder masonry (cites, post summary, X link, supportive media).
 *  No glossary. No seed rows.
 *
 *  Cite gate (Admiral CLEAR):
 *  - Ongoing KEEP: official / gov / news-org, plus quote-chain standing when the
 *    chain reaches one of those. Cite-backed only.
 *  - All X media paints on the person detail when the KEEP is from X. A screenshot
 *    that misses the local allowlist is omitted (fail-closed), never invented.
 */

import { isOfficialCiteUrl } from "./official.mjs";

export const KIND_COMMS = Object.freeze({
  dog: Object.freeze({
    id: "dog",
    categoryId: "dog_comms",
    table: "dog_comms",
    memoryKey: "dog_comms",
    path: "/dog-comms",
    mediaDir: "dog-comms",
    screenshotKind: "dog-comms",
    searchType: "dog",
    cardClass: "dog-card",
    detailClass: "dog-detail",
    pageClass: "dog-page",
    label: "Dog comms",
    navLabel: "Dog",
    countNoun: "dog comms",
    keymapKey: "c",
    supportingGroups: false,
  }),
  red_folder: Object.freeze({
    id: "red_folder",
    categoryId: "red_folder_comms",
    table: "red_folder_comms",
    memoryKey: "red_folder_comms",
    path: "/red-folder-comms",
    mediaDir: "red-folder-comms",
    screenshotKind: "red-folder-comms",
    searchType: "red_folder",
    cardClass: "red-folder-card",
    detailClass: "red-folder-detail",
    pageClass: "red-folder-page",
    label: "Red Folder comms",
    navLabel: "Red Folder",
    countNoun: "red-folder comms",
    keymapKey: "e",
    supportingGroups: true,
  }),
});

/** Parent list. Legacy `/central-casting-comms` redirects here. Not a KIND_COMMS clip catalog. */
export const CENTRAL_CASTING_PATH = "/central-casting";
export const CENTRAL_CASTING_LEGACY_PATH = "/central-casting-comms";
/** c = Dog, e = Red Folder. t is free. */
export const CENTRAL_CASTING_KEYMAP = "t";
export const CENTRAL_CASTING_MEDIA_DIR = "central-casting-comms";
export const CENTRAL_CASTING_SCREENSHOT_KIND = "central-casting-comms";

/** Detail-only media spec. Not a KIND_COMMS parent list. Same masonry as red_folder. */
export const CENTRAL_CASTING_DETAIL = Object.freeze({
  id: "central_casting",
  mediaDir: CENTRAL_CASTING_MEDIA_DIR,
  screenshotKind: CENTRAL_CASTING_SCREENSHOT_KIND,
  detailClass: "central-casting-detail",
  supportingGroups: true,
  label: "Central Casting",
});

/** Documented Central Casting cite gate. Membership is not a new person KEEP kind. */
export const CENTRAL_CASTING_CITE_GATE = Object.freeze({
  id: "central_casting",
  personKeep: false,
  ongoingKeep: Object.freeze(["official", "gov", "news-org", "quote-chain"]),
  detailMedia: "all X media on detail when KEEP is from X",
  screenshot: "omit fail-closed",
});

export class CentralCastingClassifyError extends Error {
  constructor(message, code = "invalid_classification") {
    super(message);
    this.name = "CentralCastingClassifyError";
    this.code = code;
  }
}

function citeUrls(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const item of list) {
    const url =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? item.url || item.href || ""
          : "";
    const text = String(url || "").trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** Membership cites only. Legacy `{ sense, sources }` objects lose the sense and keep the URLs. */
export function normalizeCentralCasting(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return citeUrls(
    list.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!item || typeof item !== "object") return [];
      if (Array.isArray(item.sources)) return item.sources;
      if (item.url) return [item.url];
      return [];
    }),
  );
}

/** Cite-backed membership. Does not create a person-kind and does not store a sense. */
export function assertCentralCastingClassification({ sources } = {}) {
  const cites = citeUrls(sources);
  if (!cites.length) {
    throw new CentralCastingClassifyError(
      "central casting membership requires a cite",
      "missing_cite",
    );
  }
  return { sources: cites };
}

/** Keep prior membership when gold has none. Union cite URLs. Does not wipe gold people. */
export function mergeCentralCasting(gold, prior) {
  const parts = [];
  for (const side of [prior, gold]) {
    if (Array.isArray(side)) parts.push(...side);
    else if (side && typeof side === "object") parts.push(side);
  }
  return normalizeCentralCasting(parts);
}

export const KIND_COMM_IDS = Object.freeze(Object.keys(KIND_COMMS));

const TABLES = new Set(KIND_COMM_IDS.map((id) => KIND_COMMS[id].table));
const PATHS = new Map(KIND_COMM_IDS.map((id) => [KIND_COMMS[id].path, KIND_COMMS[id]]));
const CATEGORY_IDS = new Map(KIND_COMM_IDS.map((id) => [KIND_COMMS[id].categoryId, KIND_COMMS[id]]));

export function commsKind(kind) {
  const key = typeof kind === "string" ? kind : kind?.id;
  const spec = KIND_COMMS[key];
  if (!spec) {
    throw new Error(`unknown comms kind: ${key || "(empty)"}`);
  }
  return spec;
}

/** List catalogs stay KIND_COMMS. Central Casting detail reuses the same media shape. */
export function mediaSpec(kind) {
  const key = typeof kind === "string" ? kind : kind?.id;
  if (KIND_COMMS[key]) return KIND_COMMS[key];
  if (key === CENTRAL_CASTING_DETAIL.id) return CENTRAL_CASTING_DETAIL;
  throw new Error(`unknown media spec: ${key || "(empty)"}`);
}

export function isCommsKind(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_COMMS, String(kind || ""));
}

export function isCommsCategoryId(id) {
  return CATEGORY_IDS.has(String(id || ""));
}

export function commsKindByCategoryId(id) {
  return CATEGORY_IDS.get(String(id || "")) || null;
}

export function commsKindByPath(pathname) {
  const p = String(pathname || "").split("?")[0] || "";
  if (PATHS.has(p)) return PATHS.get(p);
  for (const spec of Object.values(KIND_COMMS)) {
    if (p.startsWith(`${spec.path}/`) && p !== spec.path) return spec;
  }
  return null;
}

export function commsKindByApiPath(pathname) {
  const p = String(pathname || "").split("?")[0] || "";
  for (const spec of Object.values(KIND_COMMS)) {
    if (p === `/api${spec.path}`) return spec;
  }
  return null;
}

export function isCommsTable(name) {
  return TABLES.has(String(name || ""));
}

export function commsMediaPrefix(kind) {
  const spec = typeof kind === "string" && kind.includes("/") ? null : KIND_COMMS[kind];
  const dir = spec ? spec.mediaDir : String(kind || "");
  return `/media/${dir}/`;
}

export function commsThumbKinds() {
  return KIND_COMM_IDS.map((id) => KIND_COMMS[id].mediaDir);
}

/** Home count segment: "N dog comms · N red-folder comms". Central Casting is a person count, not a clip count. */
export function commsHomeCountLabel(counts = {}) {
  return KIND_COMM_IDS.map((id) => {
    const spec = KIND_COMMS[id];
    const n = Number(counts?.[spec.memoryKey]) || 0;
    return `${n} ${spec.countNoun}`;
  }).join(" · ");
}

/**
 * Central Casting cite standing.
 * "official" — the post URL itself is official/gov/news-org.
 * "quote_chain" — the post is not, but a URL in the chain is.
 * "" — no standing.
 */
export function centralCastingCiteStanding({ sourceUrl = "", quotedUrls = [] } = {}) {
  const chain = [sourceUrl, ...(Array.isArray(quotedUrls) ? quotedUrls : [])]
    .map((url) => String(url || "").trim())
    .filter(Boolean);
  if (isOfficialCiteUrl(sourceUrl)) return "official";
  if (chain.some((url) => isOfficialCiteUrl(url))) return "quote_chain";
  return "";
}
