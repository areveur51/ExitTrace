/** Live unique-person dashboard ranks from the shared event columns. */

import {
  AGE_BANDS,
  ageBandFor,
  knownBirthDate,
  matchesAgeBand,
  parseAgeBand,
  storedAgeAtEvent,
} from "./age.mjs";
import { categoryById, isDeathCategory, GROUP_OPS_KEEP_IDS, PROMOTE_CATEGORY_IDS } from "./categories.mjs";
import { EVENT_ATTR_FIELDS } from "./event-attrs.mjs";
import { normalizeOperationTags, operationHasTag, operationTagLabel } from "./operation.mjs";
import { isPeopleMediaHref } from "./portrait.mjs";
import { deathPersonEvent, personEvents } from "./promote.mjs";

export { AGE_BANDS, parseAgeBand } from "./age.mjs";

export const DASH_AGE = {
  id: "age",
  title: "Age",
  nav: "Age",
  path: "/dashboard/age",
};

export const DASH_MISSING = {
  id: "missing",
  title: "Missing metadata",
  nav: "Missing",
  path: "/dashboard/missing",
};

/** Unique-person gaps. Empty stays empty — not guessed. */
export const DASH_MISSING_FIELDS = [
  { id: "photo", label: "Portrait" },
  { id: "summary", label: "Summary" },
  { id: "birth_date", label: "Birth date" },
  { id: "age", label: "Age at event" },
  { id: "net_worth", label: "Net worth" },
  { id: "origin", label: "Origin country" },
  { id: "comments", label: "Event comments" },
  { id: "position", label: "Position" },
  { id: "organization", label: "Organization" },
];

const MISSING_BY_ID = new Map(DASH_MISSING_FIELDS.map((f) => [f.id, f]));

export function parseMissingField(raw) {
  const id = decodeURIComponent(String(raw || "")).trim();
  if (!id || id === "all") return null;
  return MISSING_BY_ID.get(id) || null;
}

export const DASH_TOP_N = 5;

export const DASH_RANGE_STORAGE_KEY = "exittrace-dash-range";

export const DASH_RANGE_IDS = ["all", "30d", "ytd", "since-2017", "custom"];

export const DASH_RANGE_PRESETS = [
  { id: "all", label: "All" },
  { id: "30d", label: "30d" },
  { id: "ytd", label: "YTD" },
  { id: "since-2017", label: "Since 2017" },
  { id: "custom", label: "Custom" },
];

export const DASH_DIMENSIONS = [
  {
    id: "organization",
    title: "Organization",
    nav: "Organization",
    path: "/dashboard/organization",
    source: "field",
    field: "organization",
  },
  {
    id: "country",
    title: "Country",
    nav: "Country",
    path: "/dashboard/country",
    source: "field",
    field: "country",
  },
  {
    id: "reason",
    title: "Reason",
    nav: "Reason",
    path: "/dashboard/reason",
    source: "kind",
  },
  {
    id: "branch",
    title: "Branch",
    nav: "Branch",
    path: "/dashboard/branch",
    source: "field",
    field: "branch",
  },
  {
    id: "position",
    title: "Position",
    nav: "Position",
    path: "/dashboard/position",
    source: "field",
    field: "position",
  },
];

const EVENT_FIELD_SET = new Set(EVENT_ATTR_FIELDS);

const DIM_BY_ID = new Map(DASH_DIMENSIONS.map((d) => [d.id, d]));
const DIM_BY_PATH = new Map(DASH_DIMENSIONS.map((d) => [d.path, d]));

export function dashDimensionById(id) {
  return DIM_BY_ID.get(String(id || "")) || null;
}

export function dashDimensionByPath(pathname) {
  const p = String(pathname || "").split("?")[0];
  if (p === "/dashboard") return null;
  return DIM_BY_PATH.get(p) || null;
}

export function explicitAttr(row, field) {
  const key = String(field || "").trim();
  if (!key) return "";
  return String(row?.[key] || "").trim();
}

/** KEEP events only. Career / service_history rows never feed ranks. */
export function dashRankEvents(row) {
  return personEvents(row).filter((ev) =>
    PROMOTE_CATEGORY_IDS.includes(String(ev.kind || "").trim()),
  );
}

/**
 * Occupation at this event. Death kinds use the death event only —
 * never career history, people.role, or another tag's attrs.
 */
export function occupationAtEvent(ev, field) {
  if (!ev || typeof ev !== "object") return "";
  const kind = String(ev.kind || "").trim();
  if (!PROMOTE_CATEGORY_IDS.includes(kind)) return "";
  if (!EVENT_FIELD_SET.has(field)) return "";
  return explicitAttr(ev, field);
}

/** Death-event occupation only. Career history is never a pointer. */
export function occupationAtDeath(row, field) {
  const death = deathPersonEvent(dashRankEvents(row));
  if (!death || !isDeathCategory(death.kind)) return "";
  return occupationAtEvent(death, field);
}

function reasonLabel(kind) {
  const cat = categoryById(kind);
  return cat ? cat.title : String(kind || "").trim();
}

function reasonHref(kind) {
  const cat = categoryById(kind);
  return cat && cat.kind === "person" ? cat.path : "/dashboard/reason";
}

function compareRank(a, b) {
  const n = b.count - a.count;
  if (n !== 0) return n;
  return String(a.label).localeCompare(String(b.label));
}

/** Unique people per bucket. Empty/missing event attrs are skipped — never guessed. */
export function rankDimension(people, dimId, range) {
  const dim = dashDimensionById(dimId);
  if (!dim) return [];
  const counts = new Map();
  const meta = new Map();
  for (const row of filterPeopleToRange(people, range)) {
    const seen = new Set();
    for (const ev of dashRankEvents(row)) {
      if (dim.source === "kind") {
        const kind = String(ev.kind || "").trim();
        if (!kind || seen.has(kind)) continue;
        seen.add(kind);
        counts.set(kind, (counts.get(kind) || 0) + 1);
        if (!meta.has(kind)) {
          meta.set(kind, { label: reasonLabel(kind), href: reasonHref(kind) });
        }
        continue;
      }
      if (!EVENT_FIELD_SET.has(dim.field)) continue;
      // Death kinds: death-event occupation only. Career never. Non-death: this event.
      const label = isDeathCategory(ev.kind)
        ? occupationAtDeath(row, dim.field)
        : occupationAtEvent(ev, dim.field);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      counts.set(label, (counts.get(label) || 0) + 1);
      if (!meta.has(label)) meta.set(label, { label, href: dim.path });
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: meta.get(key)?.label || key,
      href: meta.get(key)?.href || dim.path,
      count,
    }))
    .filter((row) => row.count > 0)
    .sort(compareRank);
}

export function topN(rows, n = DASH_TOP_N) {
  return (rows || []).slice(0, Math.max(0, Number(n) || 0));
}

function asEventDate(raw) {
  const text = String(raw || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function utcDay(now) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function addUtcDays(iso, days) {
  const day = asEventDate(iso);
  if (!day) return "";
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/** Compact token for cookie / localStorage / data-dash-range. */
export function serializeDashRange(range) {
  const id = DASH_RANGE_IDS.includes(range?.id) ? range.id : "all";
  if (id !== "custom") return id;
  const from = asEventDate(range?.from) || "";
  const to = asEventDate(range?.to) || "";
  return `custom:${from}:${to}`;
}

export function parseDashRangeToken(raw) {
  const text = decodeURIComponent(String(raw || "")).trim();
  if (!text) return { id: "all", from: "", to: "" };
  if (DASH_RANGE_IDS.includes(text) && text !== "custom") {
    return { id: text, from: "", to: "" };
  }
  if (text === "custom") return { id: "custom", from: "", to: "" };
  if (text.startsWith("custom:")) {
    const parts = text.split(":");
    return {
      id: "custom",
      from: asEventDate(parts[1]) || "",
      to: asEventDate(parts[2]) || "",
    };
  }
  return { id: "all", from: "", to: "" };
}

export function resolveDashRange(input = {}, { now } = {}) {
  const raw =
    typeof input === "string" ? parseDashRangeToken(input) : input && typeof input === "object" ? input : {};
  const parsed = parseDashRangeToken(raw.id || serializeDashRange(raw));
  const id = parsed.id;
  const today = utcDay(now);
  if (id === "30d") {
    return { id, from: addUtcDays(today, -30), to: today };
  }
  if (id === "ytd") {
    return { id, from: `${today.slice(0, 4)}-01-01`, to: today };
  }
  if (id === "since-2017") {
    return { id, from: "2017-01-01", to: "" };
  }
  if (id === "custom") {
    const from = asEventDate(raw.from ?? parsed.from) || "";
    const to = asEventDate(raw.to ?? parsed.to) || "";
    return { id, from, to };
  }
  return { id: "all", from: "", to: "" };
}

export function parseCookieDashRange(cookieHeader, { now } = {}) {
  const raw = String(cookieHeader || "");
  if (!raw) return resolveDashRange({ id: "all" }, { now });
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== DASH_RANGE_STORAGE_KEY) continue;
    return resolveDashRange(parseDashRangeToken(trimmed.slice(eq + 1)), { now });
  }
  return resolveDashRange({ id: "all" }, { now });
}

export function parseDashRangeSearch(searchParams, { cookie, now } = {}) {
  const src =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams || "");
  const qid = String(src.get("range") || "").trim();
  if (qid) {
    return resolveDashRange(
      { id: qid, from: src.get("from"), to: src.get("to") },
      { now },
    );
  }
  if (cookie) return parseCookieDashRange(cookie, { now });
  return resolveDashRange({ id: "all" }, { now });
}

export function dashRangeHref(path, range, extra = {}) {
  const params = new URLSearchParams();
  const resolved = resolveDashRange(range);
  params.set("range", resolved.id);
  if (resolved.id === "custom") {
    if (resolved.from) params.set("from", resolved.from);
    if (resolved.to) params.set("to", resolved.to);
  }
  const page = Number(extra.page);
  if (Number.isFinite(page) && page > 1) params.set("page", String(page));
  const band = parseAgeBand(extra.band);
  if (band) params.set("band", band.id);
  const missing = parseMissingField(extra.field);
  if (missing) params.set("field", missing.id);
  const base = String(path || "/dashboard").split("?")[0] || "/dashboard";
  return `${base}?${params.toString()}`;
}

export function eventInDashRange(eventDate, range) {
  const day = asEventDate(eventDate);
  if (!day) return false;
  if (!range || range.id === "all") return true;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

/** People with only in-range events. Empty attrs stay empty. */
export function filterPeopleToRange(people, range) {
  const rows = people || [];
  if (!range || range.id === "all") return rows;
  const out = [];
  for (const row of rows) {
    const events = personEvents(row).filter((ev) =>
      eventInDashRange(ev.event_date, range),
    );
    if (!events.length) continue;
    out.push({ ...row, events });
  }
  return out;
}

export function eventDatesOf(people) {
  const dates = [];
  for (const row of people || []) {
    for (const ev of personEvents(row)) {
      const day = asEventDate(ev.event_date);
      if (day) dates.push(day);
    }
  }
  return dates.sort((a, b) => a.localeCompare(b));
}

export function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

/** UTC ISO week key YYYY-Www. */
export function weekKey(iso) {
  const day = asEventDate(iso);
  if (!day) return "";
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dow);
  const year = utc.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc - jan1) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function bucketCounts(dates, keyFn) {
  const map = new Map();
  for (const day of dates || []) {
    const key = keyFn(day);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function trendSeries(people, range) {
  const dates = eventDatesOf(filterPeopleToRange(people, range));
  const perMonth = bucketCounts(dates, monthKey);
  const perWeek = bucketCounts(dates, weekKey);
  const perDay = bucketCounts(dates, (day) => day);
  let running = 0;
  const total = perDay.map((row) => {
    running += row.count;
    return { key: row.key, count: running };
  });
  const last = total[total.length - 1]?.count || 0;
  return {
    events: dates.length,
    total,
    last,
    perMonth,
    perWeek,
  };
}

function sumStoredCounts(rows, field) {
  let sum = 0;
  let seen = false;
  for (const row of rows || []) {
    const n = row?.[field];
    if (n === null || n === undefined || n === "") continue;
    const num = Number(n);
    if (!Number.isInteger(num) || num < 0) continue;
    sum += num;
    seen = true;
  }
  return seen ? sum : null;
}

/** Operations whose event_date is in range. Empty counts stay empty. */
export function filterOperationsToRange(operations, range) {
  const rows = operations || [];
  if (!range || range.id === "all") return rows.slice();
  return rows.filter((row) => eventInDashRange(row.event_date, range));
}

/** Sum stored victim/arrest counts only. Null stays null — never invent. */
export function operationStanding(operations, range, tag) {
  let rows = filterOperationsToRange(operations, range);
  const tags = normalizeOperationTags(tag);
  if (tags.length) rows = rows.filter((row) => operationHasTag(row, tags));
  return {
    operations: rows.length,
    victims: sumStoredCounts(rows, "victim_count"),
    arrests: sumStoredCounts(rows, "arrest_count"),
  };
}

/**
 * Ages at in-range KEEP events. Missing birth_date contributes nothing —
 * stored age_at_event is not a substitute for a calendar DOB.
 */
export function eventAgesOf(row) {
  if (!knownBirthDate(row?.birth_date)) return [];
  const ages = [];
  for (const ev of dashRankEvents(row)) {
    const age = storedAgeAtEvent(ev, row.birth_date, ev.event_date);
    if (age != null) ages.push(age);
  }
  return ages;
}

export function personAgeBands(row) {
  const seen = new Set();
  const out = [];
  for (const age of eventAgesOf(row)) {
    const band = ageBandFor(age);
    if (!band || seen.has(band.id)) continue;
    seen.add(band.id);
    out.push(band);
  }
  return out;
}

/** Unique people per fixed age band. Null DOB never enters a band. */
export function ageStanding(people, range) {
  const rows = filterPeopleToRange(people, range);
  const counts = new Map(AGE_BANDS.map((b) => [b.id, 0]));
  for (const row of rows) {
    for (const band of personAgeBands(row)) {
      counts.set(band.id, (counts.get(band.id) || 0) + 1);
    }
  }
  return AGE_BANDS.map((band) => ({
    key: band.id,
    label: band.label,
    minAge: band.minAge,
    maxAge: band.maxAge,
    count: counts.get(band.id) || 0,
  }));
}

function compareListedPeople(a, b) {
  const d = String(b.event_date || "").localeCompare(String(a.event_date || ""));
  if (d !== 0) return d;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

/** People with at least one in-range KEEP age in the band. All = union of bands. */
export function peopleInAgeBand(people, bandId, range) {
  const rows = filterPeopleToRange(people, range);
  const token = String(bandId || "").trim();
  const band = parseAgeBand(token);
  if (token && token !== "all" && !band) return [];
  return rows
    .filter((row) => eventAgesOf(row).some((age) => matchesAgeBand(age, band)))
    .slice()
    .sort(compareListedPeople);
}

function inRangeKeepEvents(row, range) {
  const events = dashRankEvents(row);
  if (!range || range.id === "all") return events;
  return events.filter((ev) => eventInDashRange(ev.event_date, range));
}

function missingNetWorth(row) {
  const n = row?.net_worth_usd;
  if (n === null || n === undefined || n === "") return true;
  return !Number.isFinite(Number(n));
}

function eventFieldBlank(events, field) {
  if (!events.length) return false;
  return events.every((ev) => !String(ev?.[field] || "").trim());
}

/** True when this unique person is missing the named stored field. */
export function personMissingField(row, fieldId, range) {
  const field = parseMissingField(fieldId);
  if (!field || !row) return false;
  const events = inRangeKeepEvents(row, range);
  switch (field.id) {
    case "photo":
      return !isPeopleMediaHref(row.photo);
    case "summary":
      return !String(row.summary || "").trim();
    case "birth_date":
      return !knownBirthDate(row.birth_date);
    case "age":
      return !events.some(
        (ev) => storedAgeAtEvent(ev, row.birth_date, ev.event_date) != null,
      );
    case "net_worth":
      return missingNetWorth(row);
    case "origin":
      return !String(row.country_of_origin || "").trim();
    case "comments":
      return eventFieldBlank(events, "comments");
    case "position":
      return eventFieldBlank(events, "position");
    case "organization":
      return eventFieldBlank(events, "organization");
    default:
      return false;
  }
}

/** Unique people in range missing each tracked field. */
export function missingStanding(people, range) {
  const rows = filterPeopleToRange(people, range);
  const total = rows.length;
  const resolved = resolveDashRange(range);
  return DASH_MISSING_FIELDS.map((field) => {
    const count = rows.filter((row) => personMissingField(row, field.id, resolved)).length;
    return {
      key: field.id,
      label: field.label,
      count,
      total,
      href: dashRangeHref(DASH_MISSING.path, resolved, { field: field.id }),
    };
  });
}

/** True when this unique person is missing at least one tracked field. */
export function personMissingAnyField(row, range) {
  return DASH_MISSING_FIELDS.some((field) => personMissingField(row, field.id, range));
}

export function peopleMissingField(people, fieldId, range) {
  const rows = filterPeopleToRange(people, range);
  const field = parseMissingField(fieldId);
  const resolved = resolveDashRange(range);
  if (String(fieldId || "").trim() && fieldId !== "all" && !field) return [];
  const matched = field
    ? rows.filter((row) => personMissingField(row, field.id, resolved))
    : rows.filter((row) => personMissingAnyField(row, resolved));
  return matched.slice().sort(compareListedPeople);
}

function missingStoredCount(rows, field) {
  let n = 0;
  for (const row of rows || []) {
    const v = row?.[field];
    if (v === null || v === undefined || v === "") n += 1;
  }
  return n;
}

/** Operations in range missing summary or published counts. Null counts stay missing. */
export function operationMissingStanding(operations, range) {
  const rows = filterOperationsToRange(operations, range);
  const total = rows.length;
  return {
    total,
    fields: [
      {
        key: "summary",
        label: "Summary",
        count: rows.filter((row) => !String(row.summary || "").trim()).length,
        total,
      },
      {
        key: "victim_count",
        label: "Victim count",
        count: missingStoredCount(rows, "victim_count"),
        total,
      },
      {
        key: "arrest_count",
        label: "Arrest count",
        count: missingStoredCount(rows, "arrest_count"),
        total,
      },
    ],
  };
}

/** Standing by signed operation tag, plus the all-ops rollup. */
export function operationStandingByTag(operations, range) {
  const resolved = resolveDashRange(range);
  const all = operationStanding(operations, resolved);
  const byTag = GROUP_OPS_KEEP_IDS.map((id) => {
    const standing = operationStanding(operations, resolved, id);
    const cat = categoryById(id);
    return {
      key: id,
      label: operationTagLabel(id),
      href: cat?.path || "/group-operations",
      ...standing,
    };
  });
  return { range: resolved, all, byTag };
}

export function buildDashboard(people, range, operations = []) {
  const rows = filterPeopleToRange(people, range);
  const dimensions = DASH_DIMENSIONS.map((dim) => {
    const ranked = rankDimension(rows, dim.id);
    return {
      ...dim,
      ranked,
      top: topN(ranked),
    };
  });
  return {
    people: rows.length,
    range: resolveDashRange(range),
    trends: trendSeries(rows),
    dimensions,
    operations: operationStandingByTag(operations, range),
    age: ageStanding(people, range),
    missing: missingStanding(people, range),
    operationsMissing: operationMissingStanding(operations, range),
  };
}
