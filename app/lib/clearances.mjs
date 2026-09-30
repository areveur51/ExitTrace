import { isOfficialPublisherUrl } from "./official.mjs";

const STATUS_MAX = 40;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AUTHORITY_MAX = 120;
const SCOPE_MAX = 180;
const ROLE_MAX = 180;
const TITLE_MAX = 180;
const PUBLISHER_MAX = 80;
const SNIPPET_MAX = 280;

const STATUS_LABELS = {
  revoked: "Revoked",
};

function clip(raw, max) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseList(raw) {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

function clearanceSource(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url || "").trim();
  if (!isOfficialPublisherUrl(url)) return null;
  const out = { url };
  const title = clip(raw.title, TITLE_MAX);
  const publisher = clip(raw.publisher, PUBLISHER_MAX);
  const snippet = clip(raw.snippet, SNIPPET_MAX);
  const date = String(raw.date || "").trim();
  if (title) out.title = title;
  if (publisher) out.publisher = publisher;
  if (snippet) out.snippet = snippet;
  if (DATE_RE.test(date)) out.date = date;
  return out;
}

/**
 * Cited security-clearance facts only. Not an exit category.
 * A row needs a known status, a cite-stated day, an authority, and
 * two official news or government cites. Fewer cites drops the row.
 */
export function normalizeClearances(raw) {
  const out = [];
  const seen = new Map();
  for (const item of parseList(raw)) {
    if (!item || typeof item !== "object") continue;
    const status = clip(item.status, STATUS_MAX).toLowerCase();
    const date = String(item.date || "").trim();
    const authority = clip(item.authority, AUTHORITY_MAX);
    if (!STATUS_LABELS[status] || !DATE_RE.test(date) || !authority) continue;
    if (/https?:\/\//i.test(authority)) continue;
    const sources = [];
    const urls = new Set();
    for (const source of Array.isArray(item.sources) ? item.sources : []) {
      const next = clearanceSource(source);
      if (!next || urls.has(next.url)) continue;
      urls.add(next.url);
      sources.push(next);
    }
    if (sources.length < 2) continue;
    const role = clip(item.role, ROLE_MAX);
    const scope = clip(item.scope, SCOPE_MAX);
    const key = `${status}|${date}|${authority.toLowerCase()}`;
    const prior = seen.get(key);
    if (!prior) {
      const row = { status, date, authority, sources };
      if (role && !/https?:\/\//i.test(role)) row.role = role;
      if (scope && !/https?:\/\//i.test(scope)) row.scope = scope;
      seen.set(key, row);
      out.push(row);
      continue;
    }
    if (!prior.role && role && !/https?:\/\//i.test(role)) prior.role = role;
    if (!prior.scope && scope && !/https?:\/\//i.test(scope)) prior.scope = scope;
    for (const source of sources) {
      if (prior.sources.some((s) => s.url === source.url)) continue;
      prior.sources.push(source);
    }
  }
  return out;
}

/** Union by status, day, and authority. An empty side does not wipe the other. */
export function mergeClearances(gold, prior) {
  return normalizeClearances([
    ...parseList(prior).filter((item) => item && typeof item === "object"),
    ...parseList(gold).filter((item) => item && typeof item === "object"),
  ]);
}

export function clearanceJson(raw) {
  return JSON.stringify(normalizeClearances(raw));
}

export function clearanceStatusLabel(status) {
  return STATUS_LABELS[clip(status, STATUS_MAX).toLowerCase()] || "";
}

export function clearanceMetaLabel(count) {
  return count > 1 ? "Security clearances" : "Security clearance";
}
