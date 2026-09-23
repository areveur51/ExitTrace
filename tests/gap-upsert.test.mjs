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
  countTableSql,
  normalizePayload,
  pickRow,
  planGapUpsert,
} from "../app/lib/gap-upsert.mjs";
import { PLACE_STEPS } from "../scripts/prove-new-kind-render-sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("published tables include the new comms tables and person_events", () => {
  assert.deepEqual([...PUBLISHED_TABLES], [
    "people",
    "dog_comms",
    "operations",
    "categories",
    "red_folder_comms",
    "central_casting_comms",
  ]);
  assert.deepEqual(
    [...ALL_UPSERT_TABLES],
    [...PUBLISHED_TABLES, "person_events"],
  );
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
    {
      people: 70,
      dog_comms: 54,
      operations: 8,
      person_events: 80,
      categories: 0,
      red_folder_comms: 3,
      central_casting_comms: 2,
    },
    {
      people: 80,
      dog_comms: 66,
      operations: 8,
      person_events: 91,
      categories: 0,
      red_folder_comms: 4,
      central_casting_comms: 2,
    },
    {
      people: 10,
      dog_comms: 12,
      operations: 0,
      person_events: 11,
      categories: 0,
      red_folder_comms: 1,
      central_casting_comms: 0,
    },
  );
  assert.equal(proof.people.delta, 10);
  assert.equal(proof.dog_comms.delta, 12);
  assert.equal(proof.operations.delta, 0);
  assert.equal(proof.red_folder_comms.delta, 1);
  assert.equal(proof.central_casting_comms.delta, 0);
  assert.equal(proof.people.ok, true);
  assert.equal(proof.red_folder_comms.ok, true);
  assert.match(COUNT_SQL, /FROM people/);
  assert.match(COUNT_SQL, /FROM red_folder_comms/);
  assert.match(COUNT_SQL, /FROM central_casting_comms/);
  assert.doesNotMatch(COUNT_SQL, /TRUNCATE/);
  assert.doesNotMatch(COUNT_SQL, /DELETE/);
  assert.equal(countTableSql("central_casting_comms"), "SELECT count(*)::int AS n FROM central_casting_comms");
  assert.throws(() => countTableSql("source_posts"), /unknown/);
});

test("red_folder_comms and central_casting_comms gap-upsert like dog_comms", () => {
  const red = buildUpsertSql("red_folder_comms", [
    {
      id: "rf-1",
      posted_at: "2026-09-16",
      handle: "@desk",
      text: "note",
      source_url: "https://x.com/desk/status/2",
      snapshot: {},
    },
  ]);
  assert.match(red.sql, /INSERT INTO red_folder_comms/);
  assert.match(red.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(red.sql, /snapshot = EXCLUDED.snapshot/);
  assert.doesNotMatch(red.sql, /person_id/);
  assert.doesNotMatch(red.sql, /DELETE|TRUNCATE|DROP /);

  const cc = buildUpsertSql("central_casting_comms", [
    {
      id: "cc-1",
      posted_at: "2026-09-16",
      handle: "@desk",
      text: "quote",
      source_url: "https://www.justice.gov/opa/pr/example",
      snapshot: { posted_at: "2026-09-16" },
      person_id: "casey-vale",
    },
  ]);
  assert.match(cc.sql, /INSERT INTO central_casting_comms \(id, posted_at, handle, account_name, text, still, still_credit, screenshot, screenshot_credit, source_url, snapshot, person_id\)/);
  assert.match(cc.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(cc.sql, /person_id = EXCLUDED.person_id/);
  assert.equal(cc.params.at(-1), "casey-vale");
  assert.equal(cc.params.includes(JSON.stringify({ posted_at: "2026-09-16" })), true);

  const blank = buildUpsertSql("central_casting_comms", [
    { id: "cc-2", person_id: "  " },
  ]);
  assert.equal(blank.params.at(-1), null);

  const absent = planGapUpsert(
    {
      red_folder_comms: [{ id: "rf-1", text: "note" }],
      central_casting_comms: [{ id: "cc-1", person_id: "casey-vale", text: "quote" }],
      people: [{ id: "casey-vale", name: "Casey Vale" }],
    },
    { existingTables: ["people", "dog_comms", "operations", "person_events"] },
  );
  assert.deepEqual(
    absent.skipped.map((row) => row.table),
    ["red_folder_comms", "central_casting_comms"],
  );
  assert.equal(absent.plans.length, 1);
  assert.equal(absent.plans[0].table, "people");
});

test("people.central_casting is a json array and is never invented", () => {
  const cites = ["https://www.justice.gov/opa/pr/example"];
  const kept = buildUpsertSql("people", [
    { id: "casey-vale", name: "Casey Vale", central_casting: cites },
  ]);
  assert.match(kept.sql, /central_casting/);
  assert.match(kept.sql, /\$\d+::jsonb/);
  assert.equal(kept.params.at(-1), JSON.stringify(cites));

  const fromString = pickRow("people", {
    id: "casey-vale",
    central_casting: JSON.stringify(cites),
  });
  assert.equal(fromString.central_casting, JSON.stringify(cites));

  const missing = pickRow("people", { id: "casey-vale" });
  assert.equal(missing.central_casting, "[]");

  const objectShape = pickRow("people", {
    id: "casey-vale",
    central_casting: { url: "https://example.com/not-a-membership" },
  });
  assert.equal(objectShape.central_casting, "[]");
  assert.equal(JSON.stringify(objectShape).includes("not-a-membership"), false);
});

test("person_events unsealed stays annotate-only true coalesce", () => {
  const opened = buildUpsertSql("person_events", [
    {
      person_id: "gold-row",
      kind: "indictment_civilian",
      event_date: "2024-01-01",
      unsealed: true,
    },
  ]);
  assert.match(
    opened.sql,
    /unsealed = CASE WHEN person_events\.unsealed IS TRUE THEN TRUE ELSE EXCLUDED\.unsealed END/,
  );
  assert.equal(opened.params.at(-1), true);

  const sealed = buildUpsertSql("person_events", [
    { person_id: "gold-row", kind: "indictment_civilian", unsealed: false },
  ]);
  assert.equal(sealed.params.at(-1), null);
  assert.equal(sealed.params.includes(false), false);

  const missing = buildUpsertSql("person_events", [
    { person_id: "gold-row", kind: "indictment_civilian" },
  ]);
  assert.equal(missing.params.at(-1), null);
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

test("new-kind place steps name logical backfill and refuse copy_data true", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/NEW_KIND_RENDER_SYNC.md"), "utf8");
  for (const text of [doc, PLACE_STEPS]) {
    assert.match(text, /exittrace_lab_pub/);
    assert.match(text, /exittrace_lab_sub/);
    assert.match(text, /copy_data = false/);
    assert.match(text, /red_folder_comms/);
    assert.match(text, /central_casting_comms/);
    assert.match(text, /central_casting/);
    assert.match(text, /gap-upsert/);
    assert.match(text, /does not copy rows already stored/);
    assert.doesNotMatch(text, /REFRESH PUBLICATION WITH \(copy_data = true\)/);
    assert.doesNotMatch(text, /\bDELETE FROM\b|\bDROP TABLE\b/);
  }
  assert.match(doc, /categories, store, HTML, and server only/);
  assert.match(doc, /SYNC_MODE=logical/);
  assert.match(doc, /media-delta/);
  assert.match(PLACE_STEPS, /HTTPS peer path is not this path/);
  assert.match(doc, /Never `copy_data=true`/);
});

test("gap upsert sources do not contain private-host needles", () => {
  const files = [
    "app/lib/gap-upsert.mjs",
    "scripts/gap-upsert-published.mjs",
    "scripts/export-published-tables.mjs",
    "scripts/prove-new-kind-render-sync.mjs",
    "docs/NEW_KIND_RENDER_SYNC.md",
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
