/** Result-list sort. Year grouping is the default; other keys regroup the same cards. */

export const RESULTS_SORTS = ["year", "name", "occupation", "portrait"];
export const DEFAULT_RESULTS_SORT = "year";
export const RESULTS_SORT_STORAGE_KEY = "exittrace-results-sort";
export const RESULTS_SORT_LABELS = {
  year: "Year",
  name: "Name",
  occupation: "Occupation",
  portrait: "Portrait",
};
export const PORTRAIT_SORT_HAS = "Has portrait";
export const PORTRAIT_SORT_MISSING = "No portrait";
export const OCCUPATION_SORT_NONE = "No occupation";
export const NAME_SORT_OTHER = "#";

const NAME_GENERATIONAL_SUFFIXES = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
]);

/** Last name for directory sort: last token, dropping Jr./Sr./II… when a given name remains. */
export function personLastName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    const token = parts[parts.length - 1];
    const folded = token.replace(/[.,]+$/g, "").toLowerCase();
    if (NAME_GENERATIONAL_SUFFIXES.has(folded)) {
      parts.pop();
      continue;
    }
    break;
  }
  return parts[parts.length - 1] || raw;
}

export function comparePersonDirectoryNames(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  const byLast = personLastName(left).localeCompare(personLastName(right));
  if (byLast) return byLast;
  return left.localeCompare(right);
}

export function normalizeResultsSort(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase();
  return RESULTS_SORTS.includes(id) ? id : DEFAULT_RESULTS_SORT;
}

export function parseResultsSort(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) {
    return normalizeResultsSort(searchParams);
  }
  if (!searchParams.has("sort")) return DEFAULT_RESULTS_SORT;
  return normalizeResultsSort(searchParams.get("sort"));
}

export function parseCookieResultsSort(cookieHeader) {
  const raw = String(cookieHeader || "");
  if (!raw) return DEFAULT_RESULTS_SORT;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== RESULTS_SORT_STORAGE_KEY) continue;
    try {
      return normalizeResultsSort(decodeURIComponent(trimmed.slice(eq + 1).trim()));
    } catch {
      return DEFAULT_RESULTS_SORT;
    }
  }
  return DEFAULT_RESULTS_SORT;
}

/** Query `sort=` wins when present. Cookie is the standing choice across lists. */
export function resolveResultsSort(searchParams, cookieHeader) {
  if (searchParams instanceof URLSearchParams && searchParams.has("sort")) {
    return parseResultsSort(searchParams);
  }
  return parseCookieResultsSort(cookieHeader);
}

/** Keep pager and filter links on the same sort. Year stays off the URL. */
export function resultsSortHref(basePath, sort) {
  const raw = String(basePath || "/") || "/";
  const url = new URL(raw, "http://results.sort.invalid");
  const id = normalizeResultsSort(sort);
  if (id === DEFAULT_RESULTS_SORT) url.searchParams.delete("sort");
  else url.searchParams.set("sort", id);
  return `${url.pathname}${url.search}`;
}
