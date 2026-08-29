/** Official government accounts and cite URLs. Random social does not count. */

import { canonicalPublicUrl } from "./urls.mjs";

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "m.twitter.com"]);

const SOCIAL_HOSTS = new Set([
  ...X_HOSTS,
  "facebook.com",
  "fb.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "reddit.com",
  "threads.net",
  "bsky.app",
  "truthsocial.com",
]);

/** Official government X/Twitter handles (no @). Seed accounts plus common .gov desks. */
export const OFFICIAL_GOV_HANDLES = new Set(
  [
    "potus",
    "vp",
    "flotus",
    "whitehouse",
    "deptofdefense",
    "dod_dha",
    "secdef",
    "usarmy",
    "usnavy",
    "usmc",
    "usairforce",
    "spaceforce",
    "82ndabndiv",
    "nationalguard",
    "statedept",
    "dhsgov",
    "fema",
    "cbp",
    "icegov",
    "uscis",
    "tsa",
    "secretsservice",
    "fbi",
    "cia",
    "nsa",
    "odnigov",
    "thejusticedept",
    "atfhq",
    "dea",
    "ustreasury",
    "irsnews",
    "uscensusbureau",
    "usedgov",
    "hhsgov",
    "cdcgov",
    "nih",
    "fda",
    "cmsgov",
    "va",
    "usdot",
    "nhtsa",
    "faa",
    "energy",
    "interior",
    "usinterior",
    "usda",
    "epagov",
    "nasagov",
    "nasa",
    "noaa",
    "usgs",
    "usnps",
    "usfws",
    "usforestservice",
    "congress",
    "senategop",
    "senatedems",
    "housegop",
    "housedemocrats",
    "scotus",
    "ussupremecourt",
    "10downingstreet",
    "foreignoffice",
    "cabinetofficeuk",
    "ukparliament",
    "mod_uk",
    "royalfamily",
    "canada",
    "canadianpm",
    "govau",
    "alboMP",
  ].map((h) => h.toLowerCase()),
);

/** Official news-org social handles. Random personal accounts do not count as cites. */
export const OFFICIAL_NEWS_HANDLES = new Set(
  [
    "nytimes",
    "washingtonpost",
    "wsj",
    "reuters",
    "ap",
    "apnews",
    "bbcnews",
    "bbcworld",
    "guardian",
    "theguardian",
    "ft",
    "bloomberg",
    "npr",
    "pbs",
    "cnn",
    "abc",
    "cbsnews",
    "nbcnews",
    "politico",
    "axios",
    "thehill",
    "latimes",
    "usatoday",
    "afp",
    "dwnews",
    "france24",
  ].map((h) => h.toLowerCase()),
);

export function stripHandle(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@/, "")
    .replace(/\s+/g, "");
}

export function normalizeHandle(raw) {
  const h = stripHandle(raw);
  return h ? `@${h}` : "";
}

export function handleKey(raw) {
  return stripHandle(raw).toLowerCase();
}

export function parseHttpUrl(raw) {
  const canonical = canonicalPublicUrl(raw);
  if (!canonical) return null;
  try {
    return new URL(canonical);
  } catch {
    return null;
  }
}

export function hostOf(url) {
  const parsed = url instanceof URL ? url : parseHttpUrl(url);
  if (!parsed) return "";
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

export function isSocialHost(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (SOCIAL_HOSTS.has(h)) return true;
  return [...SOCIAL_HOSTS].some((root) => h === root || h.endsWith(`.${root}`));
}

export function isGovHost(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  return h === "gov" || h.endsWith(".gov") || h.endsWith(".gov.uk") || h.endsWith(".gc.ca");
}

export function xStatusParts(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed || !X_HOSTS.has(hostOf(parsed))) return null;
  const m = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
  if (!m) return null;
  return { handle: normalizeHandle(m[1]), statusId: m[2] };
}

export function handleFromUrl(raw) {
  const status = xStatusParts(raw);
  if (status) return status.handle;
  const parsed = parseHttpUrl(raw);
  if (!parsed || !X_HOSTS.has(hostOf(parsed))) return "";
  const m = parsed.pathname.match(/^\/([^/]+)\/?$/);
  return m ? normalizeHandle(m[1]) : "";
}

export function isOfficialGovHandle(raw) {
  const key = handleKey(raw);
  return Boolean(key) && OFFICIAL_GOV_HANDLES.has(key);
}

export function isOfficialNewsHandle(raw) {
  const key = handleKey(raw);
  return Boolean(key) && OFFICIAL_NEWS_HANDLES.has(key);
}

export function isOfficialGovPostUrl(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  if (isGovHost(hostOf(parsed))) return true;
  const status = xStatusParts(raw);
  return Boolean(status && isOfficialGovHandle(status.handle));
}

export function isOfficialGovAccountOrUrl({ handle, source_url } = {}) {
  const urlHandle = handleFromUrl(source_url);
  const resolved = normalizeHandle(handle) || urlHandle;
  if (source_url) {
    const parsed = parseHttpUrl(source_url);
    if (!parsed) return false;
    if (isGovHost(hostOf(parsed))) return true;
    if (isSocialHost(hostOf(parsed))) {
      if (!isOfficialGovPostUrl(source_url) && !isOfficialGovHandle(urlHandle || resolved)) {
        return false;
      }
    } else if (!isGovHost(hostOf(parsed))) {
      return false;
    }
  }
  if (resolved && !isOfficialGovHandle(resolved) && !isGovHost(hostOf(source_url))) {
    return false;
  }
  return Boolean(resolved || (source_url && isOfficialGovPostUrl(source_url)));
}

/** Published news URL, or official news-org / government social. Random social is false. */
export function isOfficialCiteUrl(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  const host = hostOf(parsed);
  if (isGovHost(host)) return true;
  if (!isSocialHost(host)) return true;
  const handle = handleFromUrl(raw) || (xStatusParts(raw)?.handle ?? "");
  return isOfficialGovHandle(handle) || isOfficialNewsHandle(handle);
}

export function isUnofficialOrCommentarySocial(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  if (!isSocialHost(hostOf(parsed))) return false;
  return !isOfficialCiteUrl(raw);
}

export function unofficialSocialReason(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return "cite is not an http(s) URL";
  if (!isSocialHost(hostOf(parsed))) return "";
  if (isOfficialCiteUrl(raw)) return "";
  return "unofficial or commentary social is extra only, not a cite";
}

/** Official/news/gov URLs count as cites. Unofficial or commentary social is extra only. */
export function partitionCiteUrls(parsedCites) {
  const official = [];
  const extra = [];
  const seen = new Set();
  for (const cite of parsedCites || []) {
    const canonical = cite.canonical || "";
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    if (isOfficialCiteUrl(cite.raw) || isOfficialCiteUrl(cite.canonical)) {
      official.push(cite);
    } else {
      extra.push(cite);
    }
  }
  return { official, extra };
}
