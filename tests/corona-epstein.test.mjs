import assert from "node:assert/strict";
import test from "node:test";
import { coronaStatusLabel, normalizeCoronaStatus } from "../app/lib/corona-status.mjs";
import { EVENT_ATTR_FIELDS, normalizeEventAttrs } from "../app/lib/event-attrs.mjs";
import {
  EPSTEIN_SEED_NAMES,
  normalizeEpsteinLeg,
  normalizePassengerName,
} from "../app/lib/epstein-flight-log.mjs";
import { ALL_UPSERT_TABLES } from "../app/lib/gap-upsert.mjs";

test("corona status enum maps sheet variants", () => {
  assert.equal(normalizeCoronaStatus("Tested Positive"), "tested_positive");
  assert.equal(normalizeCoronaStatus("TEsted Positive"), "tested_positive");
  assert.equal(normalizeCoronaStatus("Died"), "died");
  assert.equal(normalizeCoronaStatus("Reported Sick - Self-Quarantine"), "self_quarantine");
  assert.equal(normalizeCoronaStatus("Flees and Self Quarantined"), "self_quarantine");
  assert.equal(normalizeCoronaStatus("nope"), "");
  assert.equal(coronaStatusLabel("died"), "Died");
});

test("event attrs include corona fields and normalize status", () => {
  assert.ok(EVENT_ATTR_FIELDS.includes("notable_group"));
  assert.ok(EVENT_ATTR_FIELDS.includes("title_note"));
  assert.ok(EVENT_ATTR_FIELDS.includes("status"));
  const attrs = normalizeEventAttrs({
    notable_group: "MSM",
    title_note: "Anchor",
    status: "Tested Positive",
    country: "USA",
  });
  assert.equal(attrs.status, "tested_positive");
  assert.equal(attrs.notable_group, "MSM");
  assert.equal(attrs.title_note, "Anchor");
});

test("epstein leg normalize + seed names", () => {
  assert.equal(EPSTEIN_SEED_NAMES.length, 2);
  const leg = normalizeEpsteinLeg({
    passenger_name_raw: "Ghislaine Maxwell",
    flight_date: "2001-01-01",
    dep: "TEB",
    arr: "PBI",
    aircraft_tail: "N908JE",
  });
  assert.equal(leg.aircraft, "N908JE");
  assert.equal(normalizePassengerName("Ghislaine Maxwell"), "ghislaine maxwell");
  assert.equal(normalizeEpsteinLeg({ passenger_name_raw: "X", flight_date: "bad" }), null);
});

test("gap upsert publishes epstein_flight_legs", () => {
  assert.ok(ALL_UPSERT_TABLES.includes("epstein_flight_legs"));
});
