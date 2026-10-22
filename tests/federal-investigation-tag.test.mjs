import assert from "node:assert/strict";
import { test } from "node:test";
import { keymapFooter } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { getPerson, insertPerson, savePerson, setMemory } from "../app/lib/store.mjs";
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
  tags: ["official", "federal_investigation"],
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

test("normalizeTags accepts federal_investigation as a fact tag", () => {
  assert.ok(ATTRIBUTE_TAG_IDS.includes("federal_investigation"));
  assert.deepEqual(normalizeTags(["federal_investigation"]), ["federal_investigation"]);
  assert.deepEqual(normalizeTags("federal-investigation"), ["federal_investigation"]);
  assert.deepEqual(
    normalizeTags(["official", "federal_investigation", "nope"]),
    ["official", "federal_investigation"],
  );
  assert.deepEqual(
    personTags({ id: "pat-example", tags: ["federal_investigation"] }),
    ["federal_investigation"],
  );
  const def = attributeTagById("federal_investigation");
  assert.equal(def.nav, "Federal investigation");
  assert.equal(def.path, "/tags/federal-investigation");
  assert.equal(attributeTagByPath("/tags/federal-investigation")?.id, "federal_investigation");
  assert.doesNotMatch(def.lede, /\n/);
  assert.match(def.lede, /not a charge or a finding of wrongdoing/);
});

test("the tag menu links to /tags/federal-investigation", () => {
  const facts = keymapFooter("/tags/federal-investigation");
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/federal-investigation" aria-current="page"/);
  assert.match(facts, />Federal investigation</);
});

test("/tags/federal-investigation renders and lists only tagged people", async () => {
  setMemory({ people: [tagged, untagged] });
  const page = await requestPage("/tags/federal-investigation");
  assert.equal(page.status, 200);
  assert.match(page.body, /Federal investigation/);
  assert.match(page.body, /stored report of a federal investigation/);
  assert.match(page.body, /href="\/people\/pat-example"/);
  assert.doesNotMatch(page.body, /href="\/people\/sam-sample"/);
  assert.match(page.body, /href="\/tags\/federal-investigation" aria-current="page"/);
  assert.doesNotMatch(page.body, /id="fact-tag-filter"/);

  setMemory({ people: [untagged] });
  const empty = await requestPage("/tags/federal-investigation");
  assert.equal(empty.status, 200);
  assert.doesNotMatch(empty.body, /href="\/people\/sam-sample"/);
});

test("federal_investigation round-trips on insert and save", async () => {
  setMemory({ people: [] });
  await insertPerson({ ...untagged });
  const before = await getPerson("sam-sample");
  assert.deepEqual(before.tags, ["official"]);

  await savePerson({ ...before, tags: ["official", "federal_investigation"] });
  const added = await getPerson("sam-sample");
  assert.deepEqual(added.tags, ["official", "federal_investigation"]);

  await savePerson({ ...added });
  const again = await getPerson("sam-sample");
  assert.deepEqual(again.tags, ["official", "federal_investigation"]);

  await savePerson({ ...again, tags: ["official"] });
  const removed = await getPerson("sam-sample");
  assert.deepEqual(removed.tags, ["official"]);
});
