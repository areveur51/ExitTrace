import fs from "node:fs";
import pg from "pg";
import { normalizeEpsteinLeg, normalizePassengerName, EPSTEIN_SEED_NAMES } from "../app/lib/epstein-flight-log.mjs";

const APPLY = process.argv.includes("--apply");
const legsPath = process.argv.find((a,i)=>process.argv[i-1]==="--json") || "data/corona-epstein-20260923/epstein-seed-legs.json";
const raw = JSON.parse(fs.readFileSync(legsPath, "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const people = await client.query("SELECT id, name FROM people");
const byNorm = new Map(people.rows.map((p) => [normalizePassengerName(p.name), p.id]));
// also alias Maxwell
const seedIds = new Map();
for (const seed of EPSTEIN_SEED_NAMES) {
  const id = byNorm.get(normalizePassengerName(seed));
  if (id) seedIds.set(normalizePassengerName(seed), id);
}
console.log({ seedIds: Object.fromEntries(seedIds), legs: raw.length });
let n = 0;
for (const row of raw) {
  const name = String(row.first_last || `${row.first||""} ${row.last||""}`).trim();
  const leg = normalizeEpsteinLeg({
    passenger_name_raw: name,
    passenger_first: row.first,
    passenger_last: row.last,
    passenger_first_last: name,
    flight_date: row.flight_date,
    dep_code: row.dep_code,
    arr_code: row.arr_code,
    dep: row.dep || row.dep_code || "",
    arr: row.arr || row.arr_code || "",
    aircraft_model: row.aircraft_model,
    aircraft_tail: row.aircraft_tail,
    aircraft_type: row.aircraft_type,
    flight_no: row.flight_no,
    pass_no: row.pass_no,
    unique_key: row.unique_id,
    comment: row.comment,
    data_source: row.data_source,
    source_url: row.source_url,
    person_id: seedIds.get(normalizePassengerName(name)) || null,
  });
  if (!leg) continue;
  if (!APPLY) { n++; continue; }
  await client.query(
    `INSERT INTO epstein_flight_legs (
       passenger_name_raw, passenger_first, passenger_last, passenger_first_last,
       flight_date, dep_code, arr_code, dep, arr,
       aircraft_model, aircraft_tail, aircraft_type, aircraft,
       flight_no, pass_no, unique_key, comment, data_source, source_url, person_id
     ) VALUES (
       $1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     ON CONFLICT (passenger_name_raw, flight_date, dep, arr, aircraft) DO UPDATE SET
       person_id = COALESCE(epstein_flight_legs.person_id, EXCLUDED.person_id)`,
    [
      leg.passenger_name_raw, leg.passenger_first||null, leg.passenger_last||null,
      leg.passenger_first_last||null, leg.flight_date, leg.dep_code||null, leg.arr_code||null,
      leg.dep, leg.arr, leg.aircraft_model||null, leg.aircraft_tail||null, leg.aircraft_type||null,
      leg.aircraft, leg.flight_no||null, leg.pass_no||null, leg.unique_key||null,
      leg.comment||null, leg.data_source||null, leg.source_url||null, leg.person_id,
    ],
  );
  n++;
}
const counts = await client.query(
  `SELECT
     (SELECT count(*)::int FROM epstein_flight_legs) AS legs,
     (SELECT count(*)::int FROM epstein_flight_legs WHERE person_id IS NOT NULL) AS linked`,
);
console.log({ upserted: n, apply: APPLY, ...counts.rows[0] });
await client.end();
