import { isOfficialPublisherUrl } from "./official.mjs";

const NAME_MAX = 80;
const BY_MAX = 80;
const TITLE_MAX = 180;
const PUBLISHER_MAX = 80;
const SNIPPET_MAX = 280;
const TRUMP_NICKNAME_LIST_URL =
  "https://en.wikipedia.org/wiki/List_of_nicknames_used_by_Donald_Trump";

function isTrumpNicknameListUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    return (
      u.protocol === "https:" &&
      u.hostname === "en.wikipedia.org" &&
      u.pathname === "/wiki/List_of_nicknames_used_by_Donald_Trump" &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}

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

function nicknameSource(raw, { listException = false } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url || "").trim();
  const official = isOfficialPublisherUrl(url);
  if (!official && !(listException && isTrumpNicknameListUrl(url))) return null;
  const out = { url };
  const title = clip(raw.title, TITLE_MAX);
  const publisher = clip(raw.publisher, PUBLISHER_MAX);
  const snippet = clip(raw.snippet, SNIPPET_MAX);
  const date = String(raw.date || "").trim();
  if (title) out.title = title;
  if (publisher) out.publisher = publisher;
  if (snippet) out.snippet = snippet;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  return out;
}

function nicknameName(raw) {
  const name = clip(raw, NAME_MAX);
  if (!name || /https?:\/\//i.test(name)) return "";
  return name;
}

function officialNicknameSources(sources) {
  return sources.filter((source) => isOfficialPublisherUrl(source.url));
}

function absorbNickname(prior, sources, listException) {
  const combined = [];
  const seen = new Set();
  for (const source of [...prior.sources, ...sources]) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    combined.push(source);
  }
  const official = officialNicknameSources(combined);
  if (official.length >= 2) {
    prior.sources = official;
    delete prior.list_exception;
    return;
  }
  prior.sources = combined;
  if (prior.list_exception || listException) prior.list_exception = true;
}

/** Ordinary rows need two official cites. A Wikipedia-list exception does not. */
export function normalizeNicknames(raw) {
  const out = [];
  const seen = new Map();
  for (const item of parseList(raw)) {
    if (!item || typeof item !== "object") continue;
    const name = nicknameName(item.name);
    const by = clip(item.by, BY_MAX);
    if (!name || !by) continue;
    const listException = item.list_exception === true;
    const sources = [];
    const urls = new Set();
    for (const source of Array.isArray(item.sources) ? item.sources : []) {
      const next = nicknameSource(source, { listException });
      if (!next || urls.has(next.url)) continue;
      urls.add(next.url);
      sources.push(next);
    }
    const official = officialNicknameSources(sources);
    const keepException = listException && official.length < 2;
    if (!keepException && official.length < 2) continue;
    const stored = keepException ? sources : official;
    const key = name.toLowerCase();
    const prior = seen.get(key);
    if (!prior) {
      const row = { name, by, sources: stored };
      if (keepException) row.list_exception = true;
      seen.set(key, row);
      out.push(row);
      continue;
    }
    absorbNickname(prior, stored, keepException);
  }
  return out;
}

/** Union by nickname. An empty side does not wipe the other. */
export function mergeNicknames(gold, prior) {
  return normalizeNicknames([
    ...(parseList(prior).filter((item) => item && typeof item === "object")),
    ...(parseList(gold).filter((item) => item && typeof item === "object")),
  ]);
}

export function nicknameJson(raw) {
  return JSON.stringify(normalizeNicknames(raw));
}

export function trumpNicknameLabel(count) {
  return count > 1 ? "Trump nicknames" : "Trump nickname";
}

export function isTrumpNickname(item) {
  return clip(item?.by, BY_MAX).toLowerCase() === "donald trump";
}

/** Earliest official cite day for a Trump nickname. Not an exit date. */
export function trumpNicknameReportDate(raw) {
  let earliest = "";
  for (const item of normalizeNicknames(raw)) {
    if (!isTrumpNickname(item)) continue;
    for (const source of item.sources || []) {
      const date = String(source.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!earliest || date < earliest) earliest = date;
    }
  }
  return earliest || null;
}

/** Cite day for a card whose only entry is a Trump nickname. Other entries keep their own date. */
export function nicknameCatalogDate(row) {
  if (!row || row.event_date || row.death_date) return null;
  if (String(row.category || "") && row.category !== "nickname") return null;
  if (Array.isArray(row.clearances) && row.clearances.length) return null;
  const events = Array.isArray(row.events) ? row.events : [];
  if (events.some((ev) => ev && ev.kind && ev.kind !== "nickname")) return null;
  return trumpNicknameReportDate(row.nicknames);
}
