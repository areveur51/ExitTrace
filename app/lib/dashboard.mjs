/** Live unique-person dashboard ranks from the shared event columns. */

import { categoryById, PROMOTE_CATEGORY_IDS } from "./categories.mjs";
import { EVENT_ATTR_FIELDS } from "./event-attrs.mjs";
import { personEvents } from "./promote.mjs";

export const DASH_TOP_N = 5;

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
export function rankDimension(people, dimId) {
  const dim = dashDimensionById(dimId);
  if (!dim) return [];
  const counts = new Map();
  const meta = new Map();
  for (const row of people || []) {
    const seen = new Set();
    for (const ev of personEvents(row)) {
      if (dim.source === "kind") {
        const kind = String(ev.kind || "").trim();
        if (!kind || seen.has(kind)) continue;
        if (!PROMOTE_CATEGORY_IDS.includes(kind)) continue;
        seen.add(kind);
        counts.set(kind, (counts.get(kind) || 0) + 1);
        if (!meta.has(kind)) {
          meta.set(kind, { label: reasonLabel(kind), href: reasonHref(kind) });
        }
        continue;
      }
      if (!EVENT_FIELD_SET.has(dim.field)) continue;
      const label = explicitAttr(ev, dim.field);
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

export function trendSeries(people) {
  const dates = eventDatesOf(people);
  const perMonth = bucketCounts(dates, monthKey);
  const perWeek = bucketCounts(dates, weekKey);
  let running = 0;
  const total = dates.map((key) => {
    running += 1;
    return { key, count: running };
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

export function buildDashboard(people) {
  const rows = people || [];
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
    trends: trendSeries(rows),
    dimensions,
  };
}
