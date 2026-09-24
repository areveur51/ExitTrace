/** Epstein flight-leg rows. Person-detail section hides when empty. */

export const EPSTEIN_SEED_NAMES = Object.freeze([
  "Ghislaine Maxwell",
  "Virginia Roberts",
]);

export function normalizePassengerName(raw) {
  return String(raw || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function epsteinLegKey(row = {}) {
  const passenger_name_raw = String(row.passenger_name_raw || "").trim();
  const flight_date = String(row.flight_date || "").trim().slice(0, 10);
  const dep = String(row.dep || row.dep_code || "").trim();
  const arr = String(row.arr || row.arr_code || "").trim();
  const aircraft = String(
    row.aircraft || row.aircraft_tail || row.aircraft_model || "",
  ).trim();
  return { passenger_name_raw, flight_date, dep, arr, aircraft };
}

export function normalizeEpsteinLeg(raw = {}) {
  const key = epsteinLegKey(raw);
  if (!key.passenger_name_raw || !/^\d{4}-\d{2}-\d{2}$/.test(key.flight_date)) {
    return null;
  }
  return {
    passenger_name_raw: key.passenger_name_raw,
    passenger_first: String(raw.passenger_first || "").trim(),
    passenger_last: String(raw.passenger_last || "").trim(),
    passenger_first_last: String(raw.passenger_first_last || "").trim(),
    flight_date: key.flight_date,
    dep_code: String(raw.dep_code || "").trim(),
    arr_code: String(raw.arr_code || "").trim(),
    dep: key.dep,
    arr: key.arr,
    aircraft_model: String(raw.aircraft_model || "").trim(),
    aircraft_tail: String(raw.aircraft_tail || "").trim(),
    aircraft_type: String(raw.aircraft_type || "").trim(),
    aircraft: key.aircraft,
    flight_no: String(raw.flight_no || "").trim(),
    pass_no: String(raw.pass_no || "").trim(),
    unique_key: String(raw.unique_key || "").trim(),
    comment: String(raw.comment || "").trim(),
    data_source: String(raw.data_source || "").trim(),
    source_url: String(raw.source_url || "").trim(),
    person_id: String(raw.person_id || "").trim() || null,
  };
}
