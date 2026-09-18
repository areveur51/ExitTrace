/** Local X-post screenshot paths. Fail-closed: missing or invalid → empty. Never invent. */

const PREFIXES = {
  people: "/media/screenshots/people/",
  "dog-comms": "/media/screenshots/dog-comms/",
  "red-folder-comms": "/media/screenshots/red-folder-comms/",
  operations: "/media/screenshots/operations/",
};

const LEAF = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp|gif)$/i;

function localLeaf(href, prefix) {
  const text = String(href || "").trim();
  if (!text.startsWith(prefix) || text.includes("..") || text.includes("\\")) {
    return "";
  }
  const leaf = text.slice(prefix.length);
  if (!leaf || leaf.includes("/") || !LEAF.test(leaf)) return "";
  return leaf;
}

export function screenshotKindFromHref(raw) {
  const text = String(raw || "").trim();
  for (const [kind, prefix] of Object.entries(PREFIXES)) {
    if (localLeaf(text, prefix)) return kind;
  }
  return "";
}

export function isScreenshotHref(raw, kind) {
  const text = String(raw || "").trim();
  if (kind) {
    const prefix = PREFIXES[kind];
    return !!(prefix && localLeaf(text, prefix));
  }
  return !!screenshotKindFromHref(text);
}

export function normalizeScreenshotHref(raw, kind) {
  const text = String(raw || "").trim();
  return isScreenshotHref(text, kind) ? text : "";
}

export function normalizeScreenshotCredit(raw) {
  return String(raw || "").trim();
}
