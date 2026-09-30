import { isOfficialPublisherUrl } from "./official.mjs";

const NAME_MAX = 80;
const BY_MAX = 80;
const TITLE_MAX = 180;
const PUBLISHER_MAX = 80;
const SNIPPET_MAX = 280;

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

function nicknameSource(raw) {
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  return out;
}

function nicknameName(raw) {
  const name = clip(raw, NAME_MAX);
  if (!name || /https?:\/\//i.test(name)) return "";
  return name;
}

/** Cited nicknames only. Fewer than two official news or government cites drops the row. */
export function normalizeNicknames(raw) {
  const out = [];
  const seen = new Map();
  for (const item of parseList(raw)) {
    if (!item || typeof item !== "object") continue;
    const name = nicknameName(item.name);
    const by = clip(item.by, BY_MAX);
    if (!name || !by) continue;
    const sources = [];
    const urls = new Set();
    for (const source of Array.isArray(item.sources) ? item.sources : []) {
      const next = nicknameSource(source);
      if (!next || urls.has(next.url)) continue;
      urls.add(next.url);
      sources.push(next);
    }
    if (sources.length < 2) continue;
    const key = name.toLowerCase();
    const prior = seen.get(key);
    if (!prior) {
      const row = { name, by, sources };
      seen.set(key, row);
      out.push(row);
      continue;
    }
    for (const source of sources) {
      if (prior.sources.some((s) => s.url === source.url)) continue;
      prior.sources.push(source);
    }
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
