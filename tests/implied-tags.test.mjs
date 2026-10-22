import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpsertSql, pickRow } from "../app/lib/gap-upsert.mjs";
import { projectPerson } from "../app/lib/promote.mjs";
import { getPerson, insertPerson, listPeople, savePerson, setMemory, setTestPool } from "../app/lib/store.mjs";
import {
  IMPLIED_TAGS,
  matchesTags,
  normalizeTags,
  personTags,
  withImpliedTags,
} from "../app/lib/tags.mjs";

const REVOKED = "clearance_revoked";
const INTEL = "former_intel_agency_personnel";

function clearanceCard(id, tags) {
  return {
    id,
    name: id,
    category: "clearance",
    event_date: "2025-01-20",
    events: [{ kind: "clearance", event_date: "2025-01-20", sources: [] }],
    sources: [],
    tags,
    career: [],
    nicknames: [],
    clearances: [],
  };
}

test("a revoked clearance implies the Former intel tag", () => {
  assert.deepEqual(IMPLIED_TAGS[REVOKED], [INTEL]);
  assert.deepEqual(withImpliedTags([REVOKED]), [REVOKED, INTEL]);
  assert.deepEqual(withImpliedTags(["official", REVOKED, "non_civilian"]), ["official", REVOKED, "non_civilian", INTEL]);
  assert.deepEqual(withImpliedTags(["clearance-revoked"]), ["clearance-revoked", INTEL]);
});

test("the implied tag is add-only and idempotent", () => {
  assert.deepEqual(withImpliedTags([REVOKED, INTEL]), [REVOKED, INTEL]);
  assert.deepEqual(withImpliedTags([INTEL, REVOKED]), [INTEL, REVOKED]);
  assert.deepEqual(withImpliedTags(withImpliedTags([REVOKED])), [REVOKED, INTEL]);
  assert.deepEqual(withImpliedTags(["legacy_value", REVOKED]), ["legacy_value", REVOKED, INTEL]);
  assert.deepEqual(withImpliedTags(["official"]), ["official"]);
  assert.deepEqual(withImpliedTags([INTEL]), [INTEL]);
  assert.deepEqual(withImpliedTags([]), []);
  assert.deepEqual(withImpliedTags(null), []);
  const input = [REVOKED];
  withImpliedTags(input);
  assert.deepEqual(input, [REVOKED]);
});

test("Former intel does not imply a revoked clearance", () => {
  assert.deepEqual(personTags({ tags: [INTEL] }), [INTEL]);
  assert.equal(matchesTags({ tags: [INTEL] }, [REVOKED]), false);
});

test("person tags carry the implication; filters do not widen", () => {
  assert.deepEqual(personTags({ category: "clearance", tags: [REVOKED] }), [REVOKED, INTEL]);
  assert.deepEqual(projectPerson(clearanceCard("x", [REVOKED])).tags, [REVOKED, INTEL]);
  assert.equal(matchesTags({ tags: [REVOKED] }, [INTEL]), true);
  assert.deepEqual(normalizeTags([REVOKED]), [REVOKED]);
});

test("insert and update store the implied tag", async () => {
  setMemory({ people: [], operations: [], source_posts: [] });
  const inserted = await insertPerson(clearanceCard("jane-roe", [REVOKED]));
  assert.deepEqual(inserted.tags, [REVOKED, INTEL]);
  assert.deepEqual((await getPerson("jane-roe")).tags, [REVOKED, INTEL]);

  await insertPerson(clearanceCard("john-roe", ["official"]));
  assert.deepEqual((await getPerson("john-roe")).tags, ["official"]);
  const before = await getPerson("john-roe");
  await savePerson({ ...before, tags: ["official", REVOKED] });
  assert.deepEqual((await getPerson("john-roe")).tags, ["official", REVOKED, INTEL]);

  const listed = await listPeople({ tags: [INTEL] });
  assert.deepEqual(listed.map((r) => r.id).sort(), ["jane-roe", "john-roe"]);
  setMemory({ people: [], operations: [], source_posts: [] });
});

test("public gap-upsert carries the implied tag on people rows", () => {
  assert.equal(pickRow("people", { id: "a", tags: [REVOKED] }).tags, JSON.stringify([REVOKED, INTEL]));
  assert.equal(pickRow("people", { id: "a", tags: JSON.stringify(["official", REVOKED]) }).tags, JSON.stringify(["official", REVOKED, INTEL]));
  assert.equal(pickRow("people", { id: "a", tags: [REVOKED, INTEL] }).tags, JSON.stringify([REVOKED, INTEL]));
  assert.equal(pickRow("people", { id: "a", tags: ["official"] }).tags, JSON.stringify(["official"]));
  assert.equal(pickRow("people", { id: "a", tags: [] }).tags, "[]");
  assert.equal(pickRow("people", { id: "a" }).tags, "[]");
  assert.equal(pickRow("operations", { id: "op", tags: [REVOKED] }).tags, JSON.stringify([REVOKED]));
  const { sql, params } = buildUpsertSql("people", [{ id: "a", name: "A", category: "clearance", tags: [REVOKED] }]);
  assert.match(sql, /\btags = EXCLUDED\.tags\b/);
  assert.ok(params.includes(JSON.stringify([REVOKED, INTEL])));
});

const PEOPLE_COLS = [
  "id", "category", "name", "role", "event_date", "death_date", "birth_date", "country_of_origin",
  "photo", "photo_credit", "screenshot", "screenshot_credit", "net_worth_usd", "net_worth_note",
  "net_worth_source", "sources", "summary", "events", "tags", "career", "nicknames", "clearances",
];
const JSON_COLS = new Set(["sources", "events", "tags", "career", "nicknames", "clearances"]);

/**
 * Stub Postgres pool. people rows keep exactly the bound column values, so the
 * tag-list query is answered from stored people.tags only (peopleTagWhere),
 * never from personTags on read.
 */
function stubPool() {
  const people = new Map();
  const rowFrom = (params) => {
    const row = {};
    PEOPLE_COLS.forEach((col, i) => {
      row[col] = JSON_COLS.has(col) ? JSON.parse(params[i]) : params[i];
    });
    return row;
  };
  const query = async (sql, params = []) => {
    const text = String(sql).trim();
    if (/^INSERT INTO people \(/.test(text) || /^UPDATE people SET\s+category = \$2/.test(text)) {
      people.set(params[0], rowFrom(params));
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT \* FROM people WHERE id = \$1$/.test(text)) {
      return { rows: people.has(params[0]) ? [structuredClone(people.get(params[0]))] : [] };
    }
    if (/^SELECT \* FROM people WHERE/.test(text)) {
      assert.match(text, /jsonb_array_elements_text\(COALESCE\(people\.tags, '\[\]'::jsonb\)\) t\s+WHERE t = ANY\(\$1::text\[\]\)/);
      assert.doesNotMatch(text, /people\.category = ANY/);
      const want = params[0];
      const rows = [...people.values()].filter((row) => row.tags.some((t) => want.includes(t)));
      return { rows: rows.map((row) => structuredClone(row)) };
    }
    return { rows: [], rowCount: 0 };
  };
  return { people, query, connect: async () => ({ query, release() {} }) };
}

test("the SQL tag list returns a person saved with only clearance_revoked", async () => {
  const stub = stubPool();
  setTestPool(stub);
  try {
    await insertPerson(clearanceCard("jane-roe", [REVOKED]));
    assert.deepEqual(stub.people.get("jane-roe").tags, [REVOKED, INTEL]);

    await insertPerson(clearanceCard("john-roe", ["official"]));
    assert.deepEqual(stub.people.get("john-roe").tags, ["official"]);
    await savePerson({ ...(await getPerson("john-roe")), tags: ["official", REVOKED] });
    assert.deepEqual(stub.people.get("john-roe").tags, ["official", REVOKED, INTEL]);

    // Control: a row written outside the store without the implied tag stays off the list,
    // which proves the list reads stored people.tags.
    stub.people.set("raw-row", { ...clearanceCard("raw-row", [REVOKED]) });

    const intel = await listPeople({ tags: [INTEL] });
    assert.deepEqual(intel.map((r) => r.id).sort(), ["jane-roe", "john-roe"]);
    const revoked = await listPeople({ tags: [REVOKED] });
    assert.deepEqual(revoked.map((r) => r.id).sort(), ["jane-roe", "john-roe", "raw-row"]);
  } finally {
    setTestPool(null);
  }
});

test("gap-upsert tags fall back like clearanceJson", () => {
  assert.equal(pickRow("people", { id: "a", tags: "{not json" }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", tags: "" }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", tags: JSON.stringify({ a: 1 }) }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", tags: { a: 1 } }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", clearances: "{not json" }).clearances, "[]");
});
