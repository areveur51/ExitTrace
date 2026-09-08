/** Person-level occupation / service history. Not event-tag attrs. */

const YEAR_MIN = 1000;
const YEAR_MAX = 2100;

const TITLE_ALIASES = [
  "title",
  "Title",
  "position",
  "Position",
  "occupation",
  "Occupation",
];
const ORG_ALIASES = ["organization", "Organization", "org", "Org"];
const BRANCH_ALIASES = ["branch", "Branch"];
const START_ALIASES = [
  "start_year",
  "startYear",
  "from_year",
  "fromYear",
  "Start",
];
const END_ALIASES = ["end_year", "endYear", "to_year", "toYear", "End"];

/** Shared career/service row. Years only — no event_date, cites, or comments. */
export const CAREER_FIELDS = [
  "title",
  "organization",
  "branch",
  "start_year",
  "end_year",
];

function firstText(row, keys) {
  if (!row || typeof row !== "object") return "";
  for (const key of keys) {
    const text = String(row[key] || "").trim();
    if (text) return text;
  }
  return "";
}

export function parseCareerYear(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw >= YEAR_MIN && raw <= YEAR_MAX ? raw : null;
  }
  const text = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const year = Number(text.slice(0, 4));
    return year >= YEAR_MIN && year <= YEAR_MAX ? year : null;
  }
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  return year >= YEAR_MIN && year <= YEAR_MAX ? year : null;
}

export function formatCareerYears(startYear, endYear) {
  const start = parseCareerYear(startYear);
  const end = parseCareerYear(endYear);
  if (start && end && end !== start) return `${start}–${end}`;
  if (start && end && end === start) return String(start);
  if (start) return String(start);
  if (end) return String(end);
  return "";
}

export function normalizeCareerRow(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const title = firstText(raw, TITLE_ALIASES);
  const organization = firstText(raw, ORG_ALIASES);
  const branch = firstText(raw, BRANCH_ALIASES);
  const start_year = parseCareerYear(
    raw.start_year ?? raw.startYear ?? raw.from_year ?? raw.fromYear ?? raw.Start,
  );
  const end_year = parseCareerYear(
    raw.end_year ?? raw.endYear ?? raw.to_year ?? raw.toYear ?? raw.End,
  );
  if (!title && !organization && !branch) return null;
  if (start_year == null && end_year == null) return null;
  return { title, organization, branch, start_year, end_year };
}

function careerKey(row) {
  return [
    String(row.title || "").toLowerCase(),
    String(row.organization || "").toLowerCase(),
    String(row.branch || "").toLowerCase(),
    row.start_year ?? "",
    row.end_year ?? "",
  ].join("|");
}

function careerSort(a, b) {
  const as = a.start_year ?? a.end_year ?? 0;
  const bs = b.start_year ?? b.end_year ?? 0;
  if (as !== bs) return as - bs;
  const ae = a.end_year ?? a.start_year ?? 0;
  const be = b.end_year ?? b.start_year ?? 0;
  if (ae !== be) return ae - be;
  return careerLabel(a).localeCompare(careerLabel(b));
}

/** Stored career/service rows. Empty stays empty — never guessed from role. */
export function personCareer(row) {
  if (!row || typeof row !== "object") return [];
  const raw = row.career ?? row.service_history ?? row.person_career ?? [];
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const next = normalizeCareerRow(item);
    if (!next) continue;
    const key = careerKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out.sort(careerSort);
}

export function mergeCareer(keep, extra) {
  return personCareer({ career: [...personCareer({ career: keep }), ...personCareer({ career: extra })] });
}

function foldCareer(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function containsFold(hay, needle) {
  const h = foldCareer(hay);
  const n = foldCareer(needle);
  return Boolean(h && n && h.includes(n));
}

/** Role/org; branch only when the row is military and not already in the label. */
export function careerLabel(row) {
  const title = String(row?.title || "").trim();
  const organization = String(row?.organization || "").trim();
  const branch = String(row?.branch || "").trim();
  const parts = [];
  if (title) parts.push(title);
  if (organization && foldCareer(organization) !== foldCareer(title)) {
    parts.push(organization);
  }
  const military = Boolean(branch);
  if (
    military &&
    !containsFold(title, branch) &&
    !containsFold(organization, branch)
  ) {
    parts.push(branch);
  }
  return parts.join(" · ");
}

export function careerLine(row) {
  const label = careerLabel(row);
  const years = formatCareerYears(row?.start_year, row?.end_year);
  if (!label || !years) return "";
  return `${label} · ${years}`;
}

/**
 * True when this career row is the same occupation as a KEEP event tag.
 * Detail must not restated that tag as history.
 */
export function careerOverlapsKeepEvent(row, ev) {
  const title = foldCareer(row?.title);
  const org = foldCareer(row?.organization);
  const pos = foldCareer(ev?.position);
  const evOrg = foldCareer(ev?.organization);
  if (title && pos && title === pos) {
    return !org || !evOrg || org === evOrg;
  }
  if (!title && org && evOrg && org === evOrg) return true;
  return false;
}

/** History rows only — omit KEEP-event occupations. Empty stays empty. */
export function visibleCareer(person, events) {
  const rows = personCareer(person);
  const tags = Array.isArray(events) ? events : [];
  return rows.filter((row) => !tags.some((ev) => careerOverlapsKeepEvent(row, ev)));
}

export { TITLE_ALIASES, ORG_ALIASES, BRANCH_ALIASES, START_ALIASES, END_ALIASES };
