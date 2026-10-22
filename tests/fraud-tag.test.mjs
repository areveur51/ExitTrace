import assert from "node:assert/strict";
import { test } from "node:test";
import { keymapFooter } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { getPerson, insertPerson, savePerson, setMemory } from "../app/lib/store.mjs";
import { categoryById } from "../app/lib/categories.mjs";
import { normalizeOperationTags } from "../app/lib/operation.mjs";
import {
  ATTRIBUTE_TAG_IDS,
  attributeTagById,
  attributeTagByPath,
  normalizeTags,
  personTags,
} from "../app/lib/tags.mjs";

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

// Fictional people only. No real person gets this tag in a test.
const tagged = {
  id: "pat-example",
  name: "Pat Example",
  category: "notable",
  event_date: "2026-01-02",
  tags: ["official", "fraud"],
  events: [],
};
const untagged = {
  id: "sam-sample",
  name: "Sam Sample",
  category: "notable",
  event_date: "2026-01-03",
  tags: ["official"],
  events: [],
};

test("normalizeTags accepts fraud as a fact tag", () => {
  assert.ok(ATTRIBUTE_TAG_IDS.includes("fraud"));
  assert.deepEqual(normalizeTags(["fraud"]), ["fraud"]);
  assert.deepEqual(normalizeTags("Fraud"), ["fraud"]);
  assert.deepEqual(normalizeTags(" fraud "), ["fraud"]);
  assert.deepEqual(
    normalizeTags(["official", "fraud", "nope"]),
    ["official", "fraud"],
  );
  assert.deepEqual(
    personTags({ id: "pat-example", tags: ["fraud"] }),
    ["fraud"],
  );
  const def = attributeTagById("fraud");
  assert.equal(def.nav, "Fraud");
  assert.equal(def.path, "/tags/fraud");
  assert.equal(attributeTagByPath("/tags/fraud")?.id, "fraud");
  assert.doesNotMatch(def.lede, /\n/);
  assert.equal(def.lede, "People with a stored record of a fraud charge, plea, conviction, indictment or official fraud finding.");
});

test("the tag menu links to /tags/fraud", () => {
  const facts = keymapFooter("/tags/fraud");
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/fraud" aria-current="page"/);
  assert.match(facts, />Fraud</);
});

test("/tags/fraud renders and lists only tagged people", async () => {
  setMemory({ people: [tagged, untagged] });
  const page = await requestPage("/tags/fraud");
  assert.equal(page.status, 200);
  assert.match(page.body, /Fraud/);
  assert.match(page.body, /People with a stored record of a fraud charge, plea, conviction, indictment or official fraud finding\./);
  assert.doesNotMatch(page.body, /not a charge/);
  assert.match(page.body, /href="\/people\/pat-example"/);
  assert.doesNotMatch(page.body, /href="\/people\/sam-sample"/);
  assert.match(page.body, /href="\/tags\/fraud" aria-current="page"/);
  assert.doesNotMatch(page.body, /id="fact-tag-filter"/);

  setMemory({ people: [untagged] });
  const empty = await requestPage("/tags/fraud");
  assert.equal(empty.status, 200);
  assert.doesNotMatch(empty.body, /href="\/people\/sam-sample"/);
});

test("fraud round-trips on insert and save", async () => {
  setMemory({ people: [] });
  await insertPerson({ ...untagged });
  const before = await getPerson("sam-sample");
  assert.deepEqual(before.tags, ["official"]);

  await savePerson({ ...before, tags: ["official", "fraud"] });
  const added = await getPerson("sam-sample");
  assert.deepEqual(added.tags, ["official", "fraud"]);

  await savePerson({ ...added });
  const again = await getPerson("sam-sample");
  assert.deepEqual(again.tags, ["official", "fraud"]);

  await savePerson({ ...again, tags: ["official"] });
  const removed = await getPerson("sam-sample");
  assert.deepEqual(removed.tags, ["official"]);
});

// The Operations category `fraud` (/group-operations/fraud) is a separate namespace:
// operations.tags vs people.tags, normalizeOperationTags vs normalizeTags,
// categoryById vs attributeTagById. Neither list leaks into the other.
test("the fraud fact tag and the fraud Operations category stay separate", async () => {
  assert.equal(attributeTagById("fraud").path, "/tags/fraud");
  assert.equal(categoryById("fraud").path, "/group-operations/fraud");
  assert.equal(categoryById("fraud").kind, "operation");
  assert.equal(attributeTagByPath("/group-operations/fraud"), null);
  assert.deepEqual(normalizeOperationTags(["fraud"]), ["fraud"]);
  assert.deepEqual(normalizeOperationTags(["not_a_signed_operation"]), []);

  const op = {
    id: "example-fraud-op",
    name: "Example Fraud Sweep",
    event_date: "2026-01-04",
    tags: ["fraud"],
    sources: [],
  };
  setMemory({ people: [tagged, untagged], operations: [op] });

  const facts = await requestPage("/tags/fraud");
  assert.equal(facts.status, 200);
  assert.match(facts.body, /href="\/people\/pat-example"/);
  assert.doesNotMatch(facts.body, /href="\/operations\/example-fraud-op"/);

  const ops = await requestPage("/group-operations/fraud");
  assert.equal(ops.status, 200);
  assert.match(ops.body, /href="\/operations\/example-fraud-op"/);
  assert.doesNotMatch(ops.body, /href="\/people\/pat-example"/);
  assert.doesNotMatch(ops.body, /People with a stored record of a fraud charge/);

  const add = await requestPage("/add");
  assert.equal(add.status, 200);
  assert.doesNotMatch(add.body, /value="fraud"/);
});
