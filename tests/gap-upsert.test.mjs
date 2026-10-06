import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALL_UPSERT_TABLES,
  COUNT_SQL,
  PUBLISHED_TABLES,
  LAB_OWNED_META_KEYS,
  assertSafeSql,
  isLabOwnedMetaKey,
  buildUpsertSql,
  chunkUpsertRows,
  countProof,
  countTableSql,
  normalizePayload,
  pickRow,
  planGapUpsert,
  upsertChunkSize,
  UPSERT_PARAM_BUDGET,
} from "../app/lib/gap-upsert.mjs";
import { PLACE_STEPS } from "../scripts/prove-new-kind-render-sync.mjs";
import { HEAL_META_KEYS } from "../app/lib/logical-heal.mjs";
import { KEEP_UP_META_KEYS } from "../app/lib/keep-up.mjs";

// Separate import keeps this hunk away from the shared import block.
import { COUNT_TABLES } from "../app/lib/gap-upsert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("published tables include the new comms tables and person_events", () => {
  assert.deepEqual([...PUBLISHED_TABLES], [
    "people",
    "dog_comms",
    "eagle_comms",
    "ronald_comms",
    "boot_comms",
    "operations",
    "categories",
    "red_folder_comms",
    "central_casting_comms",
    "request_attributions",
    "epstein_flight_legs",
    "source_posts",
    "add_requests",
    "et_meta",
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
  assert.throws(() => buildUpsertSql("mention_queue", [{ id: "x" }]), /unknown/);
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
  assert.equal(countTableSql("source_posts"), "SELECT count(*)::int AS n FROM source_posts");
  assert.throws(() => countTableSql("mention_queue"), /unknown/);
});

test("count proof only names real published tables (never JS-only categories)", () => {
  const named = [...COUNT_SQL.matchAll(/FROM ([a-z_]+)\) AS ([a-z_]+)/g)].map((m) => {
    assert.equal(m[1], m[2]);
    return m[1];
  });
  assert.deepEqual([...named].sort(), [...COUNT_TABLES].sort());
  for (const t of COUNT_TABLES) assert.equal(ALL_UPSERT_TABLES.includes(t), true, t);
  assert.equal(COUNT_TABLES.includes("categories"), false);
  assert.equal(COUNT_TABLES.includes("add_requests"), true);
  assert.equal(COUNT_TABLES.includes("et_meta"), true);
  assert.doesNotMatch(COUNT_SQL, /categories/);
  assert.match(COUNT_SQL, /\(SELECT count\(\*\)::int FROM add_requests\) AS add_requests/);
  assert.match(COUNT_SQL, /\(SELECT count\(\*\)::int FROM et_meta\) AS et_meta/);
  assert.equal("categories" in countProof({}, {}, {}), false);
  assert.equal("add_requests" in countProof({}, {}, {}), true);
  assert.equal("et_meta" in countProof({}, {}, {}), true);
  const script = fs.readFileSync(path.join(ROOT, "scripts/gap-upsert-published.mjs"), "utf8");
  assert.doesNotMatch(script, /countOne\(\s*["']categories["']\s*\)/);
  assert.doesNotMatch(script, /FROM categories/);
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
  assert.equal(
    kept.params.find((value) => String(value).includes("justice.gov")),
    JSON.stringify(cites),
  );

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

test("people.nicknames stay a cited list and are never invented", () => {
  const missing = pickRow("people", { id: "casey-vale" });
  assert.equal(missing.nicknames, "[]");

  const junk = pickRow("people", {
    id: "casey-vale",
    nicknames: { name: "Nope", by: "Donald Trump" },
  });
  assert.equal(junk.nicknames, "[]");

  const oneCite = pickRow("people", {
    id: "casey-vale",
    nicknames: [
      {
        name: "Nope",
        by: "Donald Trump",
        sources: [{ url: "https://www.reuters.com/world/us/one" }],
      },
    ],
  });
  assert.equal(oneCite.nicknames, "[]");

  const kept = buildUpsertSql("people", [
    {
      id: "casey-vale",
      name: "Casey Vale",
      nicknames: [
        {
          name: "Newscum",
          by: "Donald Trump",
          sources: [
            { url: "https://www.reuters.com/world/us/newscum", publisher: "Reuters", date: "2026-03-16" },
            { url: "https://apnews.com/article/newscum", publisher: "Associated Press", date: "2025-06-09" },
          ],
        },
      ],
    },
  ]);
  assert.match(kept.sql, /nicknames/);
  assert.match(kept.sql, /\$\d+::jsonb/);
  const nickParam = kept.params.find((value) => String(value).includes("Newscum"));
  assert.ok(nickParam);
  assert.equal(String(nickParam).includes("wikipedia.org"), false);
});

test("people.clearances stay a cited list and are never invented", () => {
  const missing = pickRow("people", { id: "casey-vale" });
  assert.equal(missing.clearances, "[]");

  const oneCite = pickRow("people", {
    id: "casey-vale",
    clearances: [
      {
        status: "revoked",
        date: "2025-01-20",
        authority: "Executive Order 14152",
        sources: [{ url: "https://www.govinfo.gov/content/pkg/FR-2025-01-29/html/2025-01954.htm" }],
      },
    ],
  });
  assert.equal(oneCite.clearances, "[]");

  const kept = buildUpsertSql("people", [
    {
      id: "casey-vale",
      name: "Casey Vale",
      clearances: [
        {
          status: "revoked",
          date: "2025-01-20",
          authority: "Executive Order 14152",
          sources: [
            {
              url: "https://www.govinfo.gov/content/pkg/FR-2025-01-29/html/2025-01954.htm",
              publisher: "Federal Register",
              date: "2025-01-20",
            },
            {
              url: "https://www.whitehouse.gov/presidential-actions/2025/01/holding-former-government-officials-accountablefor-election-interference-and-improper-disclosure-of-sensitive-governmental-information/",
              publisher: "The White House",
              date: "2025-01-20",
            },
          ],
        },
      ],
    },
  ]);
  assert.match(kept.sql, /clearances/);
  const clearanceParam = kept.params.find((value) => String(value).includes("14152"));
  assert.ok(clearanceParam);
  assert.equal(String(clearanceParam).includes("wikipedia.org"), false);
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
  assert.equal(n.source_posts[0].id, "parked");
  assert.equal(n.source_posts[0].media_urls, "[]");
});

const SOURCE_POST_ROW = Object.freeze({
  id: "sp-0000000000000001",
  category: "arrests",
  source_url: "https://x.com/desk/status/1",
  canonical_url: "https://x.com/desk/status/1",
  quoted_url: "",
  card_url: "",
  text: "parked post",
  poster_handle: "@desk",
  poster_name: "Desk",
  posted_at: "2026-10-06",
  media_urls: ["https://pbs.twimg.com/media/a.jpg"],
  gold_person_id: null,
});

test("source_posts is exported, upserted by id, and counted", () => {
  assert.equal(PUBLISHED_TABLES.includes("source_posts"), true);
  assert.equal(ALL_UPSERT_TABLES.includes("source_posts"), true);
  assert.match(COUNT_SQL, /\(SELECT count\(\*\)::int FROM source_posts\) AS source_posts/);
  assert.deepEqual(Object.keys(pickRow("source_posts", SOURCE_POST_ROW)), [
    "id",
    "category",
    "source_url",
    "canonical_url",
    "quoted_url",
    "card_url",
    "text",
    "poster_handle",
    "poster_name",
    "posted_at",
    "media_urls",
    "gold_person_id",
  ]);
  const built = buildUpsertSql("source_posts", [SOURCE_POST_ROW]);
  assert.match(built.sql, /^INSERT INTO source_posts \(id, category, source_url, canonical_url,/);
  assert.match(built.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.doesNotMatch(built.sql, /id = EXCLUDED\.id/);
  // media_urls is the only jsonb column (slot 11 of 12).
  assert.match(built.sql, /\$11::jsonb/);
  assert.equal((built.sql.match(/::jsonb/g) || []).length, 1);
  assert.equal(built.params[10], JSON.stringify(SOURCE_POST_ROW.media_urls));
  // NOT NULL media_urls never binds null.
  const bare = buildUpsertSql("source_posts", [{ ...SOURCE_POST_ROW, media_urls: null }]);
  assert.equal(bare.params[10], "[]");
});

test("source_posts upsert never erases an existing gold_person_id with a null", () => {
  const unlinked = buildUpsertSql("source_posts", [SOURCE_POST_ROW]);
  assert.match(
    unlinked.sql,
    /gold_person_id = COALESCE\(EXCLUDED\.gold_person_id, source_posts\.gold_person_id\)/,
  );
  assert.doesNotMatch(unlinked.sql, /gold_person_id = EXCLUDED\.gold_person_id\b(?!,)/);
  assert.equal(unlinked.params.at(-1), null);
  const blank = buildUpsertSql("source_posts", [{ ...SOURCE_POST_ROW, gold_person_id: "  " }]);
  assert.equal(blank.params.at(-1), null);
  const linked = buildUpsertSql("source_posts", [{ ...SOURCE_POST_ROW, gold_person_id: "casey-vale" }]);
  assert.equal(linked.params.at(-1), "casey-vale");
});

test("source_posts gap upsert is insert/update only, never delete", () => {
  const planned = planGapUpsert(
    { source_posts: [SOURCE_POST_ROW, { ...SOURCE_POST_ROW, id: "sp-2", canonical_url: "https://x.com/desk/status/2" }] },
    { existingTables: ["source_posts"] },
  );
  assert.equal(planned.counts_in.source_posts, 2);
  assert.equal(planned.plans.length, 1);
  for (const plan of planned.plans) {
    assert.match(plan.sql, /^INSERT INTO source_posts/);
    assert.doesNotMatch(plan.sql, /\b(DELETE|TRUNCATE|DROP)\b/i);
    assertSafeSql(plan.sql);
  }
  const absent = planGapUpsert({ source_posts: [SOURCE_POST_ROW] }, { existingTables: ["people"] });
  assert.equal(absent.plans.length, 0);
  assert.deepEqual(absent.skipped, [{ table: "source_posts", reason: "table_absent", count: 1 }]);
  const proof = countProof({ source_posts: 2321 }, { source_posts: 2409 }, { source_posts: 2409 });
  assert.equal(proof.source_posts.delta, 88);
  assert.equal(proof.source_posts.ok, true);
  assert.equal(countProof({ source_posts: 5 }, { source_posts: 4 }, { source_posts: 4 }).source_posts.ok, false);
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

test("gap upsert splits a table that would exceed the parameter budget", () => {
  const size = upsertChunkSize("epstein_flight_legs");
  assert.ok(size >= 1);
  const rows = Array.from({ length: size + 1 }, (_, i) => ({
    passenger_name_raw: `Passenger ${i}`,
    flight_date: "1998-01-03",
    dep: "West Palm Beach, FL, United States",
    arr: "Teterboro, NJ, United States",
    aircraft: "N908JE",
  }));
  assert.equal(chunkUpsertRows("epstein_flight_legs", rows).length, 2);
  const planned = planGapUpsert(
    { epstein_flight_legs: rows },
    { existingTables: ["epstein_flight_legs"] },
  );
  assert.equal(planned.plans.length, 2);
  assert.equal(planned.counts_in.epstein_flight_legs, rows.length);
  for (const plan of planned.plans) {
    assert.equal(plan.table, "epstein_flight_legs");
    assert.ok(plan.params.length <= UPSERT_PARAM_BUDGET);
    assert.match(plan.sql, /INSERT INTO epstein_flight_legs/);
  }
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

const ADD_REQUEST_ROW = Object.freeze({
  id: "ar-0000000000000001",
  kind: "person",
  status: "applied",
  subject: "Casey Vale",
  category: "arrests",
  event_date: "2026-10-01",
  hint_url: "https://www.example.com/hint",
  handle: "@desk",
  source_url: "https://x.com/desk/status/1",
  posted_at: "2026-10-01",
  cite_urls: ["https://www.example.com/a"],
  payload: { source: "x_mention" },
  error: null,
  result: { person_id: "casey-vale" },
  created_at: "2026-10-01T12:00:00.000Z",
  processed_at: "2026-10-01T12:05:00.000Z",
});

test("add_requests and et_meta are exported, upserted by key, and counted", () => {
  for (const t of ["add_requests", "et_meta"]) {
    assert.equal(PUBLISHED_TABLES.includes(t), true);
    assert.equal(ALL_UPSERT_TABLES.includes(t), true);
    assert.match(COUNT_SQL, new RegExp(`\\(SELECT count\\(\\*\\)::int FROM ${t}\\) AS ${t}`));
    assert.equal(countTableSql(t), `SELECT count(*)::int AS n FROM ${t}`);
  }
  assert.equal(PUBLISHED_TABLES.includes("lead_ingest"), false);
  assert.equal(PUBLISHED_TABLES.includes("mention_queue"), false);

  assert.deepEqual(Object.keys(pickRow("add_requests", ADD_REQUEST_ROW)), [
    "id", "kind", "status", "subject", "category", "event_date", "hint_url", "handle",
    "source_url", "posted_at", "cite_urls", "payload", "error", "result", "created_at", "processed_at",
  ]);
  const ar = buildUpsertSql("add_requests", [ADD_REQUEST_ROW]);
  assert.match(ar.sql, /^INSERT INTO add_requests \(id, kind, status,/);
  assert.match(ar.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.deepEqual(ar.sql.match(/\$\d+::jsonb/g), ["$11::jsonb", "$12::jsonb", "$14::jsonb"]);
  assert.equal(ar.params[10], JSON.stringify(ADD_REQUEST_ROW.cite_urls));
  assert.equal(ar.params[11], JSON.stringify(ADD_REQUEST_ROW.payload));
  const bare = buildUpsertSql("add_requests", [{ ...ADD_REQUEST_ROW, cite_urls: null, payload: null, result: null, status: "" }]);
  assert.equal(bare.params[10], "[]");
  assert.equal(bare.params[11], "{}");
  assert.equal(bare.params[13], null);
  assert.equal(bare.params[2], "pending");

  assert.deepEqual(Object.keys(pickRow("et_meta", { k: "seed", v: {} })), ["k", "v"]);
  const meta = buildUpsertSql("et_meta", [{ k: "keep_up.daily_pack.last_pass", v: { at: "2026-10-06T13:50:18Z" } }]);
  assert.match(meta.sql, /^INSERT INTO et_meta \(k, v\)/);
  assert.match(meta.sql, /ON CONFLICT \(k\) DO UPDATE SET/);
  assert.match(meta.sql, /\$2::jsonb/);
  assert.equal(meta.params[1], JSON.stringify({ at: "2026-10-06T13:50:18Z" }));
});

test("add_requests upsert never regresses a terminal status or erases processed fields", () => {
  const { sql } = buildUpsertSql("add_requests", [ADD_REQUEST_ROW]);
  assert.match(
    sql,
    /status = CASE WHEN EXCLUDED\.status = 'pending' AND add_requests\.status IN \('applied', 'rejected'\) THEN add_requests\.status ELSE EXCLUDED\.status END/,
  );
  for (const c of ["error", "result", "processed_at"]) {
    assert.match(sql, new RegExp(`${c} = COALESCE\\(EXCLUDED\\.${c}, add_requests\\.${c}\\)`));
  }
  assert.match(sql, /created_at = LEAST\(add_requests\.created_at, EXCLUDED\.created_at\)/);
  // Lab-authoritative fields still update.
  assert.match(sql, /subject = EXCLUDED\.subject/);
  assert.match(sql, /cite_urls = EXCLUDED\.cite_urls/);
});

const MENTION_CURSOR_KEY = "x_mention.since_id";

test("et_meta lab-owned allowlist is frozen, exact, and excludes Render-owned keys", () => {
  assert.equal(Object.isFrozen(LAB_OWNED_META_KEYS), true);
  assert.equal(Object.isFrozen(LAB_OWNED_META_KEYS.exact), true);
  assert.equal(Object.isFrozen(LAB_OWNED_META_KEYS.prefixes), true);
  assert.deepEqual([...LAB_OWNED_META_KEYS.exact], [
    "keep_up.daily_ingest.last_pass",
    "keep_up.daily_pack.last_pass",
    "keep_up.media_delta.last_success",
    "keep_up.media_delta.last_with_files",
  ]);
  assert.deepEqual([...LAB_OWNED_META_KEYS.prefixes], [
    "keep_up.daily_ingest.",
    "keep_up.daily_pack.",
    "keep_up.media_delta.",
  ]);
  for (const k of LAB_OWNED_META_KEYS.prefixes) assert.ok(k.endsWith("."));
  for (const k of Object.values(HEAL_META_KEYS)) assert.equal(isLabOwnedMetaKey(k), false, k);
  for (const k of [
    KEEP_UP_META_KEYS.dumpRestoreMode,
    KEEP_UP_META_KEYS.dumpRestoreLastSuccess,
    KEEP_UP_META_KEYS.logicalLastVerify,
    KEEP_UP_META_KEYS.logicalLagSeconds,
    KEEP_UP_META_KEYS.logicalStreamStarted,
    "keep_up.logical.last_heal",
    "seed",
    "cutover_prove_20260914",
    "rca_enews_wal_probe_20260916",
    MENTION_CURSOR_KEY,
    "mention.dig.cursor",
    "since_id",
    "keep_up.media_delta",
    "keep_up.media_delta.",
    "keep_upXmedia_delta.last_success",
  ]) {
    assert.equal(isLabOwnedMetaKey(k), false, k);
  }
  assert.equal(isLabOwnedMetaKey("keep_up.media_delta.last_success"), true);
  assert.equal(isLabOwnedMetaKey("keep_up.daily_pack.next_field"), true);
});

test("et_meta: heal and mention cursor keys keep Render's value; allowlisted key takes lab's", () => {
  const healKey = HEAL_META_KEYS.unhealthySince;
  const planned = planGapUpsert(
    {
      et_meta: [
        { k: healKey, v: { at: "2026-10-06T14:00:00Z" } },
        { k: HEAL_META_KEYS.reconnectCount, v: { n: 0 } },
        { k: HEAL_META_KEYS.lastAction, v: { action: "observe" } },
        { k: MENTION_CURSOR_KEY, v: { since_id: "1" } },
        { k: KEEP_UP_META_KEYS.dumpRestoreMode, v: { mode: "disabled" } },
        { k: "keep_up.media_delta.last_success", v: { at: "2026-10-06T14:25:25Z" } },
      ],
    },
    { existingTables: ["et_meta"] },
  );
  // Non-allowlisted keys never reach SQL: skipped and reported by name.
  assert.deepEqual(planned.skipped, [
    {
      table: "et_meta",
      reason: "not_lab_owned",
      count: 5,
      keys: [
        KEEP_UP_META_KEYS.dumpRestoreMode,
        HEAL_META_KEYS.lastAction,
        HEAL_META_KEYS.reconnectCount,
        healKey,
        MENTION_CURSOR_KEY,
      ].sort(),
    },
  ]);
  assert.equal(planned.plans.length, 1);
  const [plan] = planned.plans;
  assert.deepEqual(plan.params, ["keep_up.media_delta.last_success", JSON.stringify({ at: "2026-10-06T14:25:25Z" })]);
  for (const k of [healKey, MENTION_CURSOR_KEY, KEEP_UP_META_KEYS.dumpRestoreMode]) {
    assert.equal(plan.params.includes(k), false, k);
  }
  assert.equal(planned.counts_in.et_meta, 1);
  // Allowlisted key: lab's value wins on conflict.
  assert.match(
    plan.sql,
    /v = CASE WHEN et_meta\.k IN \('keep_up\.daily_ingest\.last_pass', 'keep_up\.daily_pack\.last_pass', 'keep_up\.media_delta\.last_success', 'keep_up\.media_delta\.last_with_files'\) OR left\(et_meta\.k, 21\) = 'keep_up\.daily_ingest\.' OR left\(et_meta\.k, 19\) = 'keep_up\.daily_pack\.' OR left\(et_meta\.k, 20\) = 'keep_up\.media_delta\.' THEN EXCLUDED\.v ELSE et_meta\.v END/,
  );
  assert.doesNotMatch(plan.sql, /LIKE/);
  assert.doesNotMatch(plan.sql, /timestamptz/);
});

test("et_meta: an unknown key is insert-if-missing at most, never an update", () => {
  // Plan level: unknown keys are skipped (so not even inserted).
  const planned = planGapUpsert({ et_meta: [{ k: "brand_new_key", v: { x: 1 } }] }, { existingTables: ["et_meta"] });
  assert.equal(planned.plans.length, 0);
  assert.deepEqual(planned.skipped, [{ table: "et_meta", reason: "not_lab_owned", count: 1, keys: ["brand_new_key"] }]);
  // SQL level (defense in depth): built directly, the conflict branch keeps Render's value.
  const built = buildUpsertSql("et_meta", [{ k: "brand_new_key", v: { x: 1 } }]);
  assert.match(built.sql, /ON CONFLICT \(k\) DO UPDATE SET\s+v = CASE WHEN .* THEN EXCLUDED\.v ELSE et_meta\.v END$/s);
});

test("add_requests and et_meta rows missing NOT NULL fields are dropped, never sent as null", () => {
  const n = normalizePayload({
    et_meta: [{ k: "seed", v: { note: "x" } }, { k: "", v: {} }, { k: "no-v", v: null }, { v: {} }],
    add_requests: [
      ADD_REQUEST_ROW,
      { ...ADD_REQUEST_ROW, id: "ar-2", created_at: null },
      { ...ADD_REQUEST_ROW, id: "ar-3", kind: "" },
      { ...ADD_REQUEST_ROW, id: "" },
    ],
  });
  assert.deepEqual(n.et_meta.map((r) => r.k), ["seed"]);
  assert.deepEqual(n.add_requests.map((r) => r.id), [ADD_REQUEST_ROW.id]);
});

test("add_requests and et_meta gap upsert is insert/update only, never delete", () => {
  const planned = planGapUpsert(
    { add_requests: [ADD_REQUEST_ROW], et_meta: [{ k: "keep_up.daily_pack.last_pass", v: { at: "2026-10-06T13:50:18Z" } }] },
    { existingTables: ["add_requests", "et_meta"] },
  );
  assert.equal(planned.plans.length, 2);
  for (const plan of planned.plans) {
    assert.match(plan.sql, /^INSERT INTO (add_requests|et_meta) /);
    assert.doesNotMatch(plan.sql, /\b(DELETE|TRUNCATE|DROP)\b/i);
    assertSafeSql(plan.sql);
  }
  const absent = planGapUpsert({ et_meta: [{ k: "keep_up.daily_pack.last_pass", v: {} }] }, { existingTables: ["people"] });
  assert.deepEqual(absent.skipped, [{ table: "et_meta", reason: "table_absent", count: 1 }]);
  assert.equal(countProof({ add_requests: 10 }, { add_requests: 9 }, { add_requests: 9 }).add_requests.ok, false);
  assert.equal(countProof({ et_meta: 12 }, { et_meta: 13 }, { et_meta: 10 }).et_meta.ok, true);
});
