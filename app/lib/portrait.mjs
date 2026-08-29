/** Attach a local Wikimedia or official-gov portrait. Never invent. Never overwrite gold. */

import fs from "fs";
import path from "path";
import { hostOf, isGovHost, parseHttpUrl } from "./official.mjs";
import { personSlug } from "./promote.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

const UA = "ExitTrace/1.0 (https://github.com/areveur51/ExitTrace; media archive)";
const EXTS = [".jpg", ".jpeg", ".png", ".webp"];

export function peopleMediaDir(mediaDir) {
  return path.join(path.resolve(mediaDir || process.env.MEDIA_DIR || "media"), "people");
}

export function isEligiblePortraitUrl(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  const host = hostOf(parsed);
  if (isGovHost(host)) return true;
  return (
    host === "upload.wikimedia.org" ||
    host === "commons.wikimedia.org" ||
    host === "wikimedia.org" ||
    host.endsWith(".wikipedia.org")
  );
}

export function isPeopleMediaHref(raw) {
  const text = String(raw || "").trim();
  return text.startsWith("/media/people/") && !text.includes("..");
}

function extOf(name, fallback = ".jpg") {
  const ext = path.extname(String(name || "")).toLowerCase();
  return EXTS.includes(ext) ? ext : fallback;
}

function stemOf(name) {
  return path.parse(path.basename(String(name || ""))).name;
}

function existingDest(dest, href, credit = "") {
  if (!fs.existsSync(dest) || fs.statSync(dest).size <= 0) return null;
  return { file: dest, href, credit };
}

export function findLocalPortrait(mediaDir, personId) {
  const id = personSlug(personId) || String(personId || "").trim();
  if (!id) return null;
  const dir = peopleMediaDir(mediaDir);
  for (const ext of EXTS) {
    const file = path.join(dir, `${id}${ext}`);
    const found = existingDest(file, `/media/people/${id}${ext}`);
    if (found) return found;
  }
  return null;
}

function creditForSource(raw, supplied = "") {
  const given = String(supplied || "").trim();
  if (given) return given;
  const parsed = parseHttpUrl(raw);
  if (!parsed) return "";
  if (isGovHost(hostOf(parsed))) return "Official government work";
  if (isEligiblePortraitUrl(raw)) return "Wikimedia Commons";
  return "";
}

function copyIntoPeople(mediaDir, personId, srcPath, srcName) {
  const id = personSlug(personId) || String(personId || "").trim();
  if (!id || !srcPath || !fs.existsSync(srcPath) || fs.statSync(srcPath).size <= 0) {
    return null;
  }
  const ext = extOf(srcName || srcPath);
  const dest = path.join(peopleMediaDir(mediaDir), `${id}${ext}`);
  const href = `/media/people/${id}${ext}`;
  const already = existingDest(dest, href);
  if (already) return already;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (path.resolve(srcPath) !== path.resolve(dest)) {
    fs.copyFileSync(srcPath, dest);
  }
  return existingDest(dest, href);
}

async function storeEligibleUrl(mediaDir, personId, url) {
  const canonical = canonicalPublicUrl(url);
  if (!isEligiblePortraitUrl(canonical)) return null;
  const id = personSlug(personId) || String(personId || "").trim();
  const ext = extOf(new URL(canonical).pathname);
  const dest = path.join(peopleMediaDir(mediaDir), `${id}${ext}`);
  const href = `/media/people/${id}${ext}`;
  const already = existingDest(dest, href, creditForSource(canonical));
  if (already) return already;
  try {
    const res = await fetch(canonical, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 800) return null;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return existingDest(dest, href, creditForSource(canonical));
  } catch {
    return null;
  }
}

function sameCatalogStill(mediaDir, filePath, personId) {
  const catalog = path.resolve(peopleMediaDir(mediaDir));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${catalog}${path.sep}`)) return true;
  return stemOf(resolved) === personId;
}

/**
 * Resolve a local portrait for a person id. Fail-closed: missing still → null.
 * Does not invent a file. Does not fetch at view time; callers are host process scripts.
 * Does not search Wikimedia by name.
 */
export async function resolvePortrait({
  mediaDir,
  personId,
  supplied,
  photo_credit,
} = {}) {
  const id = personSlug(personId) || String(personId || "").trim();
  if (!id) return null;
  const existing = findLocalPortrait(mediaDir, id);
  if (existing) {
    return { ...existing, credit: String(photo_credit || existing.credit || "") };
  }
  const raw = String(supplied || "").trim();
  if (!raw) return null;

  if (isPeopleMediaHref(raw)) {
    if (stemOf(raw) !== id) return null;
    const file = path.join(peopleMediaDir(mediaDir), path.basename(raw));
    const copied = copyIntoPeople(mediaDir, id, file, raw);
    return copied ? { ...copied, credit: String(photo_credit || "") } : null;
  }

  const asPath = path.resolve(raw);
  if (fs.existsSync(asPath) && asPath.includes(`${path.sep}people${path.sep}`)) {
    if (!sameCatalogStill(mediaDir, asPath, id)) return null;
    const copied = copyIntoPeople(mediaDir, id, asPath, asPath);
    return copied ? { ...copied, credit: String(photo_credit || "") } : null;
  }

  if (isEligiblePortraitUrl(raw)) {
    const stored = await storeEligibleUrl(mediaDir, id, raw);
    if (!stored) return null;
    return { ...stored, credit: creditForSource(raw, photo_credit) };
  }
  return null;
}
