import {
  PROMOTE_CATEGORY_IDS,
  isDeathCategory,
  isDeathUnconfirmed,
  isGroupOpsCategory,
  isIndictmentKeepKind,
} from "./categories.mjs";
import { parseStoredAge, stampEventAge } from "./age.mjs";
import {
  eventFromLead,
  isMilitaryInput,
  evidenceCorpus,
  mapLeadReason,
  mergeEventAttrs,
  normalizeEventAttrs,
  normalizeEventMedia,
  parseHeadcount,
  parseOriginCountry,
  parseOriginUnknown,
  originText,
  ORIGIN_UNKNOWN_REASON_MAX,
  resolveEventCalendar,
  unsealedFromEvidence,
} from "./event-attrs.mjs";
import { personTags } from "./tags.mjs";
import { VOTE_FACT_KINDS, VOTE_NO_KINDS, normalizeRollCall } from "./vote-rolls.mjs";
import { mergeCareer, personCareer } from "./career.mjs";
import { mergeCentralCasting } from "./kind-comms.mjs";
import { mergeClearances, normalizeClearances } from "./clearances.mjs";
import { mergeNicknames, normalizeNicknames } from "./nicknames.mjs";
import { partitionCiteUrls } from "./official.mjs";
import { normalizeScreenshotCredit, normalizeScreenshotHref } from "./screenshot.mjs";
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

/**
 * Optional calendar birth date. Blank / missing → null (SQL NULL).
 * Never invent from age, year-only, or month-year.
 */
export function parseOptionalBirthDate(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const parsed = parseEventDate(text);
  if (!parsed) {
    throw new PromoteError(
      "birth_date must be YYYY-MM-DD when present; do not invent from age or month-year",
      "invalid_birth_date",
    );
  }
  return parsed;
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

/** Allowlisted people screenshot on an event. Header `people.screenshot` is separate. */
function applyEventShot(event, ...candidates) {
  if (!event || event.screenshot) return event;
  for (const raw of candidates) {
    const href = normalizeScreenshotHref(raw?.screenshot, "people");
    if (!href) continue;
    event.screenshot = href;
    const credit = normalizeScreenshotCredit(raw?.screenshot_credit);
    if (credit) event.screenshot_credit = credit;
    break;
  }
  return event;
}

function isNotableKind(kind) {
  return String(kind || "").trim() === "notable";
}

/**
 * Kinds a person may hold more than once, keyed by seq (person_events PK
 * (person_id, kind, seq)). Every other kind stays one event per kind at seq 0.
 * Adding a kind here is app-only: the database CHECK only requires seq >= 0
 * once the multi-event migration (2026-10-26-multi-event-up.sql) is applied.
 */
export const REPEATABLE_EVENT_KINDS = Object.freeze(["notable", "red_folder"]);
const REPEATABLE_SET = new Set(REPEATABLE_EVENT_KINDS);

export function isRepeatableKind(kind) {
  return REPEATABLE_SET.has(String(kind || "").trim());
}

/** Integer seq ≥ 0, or null when missing / invalid. */
export function parseEventSeq(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? raw : null;
  }
  const text = String(raw).trim();
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  return Number(text);
}

export function hasExplicitSeq(ev) {
  if (!ev || typeof ev !== "object") return false;
  return parseEventSeq(ev.seq) != null;
}

/** Stable notable identity. Missing seq is 0. Non-notable callers get 0. */
export function notableSeq(ev) {
  const n = parseEventSeq(ev?.seq);
  return n == null ? 0 : n;
}

/** Stored seq for any event: the parsed seq for a repeatable kind, else 0. */
export function eventSeq(ev) {
  return isRepeatableKind(ev?.kind) ? notableSeq(ev) : 0;
}

function citeUrlSet(ev) {
  const set = new Set();
  for (const source of ev?.sources || []) {
    const url = canonicalPublicUrl(source?.url);
    if (url) set.add(url);
  }
  return set;
}

function overlappingCiteUrls(a, b) {
  const other = citeUrlSet(b);
  if (!other.size) return false;
  for (const url of citeUrlSet(a)) {
    if (other.has(url)) return true;
  }
  return false;
}

/**
 * Two notables are the same event when they share an explicit seq, or when
 * the incoming row has no seq and they share a date plus an overlapping cite,
 * identical comments, or both lack a date. Different dates never fold unless
 * seq matches. seq is stable identity.
 */
export function sameNotable(a, b) {
  if (!isNotableKind(a?.kind) || !isNotableKind(b?.kind)) return false;
  return sameRepeatableEvent(a, b);
}

/** Same rule as sameNotable for any repeatable kind (notable, red_folder). Kinds must match. */
export function sameRepeatableEvent(a, b) {
  const kind = String(a?.kind || "").trim();
  if (!isRepeatableKind(kind) || kind !== String(b?.kind || "").trim()) return false;
  if (hasExplicitSeq(b)) return notableSeq(a) === parseEventSeq(b.seq);
  const da = asEventDate(a?.event_date) || null;
  const db = asEventDate(b?.event_date) || null;
  if (da !== db) return false;
  if (overlappingCiteUrls(a, b)) return true;
  if (String(a?.comments || "") === String(b?.comments || "")) return true;
  if (!da && !db) return true;
  return false;
}

/** Dedup key after seq assignment. A repeatable kind is `${kind}:${seq}`; other kinds are the kind. */
export function eventKey(ev) {
  const kind = String(ev?.kind || "").trim();
  if (isRepeatableKind(kind)) return `${kind}:${notableSeq(ev)}`;
  return kind;
}

/** Next free seq for one repeatable kind on this person (0 when none). */
export function nextEventSeq(events, kind = "notable") {
  const key = String(kind || "").trim();
  let max = -1;
  for (const ev of events || []) {
    if (String(ev?.kind || "").trim() !== key) continue;
    max = Math.max(max, notableSeq(ev));
  }
  return max + 1;
}

export function nextNotableSeq(events) {
  return nextEventSeq(events, "notable");
}

/** Events of one kind, newest event_date first. Null dates last, then seq ascending. */
export function eventsOfKind(events, kind) {
  const key = String(kind || "").trim();
  return (events || [])
    .filter((ev) => String(ev?.kind || "").trim() === key)
    .slice()
    .sort((a, b) => {
      const da = asEventDate(a?.event_date) || "";
      const db = asEventDate(b?.event_date) || "";
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      }
      return notableSeq(a) - notableSeq(b);
    });
}

/** Notable events, newest event_date first. Null dates last, then seq ascending. */
export function notableEvents(events) {
  return (events || [])
    .filter((ev) => isNotableKind(ev?.kind))
    .slice()
    .sort((a, b) => {
      const da = asEventDate(a?.event_date) || "";
      const db = asEventDate(b?.event_date) || "";
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      }
      return notableSeq(a) - notableSeq(b);
    });
}

function compareUniqueEvents(a, b) {
  const d = String(b.event_date || "").localeCompare(String(a.event_date || ""));
  if (d !== 0) return d;
  const k = String(a.kind || "").localeCompare(String(b.kind || ""));
  if (k !== 0) return k;
  return notableSeq(a) - notableSeq(b);
}

function sameVoteRoll(row, ev) {
  return normalizeRollCall(row?.roll_call) === normalizeRollCall(ev?.roll_call);
}

function findMergeIndex(events, ev) {
  if (isRepeatableKind(ev?.kind)) {
    return (events || []).findIndex((row) => sameRepeatableEvent(row, ev));
  }
  const kind = String(ev?.kind || "").trim();
  if (VOTE_NO_KINDS.has(kind)) {
    return (events || []).findIndex((row) => row.kind === kind && sameVoteRoll(row, ev));
  }
  return (events || []).findIndex((row) => row.kind === kind);
}

/** Roll id for a recorded-no kind. Other kinds never store roll_call. */
function keptRollCall(kind, ...raws) {
  if (!VOTE_NO_KINDS.has(String(kind || "").trim())) return "";
  for (const raw of raws) {
    const roll = normalizeRollCall(raw?.roll_call);
    if (roll) return roll;
  }
  for (const raw of raws) {
    const roll = normalizeRollCall(raw?.comments);
    if (roll) return roll;
  }
  return "";
}

export function normalizePersonEvent(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind || raw.category || fallback.kind || fallback.category || "").trim();
  if (!kind || isGroupOpsCategory(kind)) return null;
  // death_unconfirmed may omit event_date. Do not copy another event's date onto it.
  const unconfirmed = isDeathUnconfirmed(kind);
  const rawDate =
    raw.event_date != null && String(raw.event_date).trim() !== ""
      ? raw.event_date
      : unconfirmed
        ? null
        : fallback.event_date;
  const event_date = asEventDate(rawDate);
  if (!event_date && !unconfirmed) return null;
  const sources = Array.isArray(raw.sources)
    ? raw.sources
    : Array.isArray(fallback.sources)
      ? fallback.sources
      : [];
  const attrs = mergeEventAttrs(fallback, raw);
  const age_at_event =
    parseStoredAge(raw.age_at_event) ?? parseStoredAge(fallback.age_at_event);
  const event = {
    kind,
    event_date: event_date || null,
    sources,
    ...attrs,
    age_at_event,
  };
  if (isRepeatableKind(kind)) {
    const seq = parseEventSeq(raw.seq) ?? parseEventSeq(fallback.seq);
    if (seq != null) event.seq = seq;
  }
  const headcount = parseHeadcount(raw.headcount) ?? parseHeadcount(fallback.headcount);
  if (headcount != null) event.headcount = headcount;
  if (isIndictmentKeepKind(kind)) {
    event.unsealed =
      raw.unsealed === true || fallback.unsealed === true ? true : null;
  }
  const media = normalizeEventMedia([
    ...(Array.isArray(fallback.media) ? fallback.media : []),
    ...(Array.isArray(raw.media) ? raw.media : []),
  ]);
  if (media.length) event.media = media;
  const rollCall = keptRollCall(kind, raw, fallback);
  if (rollCall) event.roll_call = rollCall;
  if (keptHeadlineExclude(raw, fallback)) event.headline_exclude = true;
  applyEventShot(event, raw, fallback);
  return event;
}

/**
 * Opt-in pin: an event stored with `headline_exclude: true` stays on the card
 * and in its kind's lists, but never drives the card headline (category and
 * date). Only a literal true counts; anything else is dropped.
 */
export function isHeadlineExcluded(ev) {
  return ev?.headline_exclude === true;
}

function keptHeadlineExclude(...events) {
  return events.some((ev) => isHeadlineExcluded(ev));
}

function mergedUnsealed(kind, ...flags) {
  if (!isIndictmentKeepKind(kind)) return null;
  return flags.some((flag) => flag === true) ? true : null;
}

/** Keep a stored calendar date. Fill a null death_unconfirmed date only from an explicit one. */
function keptEventDate(prior, incoming) {
  if (!isDeathUnconfirmed(prior?.kind)) return prior.event_date;
  return prior.event_date || incoming.event_date || null;
}

function mergePersonEvent(prior, ev) {
  const merged = {
    kind: prior.kind,
    event_date: keptEventDate(prior, ev),
    sources: mergeCites(prior.sources, ev.sources).sources,
    ...mergeEventAttrs(prior, ev),
    age_at_event:
      parseStoredAge(prior.age_at_event) ?? parseStoredAge(ev.age_at_event),
  };
  if (isRepeatableKind(prior.kind)) merged.seq = notableSeq(prior);
  const headcount = parseHeadcount(prior.headcount) ?? parseHeadcount(ev.headcount);
  if (headcount != null) merged.headcount = headcount;
  if (isIndictmentKeepKind(prior.kind)) {
    merged.unsealed = mergedUnsealed(prior.kind, prior.unsealed, ev.unsealed);
  }
  const media = normalizeEventMedia([...(prior.media || []), ...(ev.media || [])]);
  if (media.length) merged.media = media;
  const rollCall = keptRollCall(prior.kind, prior, ev);
  if (rollCall) merged.roll_call = rollCall;
  if (keptHeadlineExclude(prior, ev)) merged.headline_exclude = true;
  applyEventShot(merged, prior, ev);
  return merged;
}

function copyEventRow(ev) {
  const row = {
    kind: ev.kind,
    event_date: ev.event_date,
    sources: (ev.sources || []).slice(),
    ...mergeEventAttrs(ev, {}),
    age_at_event: parseStoredAge(ev.age_at_event),
  };
  if (isRepeatableKind(ev.kind)) row.seq = notableSeq(ev);
  if (parseHeadcount(ev.headcount) != null) row.headcount = parseHeadcount(ev.headcount);
  if (isIndictmentKeepKind(ev.kind)) {
    row.unsealed = mergedUnsealed(ev.kind, ev.unsealed);
  }
  const media = normalizeEventMedia(ev.media);
  if (media.length) row.media = media;
  const rollCall = keptRollCall(ev.kind, ev);
  if (rollCall) row.roll_call = rollCall;
  if (isHeadlineExcluded(ev)) row.headline_exclude = true;
  applyEventShot(row, ev);
  return row;
}

/**
 * One event per (person, kind) except a repeatable kind (notable, red_folder), which may repeat keyed by seq.
 * Order: event_date desc, then kind, then seq asc.
 */
export function uniqueEvents(events) {
  const out = [];
  for (const raw of events || []) {
    const ev = normalizePersonEvent(raw);
    if (!ev) continue;
    const i = findMergeIndex(out, ev);
    if (i >= 0) {
      out[i] = mergePersonEvent(out[i], ev);
      continue;
    }
    if (isRepeatableKind(ev.kind) && !hasExplicitSeq(ev)) {
      ev.seq = nextEventSeq(out, ev.kind);
    }
    out.push(ev);
  }
  return out.sort(compareUniqueEvents);
}

/**
 * Set only after events are unique, cites are merged, and ages are stamped.
 * A symbol stays out of JSON snapshots and string-key copies. Object spread
 * drops it, so a replaced events array is normalized again.
 */
export const EVENTS_READY = Symbol.for("exittrace.personEventsReady");

/** Non-enumerable so object spread and JSON omit it. */
export function markEventsReady(row) {
  if (!row || typeof row !== "object" || row[EVENTS_READY] === true) return row;
  Object.defineProperty(row, EVENTS_READY, { value: true });
  return row;
}

/** Lift legacy category/event_date/sources into events; one event per kind except notable (seq). */
export function personEvents(row) {
  if (!row || typeof row !== "object") return [];
  if (row[EVENTS_READY] === true && Array.isArray(row.events)) return row.events;
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
  if (isRepeatableKind(key)) return eventsOfKind(events, key)[0] || null;
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

/** Shot, Endorsement, and recorded-vote facts are not catalog kinds. They must not replace the stored category or its date. */
function catalogEventKind(kind, stored) {
  const key = String(kind || "").trim();
  if (!key || key === "shot" || key === "endorsement" || VOTE_FACT_KINDS.has(key)) return false;
  if (PROMOTE_CATEGORY_IDS.includes(key) || isDeathUnconfirmed(key)) return true;
  return key === stored;
}

export function derivePersonFields(row, preferKinds) {
  const events = personEvents(row);
  const stored = String(row.category || "").trim();
  // A headline_exclude event never drives the unfiltered card headline.
  const drivers = events.filter((ev) => catalogEventKind(ev.kind, stored) && !isHeadlineExcluded(ev));
  const chosen = newestPersonEvent(preferKinds ? events : drivers, preferKinds);
  const death = deathPersonEvent(events);
  // Notable is a block on the card. It does not replace nickname or another stored category.
  const notableOnly =
    events.length > 0 && events.every((ev) => String(ev?.kind || "") === "notable");
  const category = preferKinds
    ? chosen?.kind || stored
    : notableOnly && stored && stored !== "notable"
      ? stored
      : chosen?.kind || stored;
  return {
    events,
    category,
    event_date: chosen?.event_date || asEventDate(row.event_date),
    death_date: death?.event_date || (isDeathCategory(row.category) ? asEventDate(row.death_date) : null),
    sources: flattenEventSources(events),
    age_at_event: parseStoredAge(chosen?.age_at_event),
  };
}

export function projectPerson(row, kinds) {
  const prefer = Array.isArray(kinds) ? kinds : kinds ? [kinds] : [];
  const derived = derivePersonFields(row, prefer.length ? prefer : undefined);
  const stamped = derived.events.map((ev) => stampEventAge(ev, row.birth_date));
  const chosen = newestPersonEvent(
    prefer.length ? stamped : stamped.filter((ev) => !isHeadlineExcluded(ev)),
    prefer.length ? prefer : undefined,
  );
  const projected = {
    ...row,
    ...derived,
    events: stamped,
    age_at_event:
      parseStoredAge(chosen?.age_at_event) ??
      parseStoredAge(derived.age_at_event),
  };
  projected.tags = personTags(projected);
  return markEventsReady(projected);
}

/**
 * One event, one kind. Civilian and non-civilian indictment are the same
 * indictment classification — do not double-tag. Unclear stays un-tagged.
 * `unsealed` is not a kind: true only when cites clearly state unsealed or
 * made public; otherwise null. A stored true is not cleared.
 */
export function resolveEventKind(person, kind) {
  const key = String(kind || "").trim();
  if (!isIndictmentKeepKind(key)) return key;
  const existing = personEvents(person).find((ev) => isIndictmentKeepKind(ev.kind));
  return existing ? existing.kind : key;
}

/** Gold annotate-only: existing event_date and cites stay; new cites merge. New kind is appended. A second notable or red_folder event with a different date (or seq) is a new row. */
export function attachPersonEvent(person, incoming) {
  const ev = normalizePersonEvent(incoming);
  if (!ev) {
    throw new PromoteError("event kind and event_date are required", "missing_event");
  }
  ev.kind = resolveEventKind(person, ev.kind);
  const events = personEvents(person);
  const i = findMergeIndex(events, ev);
  if (i >= 0) {
    const merged = mergeCites(events[i].sources, ev.sources);
    const next = events.slice();
    next[i] = mergePersonEvent(events[i], ev);
    return {
      person: projectPerson({ ...person, events: next }),
      added: merged.added,
      existed: true,
    };
  }
  if (isRepeatableKind(ev.kind) && !hasExplicitSeq(ev)) {
    ev.seq = nextEventSeq(events, ev.kind);
  }
  return {
    person: projectPerson({
      ...person,
      events: [...events, stampEventAge(ev, person.birth_date)],
    }),
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
  const events = keep.events.map((ev) => copyEventRow(ev));
  for (const ev of extra.events) {
    if (isRepeatableKind(ev.kind)) {
      // Seq is per-person and per kind. Match extra notables / red folders by date/cites, then assign a new seq.
      const incoming = { ...copyEventRow(ev) };
      delete incoming.seq;
      const i = findMergeIndex(events, incoming);
      if (i >= 0) {
        events[i] = mergePersonEvent(events[i], ev);
        continue;
      }
      const row = copyEventRow(ev);
      row.seq = nextEventSeq(events, row.kind);
      events.push(row);
      continue;
    }
    // Non-notable: origin/main merge. Gold event_date stays as-is (no
    // death_unconfirmed fill from the prior row). age_at_event fills only
    // when null. applyEventShot(existing, ev).
    const i = findMergeIndex(events, ev);
    if (i < 0) {
      events.push(copyEventRow(ev));
      continue;
    }
    const existing = events[i];
    existing.sources = mergeCites(existing.sources, ev.sources).sources;
    Object.assign(existing, mergeEventAttrs(existing, ev));
    const rollCall = keptRollCall(existing.kind, existing, ev);
    if (rollCall) existing.roll_call = rollCall;
    const headcount = parseHeadcount(existing.headcount) ?? parseHeadcount(ev.headcount);
    if (headcount != null) existing.headcount = headcount;
    if (existing.age_at_event == null) {
      existing.age_at_event = parseStoredAge(ev.age_at_event);
    }
    if (isIndictmentKeepKind(existing.kind)) {
      existing.unsealed = mergedUnsealed(
        existing.kind,
        existing.unsealed,
        ev.unsealed,
      );
    }
    const media = normalizeEventMedia([...(existing.media || []), ...(ev.media || [])]);
    if (media.length) existing.media = media;
    applyEventShot(existing, ev);
  }
  return projectPerson({
    ...keep,
    photo: keep.photo || extra.photo || "",
    photo_credit: keep.photo_credit || extra.photo_credit || "",
    screenshot: keep.screenshot || extra.screenshot || "",
    screenshot_credit: keep.screenshot_credit || extra.screenshot_credit || "",
    net_worth_usd: keep.net_worth_usd ?? extra.net_worth_usd ?? null,
    net_worth_note: keep.net_worth_note || extra.net_worth_note || "",
    net_worth_source: keep.net_worth_source || extra.net_worth_source || "",
    role: keep.role || extra.role || "",
    summary: keep.summary || extra.summary || "",
    birth_date: keep.birth_date || extra.birth_date || null,
    country_of_origin: keep.country_of_origin || extra.country_of_origin || "",
    events,
    career: mergeCareer(keep.career, extra.career),
    tags: [...(keep.tags || []), ...(extra.tags || [])],
    central_casting: mergeCentralCasting(keep.central_casting, extra.central_casting),
    nicknames: mergeNicknames(keep.nicknames, extra.nicknames),
    clearances: mergeClearances(keep.clearances, extra.clearances),
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
  const calendar = resolveEventCalendar(input);
  const event_date = calendar.event_date;
  if (!event_date) {
    throw new PromoteError(
      "event_date is required as YYYY-MM-DD (Last Day or Announced; not posted_at)",
      "missing_event_date",
    );
  }
  const attrs = normalizeEventAttrs(input);
  let category = String(input.category || "").trim();
  if (!category) {
    category =
      mapLeadReason(input.reason, {
        role: input.role || attrs.position,
        tags: input.tags,
      }) || "";
  }
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
  const birth_date = parseOptionalBirthDate(
    input.birth_date ?? input.birthDate ?? input["Birth Date"],
  );
  const country_of_origin = parseOriginCountry(input);
  const { origin_unknown, origin_unknown_reason } = parseOriginUnknown(input);
  const military = isMilitaryInput(input);
  return {
    subject,
    event_date,
    category,
    cite_urls: official,
    extra_urls: extra,
    slug,
    summary: String(input.summary || "").trim(),
    role: String(input.role || attrs.position || "").trim(),
    announced_date: calendar.announced_date,
    ...attrs,
    birth_date,
    country_of_origin,
    origin_unknown,
    origin_unknown_reason,
    military,
    career: personCareer(input),
    unsealed: unsealedFromEvidence(
      { ...input, unsealed_evidence: evidenceCorpus(input) },
      category,
    ),
    unsealed_evidence: evidenceCorpus(input),
    photo: String(input.photo || "").trim(),
    photo_credit: String(input.photo_credit || "").trim(),
    net_worth_usd: input.net_worth_usd,
    net_worth_source: String(input.net_worth_source || "").trim(),
    net_worth_note: String(input.net_worth_note || "").trim(),
  };
}

/**
 * Fail-closed on NEW person insert only. Existing rows stay empty until backfill.
 * birth_date is optional: unknown stores as null, never "".
 */
export function assertNewPersonInsertLock(input = {}) {
  const origin = originText(input.country_of_origin);
  const { origin_unknown, origin_unknown_reason } = parseOriginUnknown(input);
  if (origin && origin_unknown) {
    throw new PromoteError(
      "country_of_origin and origin_unknown=true are mutually exclusive",
      "origin_conflict",
    );
  }
  if (!origin && !origin_unknown) {
    throw new PromoteError(
      "country of origin is required on new person insert " +
        "(or origin_unknown=true with origin_unknown_reason when no cited source states it)",
      "missing_origin_country",
    );
  }
  if (!origin && !origin_unknown_reason) {
    throw new PromoteError(
      "origin_unknown=true requires origin_unknown_reason (why no cited source states origin)",
      "missing_origin_unknown_reason",
    );
  }
  if (!origin && origin_unknown_reason.length > ORIGIN_UNKNOWN_REASON_MAX) {
    throw new PromoteError(
      `origin_unknown_reason must be at most ${ORIGIN_UNKNOWN_REASON_MAX} characters`,
      "origin_unknown_reason_too_long",
    );
  }
  if (!String(input.position || "").trim()) {
    throw new PromoteError(
      "position is required on new person insert",
      "missing_position",
    );
  }
  if (!String(input.organization || "").trim()) {
    throw new PromoteError(
      "organization is required on new person insert",
      "missing_organization",
    );
  }
  if (!String(input.comments || "").trim()) {
    throw new PromoteError(
      "reason of event is required on new person insert (comments/reason)",
      "missing_reason",
    );
  }
  if (isMilitaryInput(input) && !String(input.branch || "").trim()) {
    throw new PromoteError(
      "branch is required on new military person insert",
      "missing_branch",
    );
  }
  return input;
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

export function incomingPersonEvent(input, sources) {
  const lead = eventFromLead(input, { kind: input.category, tags: input.tags });
  const attrs = normalizeEventAttrs(input);
  const event = {
    kind: input.category,
    event_date: input.event_date,
    announced_date: input.announced_date || lead?.announced_date || "",
    sources: sources || [],
    ...attrs,
  };
  if (isIndictmentKeepKind(input.category)) {
    event.unsealed = unsealedFromEvidence(
      { ...input, sources: sources || input.sources },
      input.category,
    );
  }
  // Second guard at intake: allowlisted local paths, deduped, store cap.
  const media = normalizeEventMedia(input.media);
  if (media.length) event.media = media;
  if (input.screenshot) event.screenshot = input.screenshot;
  if (input.screenshot_credit) event.screenshot_credit = input.screenshot_credit;
  return event;
}

export function buildPersonRow(input, people) {
  const incoming = incomingPersonEvent(
    input,
    citeRecords(input.cite_urls, input.event_date),
  );
  const events = [stampEventAge(incoming, input.birth_date)];
  return projectPerson({
    id: nextPersonId(people, input.slug, input.event_date),
    category: input.category,
    name: input.subject,
    role: input.role,
    event_date: input.event_date,
    death_date: isDeathCategory(input.category) ? input.event_date : null,
    birth_date: input.birth_date || null, // never store "" as a fake date
    country_of_origin: String(input.country_of_origin || "").trim(),
    photo: input.photo,
    photo_credit: input.photo_credit,
    net_worth_usd: null,
    net_worth_note: "",
    net_worth_source: "",
    sources: events[0].sources,
    summary: input.summary,
    events,
    career: personCareer(input),
    nicknames: normalizeNicknames(input.nicknames),
    clearances: normalizeClearances(input.clearances),
  });
}
