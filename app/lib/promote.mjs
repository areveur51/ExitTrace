import { PROMOTE_CATEGORY_IDS, isDeathCategory } from "./categories.mjs";
import { partitionCiteUrls } from "./official.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

export const CITE_FLOOR = 2;
export const MATCH_WINDOW_DAYS = 3;

export class PromoteError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PromoteError";
    this.code = code;
  }
}

export function personSlug(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSubject(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function parseEventDate(raw) {
  const text = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  if (new Date(ms).toISOString().slice(0, 10) !== text) return null;
  return text;
}

function daysBetween(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(da - db) / 86_400_000;
}

export function parseCiteUrls(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const urls = [];
  const seen = new Set();
  for (const item of list) {
    const text =
      item && typeof item === "object"
        ? String(item.raw || item.url || item.canonical || "").trim()
        : String(item || "").trim();
    if (!text) continue;
    const canonical = canonicalPublicUrl(text);
    if (!canonical) {
      throw new PromoteError(
        `cite is not an http(s) URL: ${text}`,
        "invalid_cite_url",
      );
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    urls.push({ raw: text, canonical });
  }
  return urls;
}

export function citeRecords(citeUrls, eventDate) {
  return citeUrls.map((cite) => ({
    title: "",
    publisher: "",
    url: cite.raw,
    date: eventDate,
  }));
}

export function mergeCites(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const source of existing || []) {
    const url = canonicalPublicUrl(source?.url);
    if (url) seen.add(url);
    out.push(source);
  }
  const added = [];
  for (const source of incoming || []) {
    const url = canonicalPublicUrl(source?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(source);
    added.push(source);
  }
  return { sources: out, added };
}

export function findGoldMatch(people, { subject, event_date, slug }) {
  const name = normalizeSubject(subject);
  const id = slug || personSlug(subject);
  for (const row of people || []) {
    if (row.id === id) return row;
    if (normalizeSubject(row.name) !== name) continue;
    if (daysBetween(row.event_date, event_date) <= MATCH_WINDOW_DAYS) return row;
  }
  return null;
}

export function nextPersonId(people, slug, eventDate) {
  const ids = new Set((people || []).map((row) => row.id));
  if (!ids.has(slug)) return slug;
  const dated = `${slug}-${eventDate}`;
  if (!ids.has(dated)) return dated;
  throw new PromoteError(
    `person id already used: ${slug}`,
    "id_collision",
  );
}

export function validateIdentifiedPersonInput(input = {}) {
  const subject = String(input.subject || "").trim();
  if (!subject) {
    throw new PromoteError(
      "subject is required (named person; do not copy the poster)",
      "missing_subject",
    );
  }
  const event_date = parseEventDate(input.event_date);
  if (!event_date) {
    throw new PromoteError(
      "event_date is required as YYYY-MM-DD (calendar date, not posted_at)",
      "missing_event_date",
    );
  }
  const category = String(input.category || "").trim();
  if (!category) {
    throw new PromoteError("category is required", "missing_category");
  }
  if (!PROMOTE_CATEGORY_IDS.includes(category)) {
    throw new PromoteError(
      `category must be one of: ${PROMOTE_CATEGORY_IDS.join(", ")}`,
      "invalid_category",
    );
  }
  const parsedCites = parseCiteUrls(input.cite_urls);
  const { official, extra } = partitionCiteUrls(parsedCites);
  if (official.length < CITE_FLOOR) {
    throw new PromoteError(
      `need at least ${CITE_FLOOR} published-news or official gov/news-org social cite URLs`,
      "cites_floor",
    );
  }
  const slug = personSlug(subject);
  if (!slug) {
    throw new PromoteError("subject did not yield a person id", "invalid_subject");
  }
  return {
    subject,
    event_date,
    category,
    cite_urls: official,
    extra_urls: extra,
    slug,
    summary: String(input.summary || "").trim(),
    role: String(input.role || "").trim(),
    photo: String(input.photo || "").trim(),
    photo_credit: String(input.photo_credit || "").trim(),
  };
}

export function validatePromoteInput(input = {}) {
  const person = validateIdentifiedPersonInput(input);
  const id = String(input.id || "").trim();
  const source_url = String(input.source_url || "").trim();
  if (!id && !source_url) {
    throw new PromoteError(
      "source id or source_url is required",
      "missing_source",
    );
  }
  if (source_url && !canonicalPublicUrl(source_url)) {
    throw new PromoteError(
      "source_url is not an http(s) URL",
      "invalid_source_url",
    );
  }
  return { ...person, id, source_url };
}

export function buildPersonRow(input, people) {
  const death = isDeathCategory(input.category) ? input.event_date : null;
  return {
    id: nextPersonId(people, input.slug, input.event_date),
    category: input.category,
    name: input.subject,
    role: input.role,
    event_date: input.event_date,
    death_date: death,
    photo: input.photo,
    photo_credit: input.photo_credit,
    net_worth_usd: null,
    net_worth_note: "",
    net_worth_source: "",
    sources: citeRecords(input.cite_urls, input.event_date),
    summary: input.summary,
  };
}
