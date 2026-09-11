/** Distinct Group Operations entity. Not a unique-person KEEP kind. */

import { GROUP_OPS_KEEP_IDS, categoryById } from "./categories.mjs";
import { resolveEventCalendar } from "./event-attrs.mjs";
import { partitionCiteUrls } from "./official.mjs";
import {
  CITE_FLOOR,
  PromoteError,
  asEventDate,
  citeRecords,
  mergeCites,
  parseCiteUrls,
  parseEventDate,
  personSlug,
} from "./promote.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

export const OPERATION_TAG_IDS = GROUP_OPS_KEEP_IDS;

const CHILD_NAME_KEYS = [
  "children",
  "child",
  "child_name",
  "child_names",
  "kids",
  "kid_names",
  "named_children",
  "victim_names",
  "victims",
];

export function operationSlug(name) {
  return personSlug(name);
}

export function normalizeOperationName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeOperationTag(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return OPERATION_TAG_IDS.includes(id) ? id : null;
}

/** Signed tags only. Later siblings append to GROUP_OPS_KEEP_IDS. */
export function normalizeOperationTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,\s]+/)
      : raw && typeof raw === "object"
        ? [raw.tag, raw.tags, raw.category].flat()
        : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = normalizeOperationTag(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseNullableInt(raw, field) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0) {
      throw new PromoteError(
        `${field} must be a non-negative integer or empty`,
        "invalid_count",
      );
    }
    return raw;
  }
  const text = String(raw).trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) {
    throw new PromoteError(
      `${field} must be a non-negative integer or empty`,
      "invalid_count",
    );
  }
  return Number(text);
}

export function parseAgencies(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;|]/)
      : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function assertNoNamedChildren(input = {}) {
  for (const key of CHILD_NAME_KEYS) {
    const value = input[key];
    if (value === undefined || value === null || value === false || value === "") {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) continue;
    throw new PromoteError(
      "do not fetch or store named children on an operation",
      "named_children",
    );
  }
}

export function operationHasTag(row, tags) {
  const want = normalizeOperationTags(tags);
  if (!want.length) return true;
  const have = new Set(normalizeOperationTags(row?.tags));
  return want.some((id) => have.has(id));
}

export function listPathForOperation(row) {
  const tags = normalizeOperationTags(row?.tags);
  for (const id of tags) {
    const cat = categoryById(id);
    if (cat?.kind === "operation" && cat.path && cat.id !== "group_ops_unspecified") {
      return cat.path;
    }
  }
  return "/group-operations";
}

export function operationTagLabel(id) {
  const cat = categoryById(id);
  return cat ? cat.nav : String(id || "").trim();
}

export function operationTagTitle(id) {
  const cat = categoryById(id);
  return cat ? cat.title : String(id || "").trim();
}

function asSources(raw) {
  return Array.isArray(raw) ? raw.filter((s) => s && s.url) : [];
}

export function normalizeOperation(row = {}) {
  const name = String(row.name || row.subject || "").trim();
  const event_date = asEventDate(row.event_date);
  const announcedRaw = asEventDate(row.announced_date);
  const announced_date =
    announcedRaw && announcedRaw !== event_date ? announcedRaw : "";
  let victim_count = null;
  let arrest_count = null;
  try {
    victim_count = parseNullableInt(row.victim_count, "victim_count");
    arrest_count = parseNullableInt(row.arrest_count, "arrest_count");
  } catch {
    victim_count = null;
    arrest_count = null;
  }
  return {
    id: String(row.id || "").trim() || operationSlug(name),
    name,
    event_date,
    announced_date,
    agencies: parseAgencies(row.agencies || row.organization || row.orgs),
    summary: String(row.summary || row.reason || row.comments || "").trim(),
    victim_count,
    arrest_count,
    tags: normalizeOperationTags(row.tags || row.category),
    sources: asSources(row.sources),
  };
}

export function findOperationMatch(operations, input = {}) {
  const id = String(input.id || "").trim();
  const slug = operationSlug(input.name || input.subject || input.slug || "");
  const nameKey = normalizeOperationName(input.name || input.subject || "");
  return (operations || []).find((row) => {
    if (id && row.id === id) return true;
    if (slug && row.id === slug) return true;
    if (nameKey && normalizeOperationName(row.name) === nameKey) return true;
    return false;
  }) || null;
}

export function nextOperationId(operations, slug, eventDate) {
  const ids = new Set((operations || []).map((row) => row.id));
  if (slug && !ids.has(slug)) return slug;
  const dated = slug && eventDate ? `${slug}-${eventDate}` : "";
  if (dated && !ids.has(dated)) return dated;
  throw new PromoteError(
    `operation id already used: ${slug || "(empty)"}`,
    "id_collision",
  );
}

export function mergeOperationAnnotate(gold, prior) {
  const a = normalizeOperation(gold);
  const b = normalizeOperation(prior);
  const cites = mergeCites(a.sources, b.sources);
  const tags = [...new Set([...a.tags, ...b.tags])];
  return {
    ...a,
    agencies: a.agencies.length ? a.agencies : b.agencies,
    summary: a.summary || b.summary,
    victim_count: a.victim_count ?? b.victim_count,
    arrest_count: a.arrest_count ?? b.arrest_count,
    announced_date: a.announced_date || b.announced_date,
    tags,
    sources: cites.sources,
  };
}

export function validateIdentifiedOperationInput(input = {}) {
  assertNoNamedChildren(input);
  const name = String(input.name || input.subject || "").trim();
  if (!name) {
    throw new PromoteError("operation name is required", "missing_name");
  }
  const calendar = resolveEventCalendar(input);
  const event_date = calendar.event_date;
  if (!event_date) {
    throw new PromoteError(
      "event_date is required as YYYY-MM-DD (Last Day or Announced; not posted_at)",
      "missing_event_date",
    );
  }
  if (input.announced_date) {
    const announced = parseEventDate(input.announced_date);
    if (!announced) {
      throw new PromoteError(
        "announced_date must be YYYY-MM-DD when present",
        "invalid_announced_date",
      );
    }
  }
  const announced_date =
    calendar.announced_date ||
    (parseEventDate(input.announced_date) &&
    parseEventDate(input.announced_date) !== event_date
      ? parseEventDate(input.announced_date)
      : "");
  const tags = normalizeOperationTags(
    input.tags || input.tag || input.category || "missing_kids",
  );
  if (!tags.length) {
    throw new PromoteError(
      `operation tag must be one of: ${OPERATION_TAG_IDS.join(", ")}`,
      "invalid_tag",
    );
  }
  const parsedCites = parseCiteUrls(input.cite_urls);
  const { official, extra } = partitionCiteUrls(parsedCites);
  if (official.length < CITE_FLOOR) {
    throw new PromoteError(
      `need at least ${CITE_FLOOR} official DOJ/gov/news-org cite URLs`,
      "cites_floor",
    );
  }
  const slug = operationSlug(name);
  if (!slug) {
    throw new PromoteError("name did not yield an operation id", "invalid_name");
  }
  const victim_count = parseNullableInt(input.victim_count, "victim_count");
  const arrest_count = parseNullableInt(input.arrest_count, "arrest_count");
  const agencies = parseAgencies(
    input.agencies || input.organization || input.orgs,
  );
  const summary = String(input.summary || input.reason || input.comments || "").trim();
  if (!summary) {
    throw new PromoteError(
      "reason/summary is required on an operation",
      "missing_summary",
    );
  }
  if (!agencies.length) {
    throw new PromoteError(
      "agencies/orgs are required on an operation",
      "missing_agencies",
    );
  }
  return {
    name,
    event_date,
    announced_date,
    agencies,
    summary,
    victim_count,
    arrest_count,
    tags,
    cite_urls: official,
    extra_urls: extra,
    slug,
  };
}

export function buildOperationRow(input, operations) {
  return normalizeOperation({
    id: nextOperationId(operations, input.slug, input.event_date),
    name: input.name,
    event_date: input.event_date,
    announced_date: input.announced_date,
    agencies: input.agencies,
    summary: input.summary,
    victim_count: input.victim_count,
    arrest_count: input.arrest_count,
    tags: input.tags,
    sources: citeRecords(input.cite_urls, input.event_date),
  });
}

export function canonicalOperationCite(url) {
  return canonicalPublicUrl(url);
}
