/**
 * Derived-thumb path shape, shared by thumb.mjs (serving and rendering) and
 * rate-limit.mjs (the GET/HEAD thumb exemption). No imports, so the limiter
 * does not load the image stack or kind-comms.
 *
 * THUMB_KIND_DIRS must equal ["people", "agencies", ...commsThumbKinds()].
 * tests/thumb-path.test.mjs checks that, so a new comms kind fails the
 * suite until it is added here.
 */

export const THUMBS_PREFIX = "/media/thumbs/";

export const THUMB_KIND_DIRS = Object.freeze([
  "people",
  "agencies",
  "dog-comms",
  "red-folder-comms",
  "eagle-comms",
  "ronald-comms",
  "shot-comms",
]);

/** Longest stem isThumbPathname accepts. A longer name is counted. */
export const THUMB_STEM_MAX = 200;

const THUMB_REL_SOURCE = `^thumbs/(${THUMB_KIND_DIRS.join("|")})/([a-z0-9][a-z0-9_-]*)(\\.(?:2x|card2x|card|hero))?\\.(jpg|webp)$`;

/** Serving shape. Case-insensitive, as thumb.mjs has always parsed it. */
export const THUMB_REL = new RegExp(THUMB_REL_SOURCE, "i");

/** Exemption shape. Case-sensitive: only the lowercase form the app emits. */
const THUMB_REL_EXACT = new RegExp(THUMB_REL_SOURCE);

export function parseThumbRel(thumbRel) {
  const m = String(thumbRel || "").match(THUMB_REL);
  if (!m) return null;
  const kind = m[1];
  const stem = m[2];
  const variant = (m[3] || "").toLowerCase();
  const ext = m[4].toLowerCase();
  return {
    kind,
    stem,
    variant,
    ext,
    rel: `thumbs/${kind}/${stem}${variant}.${ext}`,
  };
}

/**
 * True only for a raw URL pathname that is exactly a derived thumb href:
 * /media/thumbs/<allowed kind>/<lowercase stem up to THUMB_STEM_MAX>[variant].<jpg|webp>.
 * Pass the pathname as received (not decoded), so any "%" form, dot segment,
 * extra slash, ";param", uppercase letter or unknown kind misses.
 */
export function isThumbPathname(pathname) {
  const p = typeof pathname === "string" ? pathname : "";
  if (!p.startsWith(THUMBS_PREFIX)) return false;
  const rel = p.slice("/media/".length);
  const m = rel.match(THUMB_REL_EXACT);
  if (!m || m[2].length > THUMB_STEM_MAX) return false;
  const parsed = parseThumbRel(rel);
  return !!parsed && parsed.rel === rel;
}
