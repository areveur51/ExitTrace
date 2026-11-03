import assert from "node:assert/strict";
import { test } from "node:test";
import { keymapFooter, personDetail } from "../app/lib/html.mjs";
import { personMenuDate } from "../app/lib/menu-date.mjs";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";
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

const tagged = {
  id: "pat-example",
  name: "Pat Example",
  category: "notable",
  event_date: "2026-06-26",
  tags: ["official", "felon"],
  events: [],
  sources: [],
};
const untagged = {
  id: "sam-sample",
  name: "Sam Sample",
  category: "indictment_civilian",
  event_date: "2026-01-03",
  tags: ["civilian"],
  events: [
    {
      kind: "indictment_civilian",
      event_date: "2026-01-03",
      comments: "Charged by indictment. No plea and no conviction are stored.",
      sources: [],
    },
  ],
  sources: [],
};

test("normalizeTags accepts felon as a fact tag", () => {
  assert.ok(ATTRIBUTE_TAG_IDS.includes("felon"));
  assert.deepEqual(normalizeTags(["felon"]), ["felon"]);
  assert.deepEqual(normalizeTags("Felon"), ["felon"]);
  assert.deepEqual(normalizeTags(" felons "), []);
  assert.deepEqual(normalizeTags(["official", "felon", "nope"]), ["official", "felon"]);
  assert.deepEqual(personTags({ id: "pat-example", tags: ["felon"] }), ["felon"]);
  const def = attributeTagById("felon");
  assert.equal(def.nav, "Felons");
  assert.equal(def.path, "/tags/felons");
  assert.equal(attributeTagByPath("/tags/felons")?.id, "felon");
  assert.equal(
    def.lede,
    "People with a stored felony conviction or a stored guilty plea to a felony.",
  );
  assert.equal(personMenuDate(tagged, { tag: "felon" }), "");
});

test("the tag menu links to /tags/felons", () => {
  const facts = keymapFooter("/tags/felons");
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/felons" aria-current="page"/);
  assert.match(facts, />Felons</);
});

test("/tags/felons renders and lists only tagged people", async () => {
  setMemory({ people: [tagged, untagged] });
  const page = await requestPage("/tags/felons");
  assert.equal(page.status, 200);
  assert.match(page.body, /Felons/);
  assert.match(
    page.body,
    /People with a stored felony conviction or a stored guilty plea to a felony\./,
  );
  assert.match(page.body, /href="\/people\/pat-example"/);
  assert.doesNotMatch(page.body, /href="\/people\/sam-sample"/);
  assert.match(page.body, /href="\/tags\/felons" aria-current="page"/);

  const detail = personDetail(tagged);
  assert.match(detail, /href="\/tags\/felons">Felons</);
  const charged = personDetail(untagged);
  assert.doesNotMatch(charged, /href="\/tags\/felons"/);
});
