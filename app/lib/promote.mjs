import {
  PROMOTE_CATEGORY_IDS,
  isDeathCategory,
  isIndictmentKeepKind,
} from "./categories.mjs";
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

export function normalizeRole(role) {
  return String(role || "")
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

export function asEventDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const text = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function normalizePersonEvent(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind || raw.category || fallback.kind || fallback.category || "").trim();
  const event_date = asEventDate(raw.event_date || fallback.event_date);
  if (!kind || !event_date) return null;
  const sources = Array.isArray(raw.sources)
    ? raw.sources
    : Array.isArray(fallback.sources)
      ? fallback.sources
      : [];
  return {
    kind,
    event_date,
    sources,
  };
}

function uniqueEvents(events) {
  const byKind = new Map();
  for (const raw of events || []) {
    const ev = normalizePersonEvent(raw);
    if (!ev) continue;
    const prior = byKind.get(ev.kind);
    if (!prior) {
      byKind.set(ev.kind, ev);
      continue;
    }
    byKind.set(ev.kind, {
      kind: prior.kind,
      event_date: prior.event_date,
      sources: mergeCites(prior.sources, ev.sources).sources,
    });
  }
  return [...byKind.values()].sort((a, b) => {
    const d = String(b.event_date).localeCompare(String(a.event_date));
    if (d !== 0) return d;
    return String(a.kind).localeCompare(String(b.kind));
  });
}

/** Lift legacy category/event_date/sources into events; keep one event per kind. */
export function personEvents(row) {
  if (!row || typeof row !== "object") return [];
  let events;
  if (Array.isArray(row.events) && row.events.length) {
    events = uniqueEvents(row.events);
  } else {
    const lifted = normalizePersonEvent({
      kind: row.category,
      event_date: row.event_date,
      sources: row.sources,
    });
    events = lifted ? [lifted] : [];
  }
  const remainingSources = Array.isArray(row.sources) ? row.sources : [];
  if (remainingSources.length && events.length) {
    const known = new Set();
    for (const ev of events) {
      for (const source of ev.sources || []) {
        const url = canonicalPublicUrl(source?.url);
        if (url) known.add(url);
      }
    }
    const extras = remainingSources.filter((source) => {
      const url = canonicalPublicUrl(source?.url);
      return url && !known.has(url);
    });
    if (extras.length) {
      const primary =
        events.find((ev) => ev.kind === row.category) || events[0];
      primary.sources = mergeCites(primary.sources, extras).sources;
    }
  }
  return events;
}

export function eventForKind(events, kind) {
  const key = String(kind || "").trim();
  if (!key) return null;
  return (events || []).find((ev) => ev.kind === key) || null;
}

export function newestPersonEvent(events, kinds) {
  const list = events || [];
  const allow = Array.isArray(kinds) && kinds.length ? new Set(kinds.map(String)) : null;
  const pool = allow ? list.filter((ev) => allow.has(ev.kind)) : list;
  return pool[0] || null;
}

export function deathPersonEvent(events) {
  return (events || []).find((ev) => isDeathCategory(ev.kind)) || null;
}

export function flattenEventSources(events) {
  let sources = [];
  for (const ev of events || []) {
    sources = mergeCites(sources, ev.sources).sources;
  }
  return sources;
}

export function personHasKind(row, kinds) {
  const allow = (Array.isArray(kinds) ? kinds : [kinds]).map(String).filter(Boolean);
  if (!allow.length) return true;
  const events = personEvents(row);
  return events.some((ev) => allow.includes(ev.kind));
}

export function derivePersonFields(row, preferKinds) {
  const events = personEvents(row);
  const chosen = newestPersonEvent(events, preferKinds);
  const death = deathPersonEvent(events);
  return {
    events,
    category: chosen?.kind || row.category || "",
    event_date: chosen?.event_date || asEventDate(row.event_date),
    death_date: death?.event_date || (isDeathCategory(row.category) ? asEventDate(row.death_date) : null),
    sources: flattenEventSources(events),
  };
}

export function projectPerson(row, kinds) {
  const prefer = Array.isArray(kinds) ? kinds : kinds ? [kinds] : [];
  const derived = derivePersonFields(row, prefer.length ? prefer : undefined);
  return { ...row, ...derived };
}

/**
 * One event, one kind. Civilian and non-civilian indictment are the same
 * indictment classification — do not double-tag. Unclear stays un-tagged.
 */
export function resolveEventKind(person, kind) {
  const key = String(kind || "").trim();
  if (!isIndictmentKeepKind(key)) return key;
  const existing = personEvents(person).find((ev) => isIndictmentKeepKind(ev.kind));
  return existing ? existing.kind : key;
}

/** Gold annotate-only: existing event_date and cites stay; new cites merge. New kind is appended. */
export function attachPersonEvent(person, incoming) {
  const ev = normalizePersonEvent(incoming);
  if (!ev) {
    throw new PromoteError("event kind and event_date are required", "missing_event");
  }
  ev.kind = resolveEventKind(person, ev.kind);
  const events = personEvents(person);
  const i = events.findIndex((row) => row.kind === ev.kind);
  if (i >= 0) {
    const merged = mergeCites(events[i].sources, ev.sources);
    const next = events.slice();
    next[i] = {
      kind: events[i].kind,
      event_date: events[i].event_date,
      sources: merged.sources,
    };
    return {
      person: projectPerson({ ...person, events: next }),
      added: merged.added,
      existed: true,
    };
  }
  return {
    person: projectPerson({ ...person, events: [...events, ev] }),
    added: ev.sources.slice(),
    existed: false,
  };
}

export function rolesCompatible(a, b) {
  const ra = normalizeRole(a);
  const rb = normalizeRole(b);
  if (!ra || !rb) return null;
  if (ra === rb) return true;
  if (ra.includes(rb) || rb.includes(ra)) return true;
  return false;
}

export function basePersonId(id) {
  return String(id || "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function sameSlugIdentity(a, b) {
  if (a.id && b.id && a.id === b.id) return true;
  const slugA = personSlug(a.name || a.subject);
  const slugB = personSlug(b.name || b.subject);
  if (slugA && (a.id === slugB || b.id === slugA)) return true;
  const baseA = basePersonId(a.id);
  const baseB = basePersonId(b.id);
  if (baseA && baseA === baseB && slugA && slugA === slugB && baseA === slugA) return true;
  return false;
}

/**
 * Identity match: id/slug OR a single normalized name.
 * Never name+date+category. A new KEEP kind annotates the same person.
 * Multiple same-name rows use name+role; if still unclear, do not match.
 */
export function findGoldMatch(people, { subject, slug, role } = {}) {
  const name = normalizeSubject(subject);
  const id = slug || personSlug(subject);
  const rows = people || [];
  const byId = rows.find((row) => row.id === id);
  if (byId) return byId;

  const nameHits = name ? rows.filter((row) => normalizeSubject(row.name) === name) : [];
  if (nameHits.length === 1) return nameHits[0];
  if (nameHits.length > 1) {
    const roleHits = nameHits.filter((row) => rolesCompatible(row.role, role) === true);
    if (roleHits.length === 1) return roleHits[0];
    return null;
  }
  return null;
}

/**
 * Migration merge: prefer slug, then name+role.
 * Do not smash on name alone when dates/roles clearly differ. If unclear, leave separate.
 */
export function shouldMergePeople(a, b) {
  if (!a || !b) return false;
  if (sameSlugIdentity(a, b)) {
    if (rolesCompatible(a.role, b.role) === false) return false;
    return true;
  }
  if (normalizeSubject(a.name) !== normalizeSubject(b.name)) return false;
  return rolesCompatible(a.role, b.role) === true;
}

function preferKeepPerson(a, b) {
  const dated = /-\d{4}-\d{2}-\d{2}$/;
  if (dated.test(a.id) && !dated.test(b.id)) return [b, a];
  if (dated.test(b.id) && !dated.test(a.id)) return [a, b];
  if (String(a.id).length <= String(b.id).length) return [a, b];
  return [b, a];
}

export function mergePersonAnnotate(gold, prior) {
  const keep = projectPerson(gold);
  const extra = projectPerson(prior);
  const eventsByKind = new Map();
  for (const ev of keep.events) {
    eventsByKind.set(ev.kind, {
      kind: ev.kind,
      event_date: ev.event_date,
      sources: (ev.sources || []).slice(),
    });
  }
  for (const ev of extra.events) {
    const existing = eventsByKind.get(ev.kind);
    if (!existing) {
      eventsByKind.set(ev.kind, {
        kind: ev.kind,
        event_date: ev.event_date,
        sources: (ev.sources || []).slice(),
      });
      continue;
    }
    existing.sources = mergeCites(existing.sources, ev.sources).sources;
  }
  return projectPerson({
    ...keep,
    photo: keep.photo || extra.photo || "",
    photo_credit: keep.photo_credit || extra.photo_credit || "",
    net_worth_usd: keep.net_worth_usd ?? extra.net_worth_usd ?? null,
    net_worth_note: keep.net_worth_note || extra.net_worth_note || "",
    net_worth_source: keep.net_worth_source || extra.net_worth_source || "",
    role: keep.role || extra.role || "",
    summary: keep.summary || extra.summary || "",
    events: [...eventsByKind.values()],
  });
}

export function collapseDuplicatePeople(people) {
  const rows = (people || []).map((row) => projectPerson(row));
  const used = new Set();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    let keep = rows[i];
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(j)) continue;
      if (!shouldMergePeople(keep, rows[j])) continue;
      const [preferred, other] =
        preferKeepPerson(keep, rows[j])[0] === keep
          ? [keep, rows[j]]
          : [rows[j], keep];
      keep = mergePersonAnnotate(preferred, other);
      used.add(j);
    }
    out.push(keep);
  }
  return out;
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
    net_worth_usd: input.net_worth_usd,
    net_worth_source: String(input.net_worth_source || "").trim(),
    net_worth_note: String(input.net_worth_note || "").trim(),
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
  const events = [
    {
      kind: input.category,
      event_date: input.event_date,
      sources: citeRecords(input.cite_urls, input.event_date),
    },
  ];
  return projectPerson({
    id: nextPersonId(people, input.slug, input.event_date),
    category: input.category,
    name: input.subject,
    role: input.role,
    event_date: input.event_date,
    death_date: isDeathCategory(input.category) ? input.event_date : null,
    photo: input.photo,
    photo_credit: input.photo_credit,
    net_worth_usd: null,
    net_worth_note: "",
    net_worth_source: "",
    sources: events[0].sources,
    summary: input.summary,
    events,
  });
}
