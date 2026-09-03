/** One event schema for harvest leads and dashboard slices. No parallel copy. */

import { DEATH_KEEP_IDS, PROMOTE_CATEGORY_IDS } from "./categories.mjs";
import { normalizeTags } from "./tags.mjs";

function parseLeadDate(raw) {
  const text = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  if (new Date(ms).toISOString().slice(0, 10) !== text) return null;
  return text;
}

/** Nullable resignation.info fields stored on the event/tag. */
export const EVENT_ATTR_FIELDS = [
  "position",
  "organization",
  "country",
  "branch",
  "comments",
];

const ATTR_ALIASES = {
  position: ["position", "Position"],
  organization: ["organization", "Organization"],
  country: ["country", "Country"],
  branch: ["branch", "Branch"],
  // Reason of event maps onto comments. Reason→KEEP kind stays separate.
  comments: ["comments", "Comments", "comment", "reason", "Reason"],
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
  return out;
}

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
 * Map a lead Reason onto existing KEEP kinds only.
 * Unknown or unclassifiable Dead → no kind (do not insert).
 */
export function mapLeadReason(reason, ctx = {}) {
  const explicit = asPromoteKind(reason);
  if (explicit) return explicit;
  const key = foldReason(reason);
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

/** Shared harvest → event projection. Dashboard reads this same shape. */
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
