/** Shared catalog kinds that store official-post stills (dog / red-folder).
 *  Not person KEEP tags. Table names are allowlisted here — never interpolating caller input.
 */

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
    keymapKey: "e",
    supportingGroups: true,
  }),
});

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
