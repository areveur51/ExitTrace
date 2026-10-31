import assert from "node:assert/strict";
import { test } from "node:test";
import { keymapFooter } from "../app/lib/html.mjs";
import { personMenuDate } from "../app/lib/menu-date.mjs";
import { projectPerson } from "../app/lib/promote.mjs";
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

const death = {
  id: "ada-example",
  name: "Ada Example",
  category: "death_official",
  event_date: "2025-04-21",
  death_date: "2025-04-21",
  tags: ["official", "black_eye"],
  events: [
    {
      kind: "death_official",
      event_date: "2025-04-21",
      sources: [{ url: "https://apnews.com/example-death", publisher: "Associated Press", date: "2025-04-21" }],
    },
    {
      kind: "black_eye",
      event_date: "2017-09-10",
      comments: "A stored report of a bruised, black left eye.",
      sources: [
        { url: "https://apnews.com/example-eye", publisher: "Associated Press", date: "2017-09-10", snippet: "bruised, black left eye" },
        { url: "https://www.reuters.com/example-eye", publisher: "Reuters", date: "2017-09-10", snippet: "blackened" },
      ],
    },
  ],
};

const other = {
  id: "sam-sample",
  name: "Sam Sample",
  category: "firings",
  event_date: "2017-11-21",
  tags: ["celebrity"],
  events: [{ kind: "firings", event_date: "2017-11-21", sources: [] }],
};

test("normalizeTags accepts black_eye and the chip is a Comms fact tag", () => {
  assert.ok(ATTRIBUTE_TAG_IDS.includes("black_eye"));
  assert.deepEqual(normalizeTags(["official", "black_eye", "nope"]), ["official", "black_eye"]);
  assert.deepEqual(normalizeTags("Black-eye"), ["black_eye"]);
  assert.deepEqual(personTags({ id: "ada-example", tags: ["official", "black_eye"] }), ["official", "black_eye"]);
  const def = attributeTagById("black_eye");
  assert.equal(def.nav, "The Left Eye");
  assert.equal(def.path, "/tags/black-eye");
  assert.equal(def.menu, "comms");
  assert.equal(def.lede, "People with a stored report of a black eye.");
  assert.equal(attributeTagByPath("/tags/black-eye")?.id, "black_eye");
  const html = keymapFooter("/tags/black-eye");
  assert.match(html, /class="keychip keymap-comm" href="\/tags\/black-eye" aria-current="page">The Left Eye</);
  assert.doesNotMatch(html, /class="keychip keymap-tag" href="\/tags\/black-eye"/);
  assert.doesNotMatch(html, /href="\/tags\/black-eye"[^>]*data-key=/);
});

test("a black eye event keeps the stored category and uses its own menu date", () => {
  const projected = projectPerson(death);
  assert.equal(projected.category, "death_official");
  assert.equal(projected.event_date, "2025-04-21");
  assert.equal(projected.death_date, "2025-04-21");
  assert.ok(projected.tags.includes("black_eye"));
  assert.ok(projected.tags.includes("official"));
  assert.equal(personMenuDate(death, { tag: "black_eye" }), "2017-09-10");
  assert.equal(personMenuDate(other, { tag: "black_eye" }), "");

  const later = projectPerson({
    ...other,
    tags: ["celebrity", "black_eye"],
    events: [
      { kind: "firings", event_date: "2017-11-21", sources: [] },
      { kind: "black_eye", event_date: "2026-01-01", comments: "A stored report of a black eye.", sources: [] },
    ],
  });
  assert.equal(later.category, "firings");
  assert.equal(later.event_date, "2017-11-21");
});

test("/tags/black-eye lists only people who store the tag", async () => {
  setMemory({ people: [death, other] });
  const page = await requestPage("/tags/black-eye");
  assert.equal(page.status, 200);
  assert.match(page.body, /People with a stored report of a black eye\./);
  assert.match(page.body, /href="\/people\/ada-example"/);
  assert.doesNotMatch(page.body, /href="\/people\/sam-sample"/);
  assert.match(page.body, /class="keychip keymap-comm" href="\/tags\/black-eye" aria-current="page">The Left Eye</);
  const detail = await requestPage("/people/ada-example");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /data-kind="black_eye"/);
  assert.match(detail.body, /The Left Eye/);
  assert.match(detail.body, /datetime="2025-04-21"/);
  assert.match(detail.body, /datetime="2017-09-10"/);
  assert.match(detail.body, /href="\/tags\/black-eye"/);
});
