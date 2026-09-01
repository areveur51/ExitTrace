/** Age at death from optional people.birth_date. Fail-closed: no guess. */

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

/** Whole completed years from birth_date to the death event_date. */
export function ageAtDeath(birthDate, deathDate) {
  const birth = asCalendarDate(birthDate);
  const death = asCalendarDate(deathDate);
  if (!birth || !death) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [dy, dm, dd] = death.split("-").map(Number);
  let years = dy - by;
  if (dm < bm || (dm === bm && dd < bd)) years -= 1;
  if (!Number.isFinite(years) || years < 0) return null;
  return years;
}

export function parseAgeBound(raw) {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0 || n > 150) return null;
  return n;
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

/** When a min or max is on, missing birth_date does not match. */
export function matchesAgeFilter(row, { minAge, maxAge } = {}) {
  if (!ageFilterActive({ minAge, maxAge })) return true;
  const age = ageAtDeath(row?.birth_date, row?.death_date);
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
