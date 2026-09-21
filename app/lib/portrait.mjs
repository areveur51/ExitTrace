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

const NEWS_PORTRAIT_HOST_EXACT = new Set(
  [...NEWS_PORTRAIT_HOSTS].map((h) => String(h).toLowerCase().replace(/^www\./, "")),
);

/** Set-exact host match. `www.` is stripped; arbitrary subdomains of curated apexes are not accepted. */
export function isNewsPortraitHost(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  return Boolean(h) && NEWS_PORTRAIT_HOST_EXACT.has(h);
}

function ipv4Octets(host) {
  const m = String(host || "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return parts.every((n) => n <= 255) ? parts : null;
}

/** Loopback, RFC1918, and link-local hosts. Fail-closed on empty host. */
export function isBlockedPortraitHost(host) {
  const raw = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*/, "");
  if (!raw) return true;
  if (raw === "localhost" || raw.endsWith(".localhost") || raw === "0.0.0.0") return true;

  const v4mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4mapped) return isBlockedPortraitHost(v4mapped[1]);

  const octets = ipv4Octets(raw);
  if (octets) {
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (raw.includes(":")) {
    if (raw === "::1" || raw === "::" || raw === "0:0:0:0:0:0:0:1") return true;
    const head = raw.split(":")[0] || "";
    const n = parseInt(head.padEnd(4, "0"), 16);
    if (!Number.isFinite(n)) return true;
    if (n >= 0xfe80 && n <= 0xfebf) return true;
    if (n >= 0xfc00 && n <= 0xfdff) return true;
    return false;
  }
  return false;
}

export function isEligiblePortraitUrl(raw) {
  const text = String(raw || "").trim();
  if (!text || /^file:/i.test(text)) return false;
  const parsed = parseHttpUrl(text);
  if (!parsed) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (isBlockedPortraitHost(parsed.hostname)) return false;
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

const MAX_FETCH_HOPS = 4;

function nextPortraitUrl(current, location) {
  const loc = String(location || "").trim();
  if (!loc || /^file:/i.test(loc)) return "";
  try {
    const next = new URL(loc, current).href;
    return /^file:/i.test(next) ? "" : next;
  } catch {
    return "";
  }
}

async function fetchEligiblePortrait(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop < MAX_FETCH_HOPS; hop++) {
    if (!isEligiblePortraitUrl(current)) return null;
    const parsed = parseHttpUrl(current);
    if (!parsed || isBlockedPortraitHost(parsed.hostname)) return null;
    const res = await fetch(parsed.href, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
    });
    const finalUrl = res.url || parsed.href;
    if (!isEligiblePortraitUrl(finalUrl)) return null;
    const finalParsed = parseHttpUrl(finalUrl);
    if (!finalParsed || isBlockedPortraitHost(finalParsed.hostname)) return null;
    if (res.status >= 300 && res.status < 400) {
      current = nextPortraitUrl(parsed.href, res.headers.get("location"));
      if (!current) return null;
      continue;
    }
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
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
    const buf = await fetchEligiblePortrait(canonical);
    if (!buf || buf.length < 800) return null;
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
