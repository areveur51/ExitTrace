import assert from "node:assert/strict";
import { test } from "node:test";
import { keymapFooter, personDetail } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { getPerson, insertPerson, savePerson, setMemory } from "../app/lib/store.mjs";
import { categoryById } from "../app/lib/categories.mjs";
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
  id: "ada-folder",
  name: "Ada Folder",
  category: "notable",
  event_date: "2026-01-02",
  tags: ["red_folder"],
  events: [],
};
const untagged = {
  id: "bev-plain",
  name: "Bev Plain",
  category: "notable",
  event_date: "2026-01-03",
  tags: ["official"],
  events: [],
};

test("normalizeTags accepts red_folder as a fact tag", () => {
  assert.ok(ATTRIBUTE_TAG_IDS.includes("red_folder"));
  assert.deepEqual(normalizeTags(["red_folder"]), ["red_folder"]);
  assert.deepEqual(normalizeTags("Red-folder"), ["red_folder"]);
  assert.deepEqual(
    normalizeTags(["official", "red_folder", "nope"]),
    ["official", "red_folder"],
  );
  assert.deepEqual(personTags({ id: "ada-folder", tags: ["red_folder"] }), ["red_folder"]);
  const def = attributeTagById("red_folder");
  assert.equal(def.nav, "Red folder");
  assert.equal(def.path, "/tags/red-folder");
  assert.equal(attributeTagByPath("/tags/red-folder")?.id, "red_folder");
  assert.equal(attributeTagByPath("/red-folder-comms"), null);
  assert.doesNotMatch(def.lede, /\n/);
  assert.equal(def.lede, "People stored with a red folder, and stored red-folder posts.");
  assert.doesNotMatch(def.lede, /not a|identity filter|allegation/i);
});

test("the tag menu links to /tags/red-folder", () => {
  const facts = keymapFooter("/tags/red-folder");
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/red-folder" aria-current="page"/);
  assert.match(facts, />Red folder</);
});

test("a stored red_folder tag is a chip on the person card", () => {
  const html = personDetail(tagged);
  assert.match(html, /href="\/tags\/red-folder"/);
  assert.match(html, />Red folder</);
});

test("/tags/red-folder renders and lists only tagged people", async () => {
  setMemory({ people: [tagged, untagged] });
  const page = await requestPage("/tags/red-folder");
  assert.equal(page.status, 200);
  assert.match(page.body, /Red folder/);
  assert.match(page.body, /People stored with a red folder, and stored red-folder posts\./);
  assert.match(page.body, /href="\/people\/ada-folder"/);
  assert.doesNotMatch(page.body, /href="\/people\/bev-plain"/);
  assert.match(page.body, /href="\/tags\/red-folder" aria-current="page"/);

  setMemory({ people: [untagged] });
  const empty = await requestPage("/tags/red-folder");
  assert.equal(empty.status, 200);
  assert.doesNotMatch(empty.body, /href="\/people\/bev-plain"/);
});

test("red_folder round-trips on insert and save", async () => {
  setMemory({ people: [] });
  await insertPerson({ ...untagged });
  const before = await getPerson("bev-plain");
  assert.deepEqual(before.tags, ["official"]);

  await savePerson({ ...before, tags: ["official", "red_folder"] });
  const added = await getPerson("bev-plain");
  assert.deepEqual(added.tags, ["official", "red_folder"]);

  await savePerson({ ...added });
  const again = await getPerson("bev-plain");
  assert.deepEqual(again.tags, ["official", "red_folder"]);

  await savePerson({ ...again, tags: ["official"] });
  const removed = await getPerson("bev-plain");
  assert.deepEqual(removed.tags, ["official"]);
});

// The person tag id and the post catalog stay different records. Both menus show both.
test("red folder menus list tagged people and stored posts", async () => {
  assert.equal(attributeTagById("red_folder").path, "/tags/red-folder");
  assert.equal(categoryById("red_folder"), null);
  assert.equal(categoryById("red_folder_comms").path, "/red-folder-comms");
  assert.equal(categoryById("red_folder_comms").kind, "red_folder");

  const post = {
    id: "example-folder-post",
    posted_at: "2026-01-04",
    handle: "@ExampleDesk",
    account_name: "Example Desk",
    text: "Official red folder note.",
    source_url: "https://example.com/red-folder-note",
  };
  setMemory({ people: [tagged, untagged], red_folder_comms: [post] });

  for (const path of ["/tags/red-folder", "/red-folder-comms"]) {
    const page = await requestPage(path);
    assert.equal(page.status, 200);
    assert.match(page.body, /href="\/people\/ada-folder"/);
    assert.match(page.body, /href="\/red-folder-comms\/example-folder-post"/);
    assert.doesNotMatch(page.body, /href="\/people\/bev-plain"/);
    assert.match(page.body, /People stored with a red folder, and stored red-folder posts\./);
  }
});
