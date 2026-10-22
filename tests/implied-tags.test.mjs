import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpsertSql, pickRow } from "../app/lib/gap-upsert.mjs";
import { projectPerson } from "../app/lib/promote.mjs";
import { getPerson, insertPerson, listPeople, savePerson, setMemory } from "../app/lib/store.mjs";
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
