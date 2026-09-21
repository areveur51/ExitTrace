/** Attach a local Wikimedia, official-gov, or explicitly supplied news-org portrait.
 * Never invent. Never overwrite gold. Never name-search. */

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

/** News-org hosts allowed only when a URL is explicitly supplied (KEEP --photo).
 * Never name-search. Fail-closed on unknown hosts. */
const NEWS_PORTRAIT_HOSTS = new Set([
  "i.guim.co.uk",
  "media.guim.co.uk",
  "static.guim.co.uk",
  "www.theguardian.com",
  "theguardian.com",
  "www.reuters.com",
  "reuters.com",
  "www.bbc.co.uk",
  "www.bbc.com",
  "ichef.bbci.co.uk",
  "www.nytimes.com",
  "static01.nyt.com",
  "www.washingtonpost.com",
  "www.ap.org",
  "apnews.com",
  "dims.apnews.com",
  "www.afp.com",
  "www.eluniversal.com.mx",
  "www.jornada.com.mx",
  "www.infobae.com",
  "diariocorreo.pe",
  "www.diariocorreo.pe",
  "elcomercio.pe",
  "www.elcomercio.pe",
  "www.mirror.co.uk",
  "i2-prod.mirror.co.uk",
  "www.independent.co.uk",
]);

export function isNewsPortraitHost(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (NEWS_PORTRAIT_HOSTS.has(h) || NEWS_PORTRAIT_HOSTS.has(`www.${h}`)) return true;
  return (
    h === "guim.co.uk" || h.endsWith(".guim.co.uk") ||
    h === "bbci.co.uk" || h.endsWith(".bbci.co.uk") ||
    h === "nyt.com" || h.endsWith(".nyt.com") ||
    h === "reutersmedia.net" || h.endsWith(".reutersmedia.net") ||
    h === "eluniversal.com.mx" || h.endsWith(".eluniversal.com.mx") ||
    h === "jornada.com.mx" || h.endsWith(".jornada.com.mx") ||
    h === "infobae.com" || h.endsWith(".infobae.com") ||
    h === "diariocorreo.pe" || h.endsWith(".diariocorreo.pe") ||
    h === "elcomercio.pe" || h.endsWith(".elcomercio.pe") ||
    h === "theguardian.com" || h.endsWith(".theguardian.com") ||
    h === "reuters.com" || h.endsWith(".reuters.com") ||
    h === "bbc.co.uk" || h === "bbc.com" || h.endsWith(".bbc.co.uk") || h.endsWith(".bbc.com") ||
    h === "nytimes.com" || h.endsWith(".nytimes.com") ||
    h === "washingtonpost.com" || h.endsWith(".washingtonpost.com") ||
    h === "apnews.com" || h.endsWith(".apnews.com") ||
    h === "mirror.co.uk" || h.endsWith(".mirror.co.uk") ||
    h === "independent.co.uk" || h.endsWith(".independent.co.uk")
  );
}

export function isEligiblePortraitUrl(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  const host = hostOf(parsed);
  if (isGovHost(host)) return true;
  if (
    host === "upload.wikimedia.org" ||
    host === "commons.wikimedia.org" ||
    host === "wikimedia.org" ||
    host.endsWith(".wikipedia.org")
  ) {
    return true;
  }
  return isNewsPortraitHost(host);
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
  if (isNewsPortraitHost(hostOf(parsed))) return "News organization portrait";
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
