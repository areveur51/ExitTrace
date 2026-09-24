/** Corona sheet status → person_events.status. Fail-closed on unknown. */

export const CORONA_STATUS = Object.freeze({
  tested_positive: "tested_positive",
  died: "died",
  self_quarantine: "self_quarantine",
});

export const CORONA_STATUS_LABELS = Object.freeze({
  tested_positive: "Tested positive",
  died: "Died",
  self_quarantine: "Self-quarantine",
});

/**
 * Map sheet Status text onto the enum.
 * Died → corona PersonEventSection only (no auto death KEEP).
 * Unknown / empty → "".
 */
export function normalizeCoronaStatus(raw) {
  const text = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!text) return "";
  if (text === "died" || text === "dead" || text === "death") {
    return CORONA_STATUS.died;
  }
  if (text.includes("self") && text.includes("quarantine")) {
    return CORONA_STATUS.self_quarantine;
  }
  if (text.includes("tested") && text.includes("positive")) {
    return CORONA_STATUS.tested_positive;
  }
  if (text.includes("flees") && text.includes("quarantine")) {
    return CORONA_STATUS.self_quarantine;
  }
  return "";
}

export function coronaStatusLabel(status) {
  const key = normalizeCoronaStatus(status) || String(status || "").trim();
  return CORONA_STATUS_LABELS[key] || "";
}
