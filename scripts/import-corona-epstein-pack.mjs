#!/usr/bin/env node
/**
 * Corona + Epstein pack import (Admiral REVERT CLEAR).
 * Phase A: match existing → annotate; corona_comms tag only with ≥2 official cites.
 * Phase B: USA + Politicians/MSM/Police after second-cite hunt (fail-closed here; curated cites are Phase A).
 * Phase C HOLD. Died → corona section only. Resignations → lead annotate only.
 * Soft-ack OFF. leftover/:5434 NEVER. Writer :5433 only.
 *
 *   node scripts/import-corona-epstein-pack.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { normalizeCoronaStatus } from "../app/lib/corona-status.mjs";
import {
  EPSTEIN_SEED_NAMES,
  normalizeEpsteinLeg,
  normalizePassengerName,
} from "../app/lib/epstein-flight-log.mjs";
import { isOfficialCiteUrl } from "../app/lib/official.mjs";
import { CITE_FLOOR, attachPersonEvent } from "../app/lib/promote.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const PHASE_B_GROUPS = new Set(["Politicians & spouses", "MSM", "Police/Military", "police/Military"]);

function arg(name, fb = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fb;
  const v = process.argv[i + 1];
  return !v || v.startsWith("--") ? fb : v;
}

function normName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTsv(p) {
  const lines = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row = {};
    header.forEach((h, i) => (row[h] = cols[i] || ""));
    return row;
  });
}

function isUsa(c) {
  return /^(usa|us|united states|u\.s\.a?\.?)$/i.test(String(c || "").trim());
}

function isAggregate(name) {
  const n = String(name || "").trim();
  return !n || /^\(\d+\)/.test(n) || /staff member|employees|cops assigned|crew member|security detail|911 operator/i.test(n);
}

async function main() {
  const tsv = arg("tsv", "/opt/GrokBuild/packs/corona-epstein-20260923/corona-notable-mapped.tsv");
  const secondPath = arg("second-cites", path.join(ROOT, "var/corona-phase-a-second-cites.tsv"));
  const legsPath = arg("epstein-json", path.join(ROOT, "data/corona-epstein-20260923/epstein-seed-legs.json"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

  const sheet = readTsv(tsv);
  const secondById = new Map();
  for (const row of readTsv(secondPath)) {
    const id = row.person_id?.trim();
    const url = row.second_cite?.trim();
    if (!id || !url || !isOfficialCiteUrl(url)) continue;
    if (!secondById.has(id)) secondById.set(id, []);
    secondById.get(id).push(url);
  }
  const seedLegs = JSON.parse(fs.readFileSync(legsPath, "utf8"));

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const counts = {
    dry_run: !APPLY,
    phase_a_matched: 0,
    phase_a_tagged: 0,
    phase_a_annotate_existing: 0,
    phase_a_skip_cites: 0,
    phase_b_skip: 0,
    phase_c_hold: 0,
    resign_leads: 0,
    epstein_upserted: 0,
  };

  try {
    const people = await client.query("SELECT id, name, events FROM people");
    const byNorm = new Map();
    for (const p of people.rows) {
      const n = normName(p.name);
      if (!byNorm.has(n)) byNorm.set(n, []);
      byNorm.get(n).push(p);
    }

    // Link seed names → person ids
    const seedPerson = new Map();
    for (const seed of EPSTEIN_SEED_NAMES) {
      const hits = byNorm.get(normalizePassengerName(seed)) || byNorm.get(normName(seed)) || [];
      if (hits[0]) seedPerson.set(normalizePassengerName(seed), hits[0].id);
    }
    // Maxwell present; Roberts usually absent under Phase C HOLD.
    console.log("EPSTEIN_SEED_LINKS", Object.fromEntries(seedPerson));

    for (const raw of seedLegs) {
      const name = String(raw.first_last || `${raw.first} ${raw.last}`).trim();
      const leg = normalizeEpsteinLeg({
        passenger_name_raw: name,
        passenger_first: raw.first,
        passenger_last: raw.last,
        passenger_first_last: name,
        flight_date: raw.flight_date,
        dep_code: raw.dep_code,
        arr_code: raw.arr_code,
        dep: raw.dep || raw.dep_code || "",
        arr: raw.arr || raw.arr_code || "",
        aircraft_model: raw.aircraft_model,
        aircraft_tail: raw.aircraft_tail,
        aircraft_type: raw.aircraft_type,
        flight_no: raw.flight_no,
        pass_no: raw.pass_no,
        unique_key: raw.unique_id,
        comment: raw.comment,
        data_source: raw.data_source,
        source_url: raw.source_url,
        person_id: seedPerson.get(normalizePassengerName(name)) || null,
      });
      if (!leg) continue;
      if (!APPLY) continue;
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
          leg.passenger_name_raw, leg.passenger_first || null, leg.passenger_last || null,
          leg.passenger_first_last || null, leg.flight_date, leg.dep_code || null, leg.arr_code || null,
          leg.dep, leg.arr, leg.aircraft_model || null, leg.aircraft_tail || null, leg.aircraft_type || null,
          leg.aircraft, leg.flight_no || null, leg.pass_no || null, leg.unique_key || null,
          leg.comment || null, leg.data_source || null, leg.source_url || null, leg.person_id,
        ],
      );
      counts.epstein_upserted += 1;
    }
    if (!APPLY) counts.epstein_upserted = seedLegs.length;

    for (const row of sheet) {
      const hits = byNorm.get(normName(row.name)) || [];
      if (!hits.length) {
        if (isUsa(row.country) && PHASE_B_GROUPS.has(String(row.group || "").trim()) && !isAggregate(row.name)) {
          counts.phase_b_skip += 1; // no curated second cite → fail-closed
        } else {
          counts.phase_c_hold += 1;
        }
        continue;
      }
      counts.phase_a_matched += 1;
      const person = hits[0];
      let events = [];
      try {
        events = Array.isArray(person.events) ? person.events : JSON.parse(person.events || "[]");
      } catch {
        events = [];
      }
      const existing = events.find((e) => e.kind === "corona_comms");
      const sheetUrl = String(row.source || "").trim();
      const urls = [];
      if (sheetUrl) urls.push(sheetUrl);
      for (const u of secondById.get(person.id) || []) urls.push(u);
      if (existing) {
        for (const s of existing.sources || []) {
          const u = typeof s === "string" ? s : s?.url;
          if (u) urls.push(u);
        }
      }
      const official = [...new Set(urls)].filter((u) => isOfficialCiteUrl(u));
      if (official.length < CITE_FLOOR) {
        counts.phase_a_skip_cites += 1;
        console.log(`PHASE_A_SKIP_CITES id=${person.id} official=${official.length}`);
        continue;
      }
      const status = normalizeCoronaStatus(row.status);
      const event_date = String(row.date_reported || "").trim();
      if (!status || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
        counts.phase_a_skip_cites += 1;
        continue;
      }
      const incoming = {
        kind: "corona_comms",
        event_date,
        sources: official.map((url) => ({ url })),
        notable_group: String(row.group || "").trim(),
        title_note: String(row.title || "").trim(),
        country: String(row.country || "").trim(),
        status,
        comments: "",
      };
      const resign = String(row.resignations_list || "").trim();
      if (resign) {
        incoming.comments = `resignation.info lead: ${resign}`;
        counts.resign_leads += 1;
      }
      const { person: next, existed } = attachPersonEvent({ ...person, events }, incoming);
      // Prefer fill-empty attrs on annotate
      if (APPLY) {
        await client.query(`UPDATE people SET events = $2::jsonb WHERE id = $1`, [
          person.id,
          JSON.stringify(next.events),
        ]);
        const ev = next.events.find((e) => e.kind === "corona_comms");
        await client.query(
          `INSERT INTO person_events (
             person_id, kind, event_date, sources, country, comments,
             notable_group, title_note, status
           ) VALUES ($1,'corona_comms',$2::date,$3::jsonb,$4,$5,$6,$7,$8)
           ON CONFLICT (person_id, kind) DO UPDATE SET
             sources = EXCLUDED.sources,
             country = COALESCE(NULLIF(person_events.country,''), EXCLUDED.country),
             comments = COALESCE(NULLIF(person_events.comments,''), EXCLUDED.comments),
             notable_group = COALESCE(NULLIF(person_events.notable_group,''), EXCLUDED.notable_group),
             title_note = COALESCE(NULLIF(person_events.title_note,''), EXCLUDED.title_note),
             status = COALESCE(NULLIF(person_events.status,''), EXCLUDED.status)`,
          [
            person.id,
            ev.event_date,
            JSON.stringify(ev.sources || []),
            ev.country || "",
            ev.comments || "",
            ev.notable_group || "",
            ev.title_note || "",
            ev.status || "",
          ],
        );
      }
      if (existed) counts.phase_a_annotate_existing += 1;
      else counts.phase_a_tagged += 1;
      console.log(`PHASE_A_${existed ? "ANNOTATE" : "TAG"} id=${person.id} status=${status} cites=${official.length}`);
    }
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ counts }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
