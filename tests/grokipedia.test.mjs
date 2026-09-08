import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GROKIPEDIA_CITE_ORIGIN,
  GROKIPEDIA_PATH,
  fillEmptyFromGrokipedia,
  findGrokipediaEntry,
  grokipediaCite,
  grokipediaEntry,
  grokipediaEntryRedirect,
  grokipediaIndex,
  grokipediaIndexRedirect,
  grokipediaPageUrl,
  grokipediaSlug,
  grokipediaText,
  newsCitesCoverStory,
} from "../app/lib/grokipedia.mjs";
import { grokipediaBlock, keymapFooter, personDetail } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { loadSeedFile, setMemory } from "../app/lib/store.mjs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const headers = {};
    const res = {
      headersSent: false,
      statusCode: 0,
      headers,
      writeHead(status, hdrs = {}) {
        this.statusCode = status;
        Object.assign(headers, hdrs);
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          headers,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("grokipedia helpers stay fill-empty and do not invent prose fields", () => {
  assert.equal(GROKIPEDIA_PATH, "/grokipedia");
  assert.equal(GROKIPEDIA_CITE_ORIGIN, "https://grokipedia.com");
  assert.equal(grokipediaSlug({ id: "james-comey" }), "james-comey");
  assert.equal(
    grokipediaPageUrl({ name: "James Comey" }),
    "https://grokipedia.com/page/James_Comey",
  );
  assert.equal(grokipediaText({ summary: "  Stored.  " }), "Stored.");
  assert.equal(grokipediaText({}), "");
  assert.equal(grokipediaEntry(null), null);
  assert.equal(grokipediaIndexRedirect(), "/search");
  assert.equal(
    grokipediaEntryRedirect({ id: "james-comey" }, "james-comey"),
    "/people/james-comey",
  );
  assert.equal(grokipediaEntryRedirect(null, "missing-name"), "/search?q=missing%20name");

  const empty = fillEmptyFromGrokipedia({
    name: "Casey Vale",
    summary: "Born in Ohio in 1985. Later an anchor.",
  });
  assert.equal(empty.row.birth_date, undefined);
  assert.deepEqual(empty.filled, []);
  assert.equal(newsCitesCoverStory({ sources: [{ url: "https://www.example.com/n" }] }), true);
  assert.equal(newsCitesCoverStory({ events: [{ sources: [] }] }), false);

  const filled = fillEmptyFromGrokipedia({
    name: "Casey Vale",
    birth_date: "",
    country_of_origin: "",
    events: [{ kind: "arrests", position: "", organization: "Example Desk" }],
    grokipedia: {
      birth_date: "1985-03-12",
      country_of_origin: "United States",
      position: "Anchor, CNN",
      organization: "Should not overwrite",
    },
  });
  assert.equal(filled.row.birth_date, "1985-03-12");
  assert.equal(filled.row.country_of_origin, "United States");
  assert.equal(filled.row.events[0].position, "Anchor, CNN");
  assert.equal(filled.row.events[0].organization, "Example Desk");
  assert.ok(filled.filled.includes("birth_date"));
  assert.ok(filled.filled.includes("events.0.position"));
  assert.ok(!filled.filled.includes("events.0.organization"));

  const gold = fillEmptyFromGrokipedia({
    birth_date: "1980-01-01",
    grokipedia: { birth_date: "1999-01-01" },
  });
  assert.equal(gold.row.birth_date, "1980-01-01");
  assert.deepEqual(gold.filled, []);

  const cite = grokipediaCite({ name: "James Comey", summary: "Removed." });
  assert.equal(cite.publisher, "Grokipedia");
  assert.match(cite.url, /grokipedia\.com\/page\/James_Comey/);
  assert.equal(grokipediaCite({ name: "No Text" }), null);

  const entry = grokipediaEntry({
    id: "james-comey",
    name: "James Comey",
    summary: "Removed as FBI director by President Trump.",
    sources: [{ url: "https://www.example.com/n" }],
  });
  assert.equal(entry.personHref, "/people/james-comey");
  assert.equal(entry.redundant, true);
  assert.match(entry.cite.url, /grokipedia\.com/);

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

test("standalone grokipedia pages soft-redirect; fill API stays", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const index = await requestPage("/grokipedia");
  assert.equal(index.status, 302);
  assert.equal(index.headers.Location, "/search");
  assert.doesNotMatch(index.body, /grokipedia-list|grokipedia-detail|Synopsis/);

  const entry = await requestPage("/grokipedia/james-comey");
  assert.equal(entry.status, 302);
  assert.equal(entry.headers.Location, "/people/james-comey");
  assert.doesNotMatch(entry.body, /grokipedia-detail/);

  const missing = await requestPage("/grokipedia/not-a-person");
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.Location, "/search?q=not%20a%20person");

  const api = await requestPage("/api/grokipedia/james-comey");
  assert.equal(api.status, 200);
  const payload = JSON.parse(api.body);
  assert.equal(payload.slug, "james-comey");
  assert.equal(payload.personHref, "/people/james-comey");
  assert.equal(payload.redundant, true);
  assert.deepEqual(payload.fills, []);
  assert.match(payload.cite.url, /grokipedia\.com\/page\/James_Comey/);
});

test("keymap drops grokipedia nav; person cite is not a synopsis dump", () => {
  const footer = keymapFooter("/");
  assert.doesNotMatch(footer, /href="\/grokipedia"/);
  assert.doesNotMatch(footer, /data-key="k"/);
  assert.match(footer, /Grokipedia may appear as an extra encyclopedia cite/);

  const cite = grokipediaBlock({
    name: "Casey Vale",
    summary: "Held after a public-role arrest.",
  });
  assert.match(cite, /grokipedia-cite/);
  assert.match(cite, /grokipedia\.com\/page\/Casey_Vale/);
  assert.doesNotMatch(cite, /Held after a public-role arrest/);
  assert.doesNotMatch(cite, /grokipedia-text|Open Grokipedia|—/);
  assert.equal(grokipediaBlock({}), "");

  const html = personDetail({
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    summary: "Held after a public-role arrest.",
    sources: [
      { publisher: "One", url: "https://www.example.com/news/casey-vale-held" },
      { publisher: "Two", url: "https://www.example.net/world/casey-vale-arrest" },
    ],
    grokipedia: { birth_date: "1985-03-12", country_of_origin: "United States" },
  });
  assert.match(html, /grokipedia-cite/);
  assert.match(html, /Birth date/);
  assert.match(html, /Origin · United States/);
  assert.match(html, /One/);
  assert.match(html, /Two/);
  assert.doesNotMatch(html, /Held after a public-role arrest/);
  assert.doesNotMatch(html, /class="grokipedia-text"|Synopsis|Open Grokipedia/);
  assert.equal((html.match(/class="box-pane/g) || []).length, 1);
});
