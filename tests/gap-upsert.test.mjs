import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALL_UPSERT_TABLES,
  COUNT_SQL,
  PUBLISHED_TABLES,
  assertSafeSql,
  buildUpsertSql,
  countProof,
  normalizePayload,
  planGapUpsert,
} from "../app/lib/gap-upsert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("published tables are people, dog_comms, operations, categories", () => {
  assert.deepEqual([...PUBLISHED_TABLES], ["people", "dog_comms", "operations", "categories"]);
  assert.ok(ALL_UPSERT_TABLES.includes("person_events"));
});

test("upsert SQL is idempotent ON CONFLICT and refuses destructive verbs", () => {
  const people = buildUpsertSql("people", [
    {
      id: "casey-vale",
      category: "arrests",
      name: "Casey Vale",
      role: "Clerk",
      event_date: "2024-06-15",
      sources: [{ url: "https://www.example.com/a" }],
      events: [],
      tags: [],
      career: [],
    },
  ]);
  assert.match(people.sql, /INSERT INTO people/);
  assert.match(people.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.doesNotMatch(people.sql, /TRUNCATE/);
  assert.doesNotMatch(people.sql, /DELETE/);
  assert.doesNotMatch(people.sql, /DROP /);
  assertSafeSql(people.sql);

  const dogs = buildUpsertSql("dog_comms", [
    {
      id: "dog-1",
      posted_at: "2026-09-16T12:00:00-04:00",
      handle: "@desk",
      text: "hello",
      source_url: "https://x.com/desk/status/1",
      snapshot: { posted_at: "2026-09-16T12:00:00-04:00" },
    },
  ]);
  assert.match(dogs.sql, /INSERT INTO dog_comms/);
  assert.match(dogs.sql, /posted_at = EXCLUDED.posted_at/);
  assert.equal(dogs.params[1], "2026-09-16T12:00:00-04:00");

  assert.throws(() => assertSafeSql("TRUNCATE people"), /destructive/);
  assert.throws(() => assertSafeSql("DELETE FROM dog_comms"), /destructive/);
  assert.throws(() => buildUpsertSql("source_posts", [{ id: "x" }]), /unknown/);
});

test("categories is optional when the table is absent", () => {
  const planned = planGapUpsert(
    {
      categories: [{ id: "firings", title: "Firings" }],
      people: [{ id: "a", name: "A", category: "firings", event_date: "2024-01-01" }],
    },
    { existingTables: ["people", "dog_comms", "operations", "person_events"] },
  );
  assert.equal(planned.plans.length, 1);
  assert.equal(planned.plans[0].table, "people");
  assert.equal(planned.skipped[0].table, "categories");
  assert.equal(planned.skipped[0].reason, "table_absent");
});

test("count proof is non-decreasing and reports source rows", () => {
  const proof = countProof(
    { people: 70, dog_comms: 54, operations: 8, person_events: 80, categories: 0 },
    { people: 80, dog_comms: 66, operations: 8, person_events: 91, categories: 0 },
    { people: 10, dog_comms: 12, operations: 0, person_events: 11, categories: 0 },
  );
  assert.equal(proof.people.delta, 10);
  assert.equal(proof.dog_comms.delta, 12);
  assert.equal(proof.operations.delta, 0);
  assert.equal(proof.people.ok, true);
  assert.match(COUNT_SQL, /FROM people/);
  assert.doesNotMatch(COUNT_SQL, /TRUNCATE/);
});

test("normalizePayload drops unknown tables and keeps published rows", () => {
  const n = normalizePayload({
    people: [{ id: "a", name: "A" }],
    parked_only: [{ id: "nope" }],
    source_posts: [{ id: "parked" }],
  });
  assert.equal(n.people[0].id, "a");
  assert.equal(n.dog_comms.length, 0);
  assert.equal("parked_only" in n, false);
  assert.equal("source_posts" in n, false);
});

test("gap upsert sources do not contain private-host needles", () => {
  const files = [
    "app/lib/gap-upsert.mjs",
    "scripts/gap-upsert-published.mjs",
    "scripts/export-published-tables.mjs",
    ".github/workflows/et-gap-upsert.yml",
  ];
  const needles = ["Grok" + "Build", "/o" + "pt/", "pop" + "-os", "192." + "168."];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const pat of needles) {
      assert.equal(text.includes(pat), false, `${rel} must not contain ${pat}`);
    }
  }
});
