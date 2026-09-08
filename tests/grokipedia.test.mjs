import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GROKIPEDIA_KEY,
  GROKIPEDIA_PATH,
  findGrokipediaEntry,
  grokipediaEntry,
  grokipediaHref,
  grokipediaIndex,
  grokipediaSlug,
  grokipediaText,
} from "../app/lib/grokipedia.mjs";
import { grokipediaEntryBody, grokipediaIndexBody, keymapFooter } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { loadSeedFile, setMemory } from "../app/lib/store.mjs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("grokipedia module maps stored summaries and does not invent text", () => {
  assert.equal(GROKIPEDIA_PATH, "/grokipedia");
  assert.equal(GROKIPEDIA_KEY, "k");
  assert.equal(grokipediaSlug({ id: "james-comey" }), "james-comey");
  assert.equal(grokipediaHref({ id: "james-comey" }), "/grokipedia/james-comey");
  assert.equal(grokipediaText({ summary: "  Stored.  " }), "Stored.");
  assert.equal(grokipediaText({}), "");
  assert.equal(grokipediaEntry(null), null);
  const entry = grokipediaEntry({
    id: "james-comey",
    name: "James Comey",
    summary: "Removed as FBI director by President Trump.",
  });
  assert.equal(entry.href, "/grokipedia/james-comey");
  assert.equal(entry.personHref, "/people/james-comey");
  assert.match(entry.text, /Removed as FBI director/);
  const listed = grokipediaIndex([
    { id: "b-person", name: "Beta", summary: "B" },
    { id: "a-person", name: "Alpha", summary: "A" },
  ]);
  assert.deepEqual(
    listed.map((e) => e.name),
    ["Alpha", "Beta"],
  );
  assert.equal(findGrokipediaEntry(listed, "missing"), null);
  assert.equal(findGrokipediaEntry(listed, "a-person")?.name, "Alpha");
});

test("grokipedia catalog route lists local entries and opens one card", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const index = await requestPage("/grokipedia");
  assert.equal(index.status, 200);
  assert.match(index.body, /grokipedia-list/);
  assert.match(index.body, /href="\/grokipedia\/andrew-cuomo"/);
  assert.match(index.body, /data-key="k"/);
  assert.match(index.body, /aria-current="page">Grokipedia</);
  assert.doesNotMatch(index.body, /Synopsis/);

  const entry = await requestPage("/grokipedia/james-comey");
  assert.equal(entry.status, 200);
  assert.match(entry.body, /grokipedia-detail/);
  assert.match(entry.body, /Removed as FBI director by President Trump/);
  assert.match(entry.body, /href="\/people\/james-comey"/);
  assert.doesNotMatch(entry.body, /class="event-timeline"/);

  const missing = await requestPage("/grokipedia/not-a-person");
  assert.equal(missing.status, 404);
});

test("keymap and grokipedia HTML stay local and one-card", () => {
  const footer = keymapFooter("/");
  assert.match(footer, /href="\/grokipedia"/);
  assert.match(footer, /data-key="k"/);
  assert.match(footer, /Grokipedia/);
  const index = grokipediaIndexBody([
    { href: "/grokipedia/casey-vale", name: "Casey Vale", text: "Held." },
  ]);
  assert.match(index, /href="\/grokipedia\/casey-vale"/);
  assert.match(index, /Held\./);
  const page = grokipediaEntryBody({
    name: "Casey Vale",
    text: "Held.",
    personHref: "/people/casey-vale",
  });
  assert.match(page, /grokipedia-detail/);
  assert.equal((page.match(/class="box-pane/g) || []).length, 1);
});
