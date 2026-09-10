/** Age at event from birth_date + that tag's event_date. Fail-closed: no guess. */

export const AGE_BANDS = [
  { id: "13-17", label: "13-17", minAge: 13, maxAge: 17 },
  { id: "18-24", label: "18-24", minAge: 18, maxAge: 24 },
  { id: "25-34", label: "25-34", minAge: 25, maxAge: 34 },
  { id: "35-44", label: "35-44", minAge: 35, maxAge: 44 },
  { id: "45-54", label: "45-54", minAge: 45, maxAge: 54 },
  { id: "55-64", label: "55-64", minAge: 55, maxAge: 64 },
  { id: "65+", label: "65+", minAge: 65, maxAge: null },
];

const AGE_BAND_BY_ID = new Map(AGE_BANDS.map((b) => [b.id, b]));

function asCalendarDate(v) {
  if (!v) return null;
  const text =
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  if (new Date(ms).toISOString().slice(0, 10) !== text) return null;
  return text;
}

/** Whole completed years from birth_date to an event date. */
export function ageAtEvent(birthDate, eventDate) {
  const birth = asCalendarDate(birthDate);
  const at = asCalendarDate(eventDate);
  if (!birth || !at) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ey, em, ed] = at.split("-").map(Number);
  let years = ey - by;
  if (em < bm || (em === bm && ed < bd)) years -= 1;
  if (!Number.isFinite(years) || years < 0) return null;
  return years;
}

/** Whole completed years from birth_date to the death event_date. */
export function ageAtDeath(birthDate, deathDate) {
  return ageAtEvent(birthDate, deathDate);
}

export function parseAgeBound(raw) {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0 || n > 150) return null;
  return n;
}

/** Calendar birth_date only. Empty / invalid is not a date and is not guessed. */
export function knownBirthDate(raw) {
  return asCalendarDate(raw) != null;
}

export function parseAgeBand(raw) {
  const id = decodeURIComponent(String(raw || "")).trim();
  if (!id || id === "all") return null;
  return AGE_BAND_BY_ID.get(id) || null;
}

export function ageBandFor(age) {
  const n = parseStoredAge(age);
  if (n == null) return null;
  return AGE_BANDS.find((b) => n >= b.minAge && (b.maxAge == null || n <= b.maxAge)) || null;
}

/** All = any bandable age. Missing age never matches a selected band. */
export function matchesAgeBand(age, band) {
  if (!band) return ageBandFor(age) != null;
  const n = parseStoredAge(age);
  if (n == null) return false;
  if (n < band.minAge) return false;
  if (band.maxAge != null && n > band.maxAge) return false;
  return true;
}

export function parseAgeFilter(searchParams) {
  const src =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams || "");
  return {
    minAge: parseAgeBound(src.get("min_age")),
    maxAge: parseAgeBound(src.get("max_age")),
  };
}

export function ageFilterActive({ minAge, maxAge } = {}) {
  return minAge != null || maxAge != null;
}

export function parseStoredAge(raw) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < 0 || n > 150) return null;
  return n;
}

/**
 * Prefer stored age_at_event for that tag. Missing birth_date or event_date
 * is not age-filterable. Do not guess.
 */
export function storedAgeAtEvent(row, birthDate, eventDate) {
  const stored = parseStoredAge(row?.age_at_event);
  if (stored != null) return stored;
  const at = eventDate || row?.death_date || row?.event_date;
  return ageAtEvent(birthDate ?? row?.birth_date, at);
}

/** Stamp whole years onto an event when both calendar dates exist. */
export function stampEventAge(ev, birthDate) {
  if (!ev || typeof ev !== "object") return ev;
  const stored = parseStoredAge(ev.age_at_event);
  if (stored != null) return { ...ev, age_at_event: stored };
  const age = ageAtEvent(birthDate, ev.event_date);
  return { ...ev, age_at_event: age };
}

/** When a min or max is on, missing stored/derivable age does not match. */
export function matchesAgeFilter(row, { minAge, maxAge } = {}) {
  if (!ageFilterActive({ minAge, maxAge })) return true;
  const age = storedAgeAtEvent(row);
  if (age == null) return false;
  if (minAge != null && age < minAge) return false;
  if (maxAge != null && age > maxAge) return false;
  return true;
}

export function ageFilterQuery({ minAge, maxAge } = {}) {
  const params = new URLSearchParams();
  if (minAge != null) params.set("min_age", String(minAge));
  if (maxAge != null) params.set("max_age", String(maxAge));
  return params.toString();
}

export function ageFilterPath(basePath, filter) {
  const path = basePath || "/";
  const q = ageFilterQuery(filter);
  if (!q) return path;
  return path.includes("?") ? `${path}&${q}` : `${path}?${q}`;
}
