/** Shared catalog kinds that store official-post stills (dog / red-folder / central casting).
 *  Not person KEEP tags. Table names are allowlisted here — never interpolating caller input.
 *
 *  Central Casting (Riker formal lock): one catalog, column `sense` NOT NULL,
 *  only `looks_the_part` | `replacement`. Both senses are valid. No child routes in v1.
 *  List filter is `?sense=`. No seed rows in this PR (seed after MERGE+PLACE on lab).
 *
 *  Cite gate (Admiral CLEAR):
 *  - Ongoing KEEP: official / gov / news-org, plus quote-chain standing when the
 *    chain reaches one of those.
 *  - All post media paints on the detail page. A screenshot that misses the
 *    local allowlist is omitted (fail-closed), never invented.
 *  - Definition seed only: when the chain has no official, an Admiral-named cite
 *    may park the row (death_unconfirmed-class). That exception is seed-only.
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
  central_casting: Object.freeze({
    id: "central_casting",
    categoryId: "central_casting_comms",
    table: "central_casting_comms",
    memoryKey: "central_casting_comms",
    path: "/central-casting-comms",
    mediaDir: "central-casting-comms",
    screenshotKind: "central-casting-comms",
    searchType: "central_casting",
    cardClass: "central-casting-card",
    detailClass: "central-casting-detail",
    pageClass: "central-casting-page",
    label: "Central Casting comms",
    navLabel: "Central Casting",
    countNoun: "central casting comms",
    // c = Dog, e = Red Folder. t is free; do not steal those keys.
    keymapKey: "t",
    supportingGroups: true,
  }),
});

/** Documented Central Casting cite gate. Ongoing KEEP is not the seed exception. */
export const CENTRAL_CASTING_CITE_GATE = Object.freeze({
  id: "central_casting",
  personKeep: false,
  senses: Object.freeze(["looks_the_part", "replacement"]),
  ongoingKeep: Object.freeze(["official", "gov", "news-org", "quote-chain"]),
  detailMedia: "all post media on detail",
  screenshot: "omit fail-closed",
  seedOnly:
    "Admiral-named cite when the chain has no official (death_unconfirmed-class cite gate for seed only)",
});

/** Riker formal lock: central_casting_comms.sense allows only these values. */
export const CENTRAL_CASTING_SENSES = Object.freeze(["looks_the_part", "replacement"]);

export const CENTRAL_CASTING_SENSE_LABELS = Object.freeze({
  looks_the_part: "Looks the part",
  replacement: "Replacement",
});

export class CentralCastingSenseError extends Error {
  constructor(sense) {
    super(`invalid central casting sense: ${sense || "(empty)"}`);
    this.name = "CentralCastingSenseError";
    this.code = "invalid_sense";
  }
}

export function assertCentralCastingSense(raw) {
  const sense = String(raw ?? "").trim();
  if (!CENTRAL_CASTING_SENSES.includes(sense)) throw new CentralCastingSenseError(sense);
  return sense;
}

/** Empty / missing query means All. Any other string must be a locked sense. */
export function centralCastingSenseFilter(raw) {
  if (raw == null) return "";
  const sense = String(raw).trim();
  if (!sense) return "";
  return assertCentralCastingSense(sense);
}

export function centralCastingSenseLabel(sense) {
  return CENTRAL_CASTING_SENSE_LABELS[sense] || "";
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

/** Home count segment: "N dog comms · N red-folder comms · N central casting comms". */
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
 * "seed_admiral_named" — seed only, chain has no official, Admiral-named cite.
 * "" — no standing (not ongoing KEEP, and not the seed exception).
 */
export function centralCastingCiteStanding({
  sourceUrl = "",
  quotedUrls = [],
  seed = false,
  admiralNamed = false,
} = {}) {
  const chain = [sourceUrl, ...(Array.isArray(quotedUrls) ? quotedUrls : [])]
    .map((url) => String(url || "").trim())
    .filter(Boolean);
  const sourceOfficial = isOfficialCiteUrl(sourceUrl);
  if (sourceOfficial) return "official";
  if (chain.some((url) => isOfficialCiteUrl(url))) return "quote_chain";
  if (seed && admiralNamed) return "seed_admiral_named";
  return "";
}
