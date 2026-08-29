/** Published Forbes/Bloomberg net worth only. Never invent. Never overwrite gold. */

import { hostOf, parseHttpUrl } from "./official.mjs";

export const MISSING_NET_WORTH_NOTE =
  "No published Forbes or Bloomberg estimate located.";

export function isEligibleNetWorthUrl(raw) {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  const host = hostOf(parsed);
  return (
    host === "forbes.com" ||
    host.endsWith(".forbes.com") ||
    host === "bloomberg.com" ||
    host.endsWith(".bloomberg.com")
  );
}

export function parseNetWorthUsd(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/[$,_]/g, "");
  if (!text) return null;
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

export function hasRecordedNetWorth(person) {
  if (!person) return false;
  if (person.net_worth_usd !== null && person.net_worth_usd !== undefined && person.net_worth_usd !== "") {
    return true;
  }
  if (String(person.net_worth_note || "").trim()) return true;
  if (String(person.net_worth_source || "").trim()) return true;
  return false;
}

function noteForSource(raw, supplied = "") {
  const given = String(supplied || "").trim();
  if (given) return given;
  const host = hostOf(raw);
  if (host === "bloomberg.com" || host.endsWith(".bloomberg.com")) {
    return "Bloomberg Billionaires estimate.";
  }
  return "Forbes estimate.";
}

export function missingNetWorth() {
  return {
    net_worth_usd: null,
    net_worth_note: MISSING_NET_WORTH_NOTE,
    net_worth_source: "",
  };
}

/**
 * Resolve a published Forbes/Bloomberg estimate. Fail-closed: incomplete or
 * ineligible input → usd null and the standard missing note. Does not scrape
 * or search by name.
 */
export function resolveNetWorth(input = {}) {
  const source = String(input.net_worth_source || input.source || "").trim();
  const note = String(input.net_worth_note || input.note || "").trim();
  const usd = parseNetWorthUsd(input.net_worth_usd ?? input.usd);
  if (usd !== null && isEligibleNetWorthUrl(source)) {
    return {
      net_worth_usd: usd,
      net_worth_note: noteForSource(source, note),
      net_worth_source: source,
    };
  }
  return missingNetWorth();
}
