/** One event schema for harvest leads and dashboard slices. No parallel copy. */

import {
  DEATH_KEEP_IDS,
  DEATH_UNCONFIRMED_ID,
  PROMOTE_CATEGORY_IDS,
  isIndictmentKeepKind,
} from "./categories.mjs";
import { normalizeTags } from "./tags.mjs";
import { coronaStatusLabel, normalizeCoronaStatus } from "./corona-status.mjs";

function parseLeadDate(raw) {
  const text = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  if (new Date(ms).toISOString().slice(0, 10) !== text) return null;
  return text;
}

/** Nullable resignation.info / corona fields stored on the event/tag. */
export const EVENT_ATTR_FIELDS = [
  "position",
  "organization",
  "country",
  "branch",
  "comments",
  "notable_group",
  "title_note",
  "status",
];

/** Display labels for event-tag-row. Reason on the dashboard stays KEEP kinds. */
export const EVENT_ATTR_LABELS = {
  position: "Position",
  organization: "Organization",
  country: "Country",
  branch: "Branch",
  comments: "Comments",
  notable_group: "Notable group",
  title_note: "Title note",
  status: "Status",
};

const ATTR_ALIASES = {
  position: ["position", "Position"],
  organization: ["organization", "Organization"],
  country: ["country", "Country"],
  branch: ["branch", "Branch"],
  // Reason of event maps onto comments. Reason→KEEP kind stays separate.
  comments: ["comments", "Comments", "comment", "reason", "Reason"],
  notable_group: ["notable_group", "Notable Group", "group", "Group"],
  title_note: ["title_note", "Title Note", "title", "Title"],
  status: ["status", "Status"],
};

const ORIGIN_ALIASES = [
  "country_of_origin",
  "origin_country",
  "originCountry",
  "Country of Origin",
];

function firstText(row, keys) {
  if (!row || typeof row !== "object") return "";
  for (const key of keys) {
    const text = String(row[key] || "").trim();
    if (text) return text;
  }
  return "";
}

export function normalizeEventAttrs(raw = {}) {
  const out = {};
  for (const field of EVENT_ATTR_FIELDS) {
    out[field] = firstText(raw, ATTR_ALIASES[field] || [field]);
  }
  if (out.status) out.status = normalizeCoronaStatus(out.status) || "";
  return out;
}

export { coronaStatusLabel, normalizeCoronaStatus };

/**
 * Person-level origin. Never event.country, name, or role.
 * Empty stays empty — do not guess.
 */
export function parseOriginCountry(raw = {}) {
  return firstText(raw, ORIGIN_ALIASES);
}

function asFlag(raw) {
  if (raw === true || raw === 1) return true;
  const text = String(raw || "")
    .trim()
    .toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "on";
}

/**
 * Explicit military only. Do not guess from name, role, position, or country.
 * Not a new KEEP kind — callers pass military=true (or a military input tag).
 */
export function isMilitaryInput(raw = {}) {
  if (asFlag(raw.military) || asFlag(raw.Military) || asFlag(raw.is_military)) {
    return true;
  }
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === "string"
      ? raw.tags.split(",")
      : [];
  return tags.some((item) => String(item || "").trim().toLowerCase() === "military");
}

/**
 * Fail-closed unsealed rule for indictment_civilian | indictment_non_civilian only.
 * Set true only when cite URL/title or event comments/reason/summary clearly
 * state unsealed / unsealing / made public. Sealed, negated, or unclear stays
 * null. A bare unsealed=true flag is not evidence. Not a KEEP kind.
 */
const UNCLEAR_UNSEALED_RE =
  /\b(?:unclear|not clear|unknown whether|cannot confirm|can't confirm|unconfirmed)\b/i;

function evidenceBits(input = {}) {
  const bits = [];
  const push = (value) => {
    if (value == null) return;
    if (typeof value === "object") {
      push(value.title);
      push(value.publisher);
      push(value.url);
      push(value.raw);
      push(value.canonical);
      return;
    }
    const text = String(value).trim();
    if (text) bits.push(text);
  };
  push(input.comments);
  push(input.Comments);
  push(input.reason);
  push(input.Reason);
  push(input.summary);
  push(input.unsealed_evidence);
  push(input.unsealedEvidence);
  const cites = []
    .concat(input.cite_urls || [])
    .concat(input.sources || []);
  for (const cite of cites) push(cite);
  return bits.join("\n");
}

export function textStatesUnsealed(raw) {
  const body = String(raw || "");
  if (!body.trim()) return false;
  if (UNCLEAR_UNSEALED_RE.test(body)) return false;
  const phrase = /\b(?:unsealed|unsealing|made public)\b/gi;
  let match;
  while ((match = phrase.exec(body))) {
    const before = body.slice(Math.max(0, match.index - 32), match.index);
    if (/(?:\b(?:not|never|no|without)\b|n't)\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}

/** True or null. Never false. Non-indictment kinds stay null. */
export function unsealedFromEvidence(input = {}, kind) {
  const eventKind = String(kind || input.kind || input.category || "").trim();
  if (!isIndictmentKeepKind(eventKind)) return null;
  return textStatesUnsealed(evidenceBits(input)) ? true : null;
}

export function evidenceCorpus(input = {}) {
  return evidenceBits(input);
}

/**
 * Annotate-only: null → true when this event's cites/comments clearly state
 * unsealed. A stored true is left alone. Other kinds are not modified.
 */
export function annotateUnsealedEvent(ev) {
  if (!ev || typeof ev !== "object") return { event: ev, changed: false };
  if (!isIndictmentKeepKind(ev.kind)) return { event: ev, changed: false };
  if (ev.unsealed === true) return { event: ev, changed: false };
  if (unsealedFromEvidence(ev, ev.kind) !== true) return { event: ev, changed: false };
  return { event: { ...ev, unsealed: true }, changed: true };
}

export function annotateUnsealedPerson(person) {
  const events = Array.isArray(person?.events) ? person.events : [];
  let changed = false;
  const nextEvents = events.map((ev) => {
    const result = annotateUnsealedEvent(ev);
    if (result.changed) changed = true;
    return result.event;
  });
  if (!changed) return { person, changed: false };
  return { person: { ...person, events: nextEvents }, changed: true };
}

export function planUnsealedAnnotations(people) {
  const plans = [];
  for (const person of people || []) {
    const result = annotateUnsealedPerson(person);
    if (!result.changed) continue;
    const before = new Map(
      (person.events || []).map((ev) => [ev.kind, ev.unsealed === true]),
    );
    for (const ev of result.person.events || []) {
      if (ev?.unsealed === true && !before.get(ev.kind)) {
        plans.push({ id: person.id, kind: ev.kind });
      }
    }
  }
  return plans;
}

/**
 * event_date = Last Day if present else Announced (else explicit event_date).
 * Store announced_date only when it differs. Both empty → do not insert.
 */
export function resolveEventCalendar(raw = {}) {
  const lastDay = parseLeadDate(
    raw.last_day || raw.lastDay || raw["Last Day"] || "",
  );
  const announced = parseLeadDate(
    raw.announced || raw.announced_at || raw["Announced"] || "",
  );
  const explicit = parseLeadDate(raw.event_date);
  const event_date = lastDay || announced || explicit || null;
  if (!event_date) {
    return { event_date: null, announced_date: "" };
  }
  const storedAnnounced = parseLeadDate(raw.announced_date) || announced;
  const announced_date =
    storedAnnounced && storedAnnounced !== event_date ? storedAnnounced : "";
  return { event_date, announced_date };
}

function foldReason(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function asPromoteKind(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return PROMOTE_CATEGORY_IDS.includes(id) ? id : null;
}

/**
 * Dead → one death_* KEEP kind when identity is already known.
 * Celebrity + official (or any other mix) stays un-tagged.
 */
export function deathKindFromTags(tags) {
  const have = new Set(normalizeTags(tags));
  const hits = DEATH_KEEP_IDS.filter((kind) => {
    if (kind === "death_celebrity") return have.has("celebrity");
    if (kind === "death_official") return have.has("official");
    if (kind === "death_ceo") return have.has("ceo");
    return false;
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Resigned / Retired / Term Ended → officials step down only when the
 * official identity tag is already present. Role text is not parsed into
 * a country or branch taxonomy.
 */
export function resignKindFromRole({ tags } = {}) {
  const have = normalizeTags(tags);
  return have.includes("official") ? "government_stepdowns" : "resignations";
}

/**
 * Cite gate (Admiral SIGNED+CLEARED). Documented here; this function does not write.
 * death_unconfirmed may park on an Admiral-named claim cite.
 * Upgrade to death_celebrity | death_official | death_ceo still needs
 * ≥2 official/gov/news cites, a calendar YYYY-MM-DD, and explicit CLEAR.
 * Leads are never auto-classified into death_unconfirmed.
 * death_official, death_celebrity, and death_ceo are not used for unconfirmed claims.
 */
export function confirmedDeathUpgradeGate({
  kind,
  officialCites,
  eventDate,
  clear,
} = {}) {
  if (!DEATH_KEEP_IDS.includes(String(kind || "").trim())) return false;
  if (clear !== true) return false;
  if (!parseLeadDate(eventDate)) return false;
  const n = Array.isArray(officialCites) ? officialCites.filter(Boolean).length : 0;
  return n >= 2;
}

/**
 * Park one death_unconfirmed event. Not a confirmed death and not a second person.
 * event_date stays NULL unless the caller already has a calendar YYYY-MM-DD.
 * death_date, cause, and location are not fields here and are not invented.
 * comments is the footnote string (caller-supplied).
 */
export function deathUnconfirmedEvent({
  comments = "",
  sources = [],
  event_date = null,
} = {}) {
  return {
    kind: DEATH_UNCONFIRMED_ID,
    event_date: parseLeadDate(event_date),
    announced_date: "",
    position: "",
    organization: "",
    country: "",
    branch: "",
    comments: String(comments ?? "").trim(),
    sources: Array.isArray(sources) ? sources : [],
    age_at_event: null,
  };
}

/** Generic footnote the death_unconfirmed comments field can store. Not a column. */
export const DEATH_UNCONFIRMED_FOOTNOTE =
  "Trump Truth Social claim; no media confirmation yet.";

/**
 * Map a lead Reason onto existing KEEP kinds only.
 * Unknown or unclassifiable Dead → no kind (do not insert).
 * Never auto-classify a lead into death_unconfirmed.
 */
export function mapLeadReason(reason, ctx = {}) {
  const key = foldReason(reason);
  if (
    key === "death unconfirmed" ||
    key === "unconfirmed" ||
    key === "dead unconfirmed" ||
    key === "unconfirmed death"
  ) {
    return null;
  }
  const explicit = asPromoteKind(reason);
  if (explicit) return explicit;
  if (!key) return null;
  if (key === "fired") return "firings";
  if (key === "resigned" || key === "retired" || key === "term ended") {
    return resignKindFromRole(ctx);
  }
  if (key === "dead" || key === "died" || key === "death") {
    return deathKindFromTags(ctx.tags);
  }
  return null;
}

/**
 * Shared harvest → event projection. Dashboard reads this same shape.
 * Does not emit death_unconfirmed. Leads are never auto-classified into that kind.
 */
export function eventFromLead(lead = {}, extra = {}) {
  const calendar = resolveEventCalendar({ ...lead, ...extra });
  if (!calendar.event_date) return null;
  const attrs = normalizeEventAttrs({ ...lead, ...extra });
  const tags = extra.tags || lead.tags;
  const kind =
    asPromoteKind(extra.kind || extra.category) ||
    mapLeadReason(extra.reason || lead.reason || lead.Reason, {
      role: extra.role || attrs.position || lead.role,
      tags,
    });
  if (!kind) return null;
  return {
    kind,
    event_date: calendar.event_date,
    announced_date: calendar.announced_date,
    ...attrs,
  };
}

export function mergeEventAttrs(prior = {}, incoming = {}) {
  const a = normalizeEventAttrs(prior);
  const b = normalizeEventAttrs(incoming);
  const out = {};
  for (const field of EVENT_ATTR_FIELDS) {
    out[field] = a[field] || b[field] || "";
  }
  const announced =
    String(prior.announced_date || "").trim() ||
    String(incoming.announced_date || "").trim() ||
    "";
  const event_date = String(prior.event_date || incoming.event_date || "").trim();
  out.announced_date = announced && announced !== event_date ? announced : "";
  return out;
}
