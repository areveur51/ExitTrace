import assert from "node:assert/strict";
import { test } from "node:test";
import { eventFromLead } from "../app/lib/event-attrs.mjs";
import { keymapFooter } from "../app/lib/html.mjs";
import { incomingPersonEvent, projectPerson } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { getPerson, setMemory } from "../app/lib/store.mjs";
import {
  ATTRIBUTE_TAG_IDS,
  attributeTagById,
  attributeTagByPath,
  normalizeTag,
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
      headers: {},
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers || {};
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          headers: this.headers || {},
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("federal_investigation is not a fact tag and cannot be emitted", () => {
  assert.equal(ATTRIBUTE_TAG_IDS.includes("federal_investigation"), false);
  assert.equal(ATTRIBUTE_TAG_IDS.includes("fraud"), true);
  assert.equal(normalizeTag("federal_investigation"), null);
  assert.equal(normalizeTag("federal-investigation"), null);
  assert.deepEqual(normalizeTags(["official", "federal_investigation", "fraud"]), [
    "official",
    "fraud",
  ]);
  assert.deepEqual(
    personTags({
      id: "fictional-pat-example",
      name: "Pat Example",
      category: "notable",
      tags: ["fraud", "federal_investigation"],
      events: [],
    }),
    ["fraud"],
  );
  assert.equal(attributeTagById("federal_investigation"), null);
  assert.equal(attributeTagByPath("/tags/federal-investigation"), null);

  const projected = projectPerson({
    id: "fictional-pat-example",
    name: "Pat Example",
    category: "notable",
    event_date: "2026-01-02",
    tags: ["fraud", "federal_investigation"],
    events: [],
  });
  assert.deepEqual(projected.tags, ["fraud"]);
  assert.equal(projected.tags.includes("federal_investigation"), false);

  assert.equal(
    eventFromLead({
      reason: "Dead",
      event_date: "2026-04-04",
      tags: ["federal_investigation", "federal-investigation"],
    }),
    null,
  );
  const dead = eventFromLead({
    reason: "Dead",
    event_date: "2026-04-04",
    tags: ["official", "federal_investigation", "fraud"],
    position: "Clerk",
    organization: "Example Bureau",
    comments: "Example record.",
  });
  assert.equal(dead.kind, "death_official");
  assert.equal(JSON.stringify(dead).includes("federal_investigation"), false);
  assert.equal(JSON.stringify(dead).includes("federal-investigation"), false);

  const added = incomingPersonEvent(
    {
      category: "firings",
      event_date: "2026-05-05",
      tags: ["official", "federal_investigation", "fraud"],
      position: "Clerk",
      organization: "Example Bureau",
      comments: "Left the example bureau.",
    },
    [],
  );
  assert.equal(added.kind, "firings");
  assert.equal(JSON.stringify(added).includes("federal_investigation"), false);
  assert.equal(JSON.stringify(added).includes("federal-investigation"), false);
});

test("the tag menu keeps fraud and has no federal investigation link", () => {
  const facts = keymapFooter("/tags/fraud");
  assert.equal(facts.includes("/tags/federal-investigation"), false);
  assert.equal(facts.includes("federal_investigation"), false);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/fraud"/);
});

test("the retired tag page redirects and the tags index and fraud list stay up", async () => {
  process.env.DATABASE_URL = "";
  setMemory({
    people: [
      {
        id: "fictional-pat-example",
        name: "Pat Example",
        category: "notable",
        event_date: "2026-01-02",
        tags: ["fraud", "federal_investigation"],
        events: [],
      },
    ],
  });
  const stored = await getPerson("fictional-pat-example");
  assert.deepEqual(stored.tags, ["fraud"]);

  const bare = await requestPage("/tags/federal-investigation");
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.Location, "/tags");

  const paged = await requestPage("/tags/federal-investigation?page=2");
  assert.equal(paged.status, 301);
  assert.equal(paged.headers.Location, "/tags");

  const index = await requestPage("/tags");
  assert.equal(index.status, 200);
  assert.match(index.body, /href="\/tags\/fraud"/);
  assert.equal(index.body.includes("/tags/federal-investigation"), false);
  assert.equal(index.body.includes("federal_investigation"), false);
  for (const id of ATTRIBUTE_TAG_IDS) {
    const tag = attributeTagById(id);
    assert.match(index.body, new RegExp(`href="${tag.path.replaceAll("/", "\\/")}"`));
  }

  const fraud = await requestPage("/tags/fraud");
  assert.equal(fraud.status, 200);
  assert.match(fraud.body, /href="\/people\/fictional-pat-example"/);
  assert.match(fraud.body, /href="\/tags\/fraud"/);
  assert.equal(fraud.body.includes("/tags/federal-investigation"), false);
});
