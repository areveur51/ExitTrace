/** Local X-post screenshot paths. Fail-closed: missing or invalid → empty. Never invent. */

import { KIND_COMMS } from "./kind-comms.mjs";

const PREFIXES = {
  people: "/media/screenshots/people/",
  operations: "/media/screenshots/operations/",
};
for (const spec of Object.values(KIND_COMMS)) {
  PREFIXES[spec.screenshotKind] = `/media/screenshots/${spec.screenshotKind}/`;
}
PREFIXES["central-casting-comms"] = "/media/screenshots/central-casting-comms/";

/** Kind-comm supporting shots: screenshots/{kind}-comms/{id}/support/{n}/ */
const SUPPORT_KINDS = new Set([
  ...Object.values(KIND_COMMS).map((spec) => spec.screenshotKind),
  "central-casting-comms",
]);

const LEAF = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp|gif)$/i;
const SUPPORT_REL =
  /^[a-z0-9][a-z0-9._-]*\/support\/\d+\/[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp|gif)$/i;

function localRel(href, prefix, { allowSupport = false } = {}) {
  const text = String(href || "").trim();
  if (!text.startsWith(prefix) || text.includes("..") || text.includes("\\")) {
    return "";
  }
  const rel = text.slice(prefix.length);
  if (!rel) return "";
  if (!rel.includes("/")) return LEAF.test(rel) ? rel : "";
  if (allowSupport && SUPPORT_REL.test(rel)) return rel;
  return "";
}

export function screenshotKindFromHref(raw) {
  const text = String(raw || "").trim();
  for (const [kind, prefix] of Object.entries(PREFIXES)) {
    if (localRel(text, prefix, { allowSupport: SUPPORT_KINDS.has(kind) })) return kind;
  }
  return "";
}

export function isScreenshotHref(raw, kind) {
  const text = String(raw || "").trim();
  if (kind) {
    const prefix = PREFIXES[kind];
    return !!(prefix && localRel(text, prefix, { allowSupport: SUPPORT_KINDS.has(kind) }));
  }
  return !!screenshotKindFromHref(text);
}

/** Allowlisted dir for a supporting screenshot. Empty when kind/id/n are invalid. */
export function supportingScreenshotPrefix(screenshotKind, id, n) {
  const prefix = PREFIXES[screenshotKind];
  const safeId = String(id || "").trim();
  const idx = Number(n);
  if (!prefix || !SUPPORT_KINDS.has(screenshotKind)) return "";
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(safeId)) return "";
  if (!Number.isInteger(idx) || idx < 0) return "";
  return `${prefix}${safeId}/support/${idx}/`;
}

export function normalizeScreenshotHref(raw, kind) {
  const text = String(raw || "").trim();
  return isScreenshotHref(text, kind) ? text : "";
}

export function normalizeScreenshotCredit(raw) {
  return String(raw || "").trim();
}
