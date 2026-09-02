import assert from "node:assert/strict";
import { test } from "node:test";
import path from "path";
import { fileURLToPath } from "url";
import {
  matchesTags,
  parseTagFilter,
  personTags,
  tagsFromKinds,
} from "../app/lib/tags.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
  getMemory,
  listPeople,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

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

test("event kinds imply identity tags; extra tags stay on the person", () => {
  assert.deepEqual(tagsFromKinds(["death_celebrity"]), ["celebrity"]);
  assert.deepEqual(tagsFromKinds(["government_stepdowns", "death_ceo"]), [
    "official",
    "ceo",
  ]);
  const row = {
    category: "firings",
    events: [
      { kind: "firings", event_date: "2020-01-01", sources: [] },
      { kind: "death_celebrity", event_date: "2021-01-01", sources: [] },
    ],
    tags: ["official", "ceo"],
  };
  const tags = personTags(row);
  assert.ok(tags.includes("celebrity"));
  assert.ok(tags.includes("official"));
  assert.ok(tags.includes("ceo"));
  assert.ok(matchesTags(row, ["celebrity"]));
  assert.ok(matchesTags(row, ["official", "civilian"]));
  assert.equal(matchesTags(row, ["civilian"]), false);
});

test("path and query parse identity filters", () => {
  assert.deepEqual(parseTagFilter("", "/deaths/celebrities"), ["celebrity"]);
  assert.deepEqual(parseTagFilter("tags=official,ceo", "/deaths"), [
    "official",
    "ceo",
  ]);
  assert.deepEqual(parseTagFilter("", "/government"), ["official"]);
  assert.deepEqual(parseTagFilter("tags=celebrity", "/firings"), ["celebrity"]);
});

test("one person can carry firing + celebrity + official + ceo tags", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "firings",
    cite_urls: CITES,
  });
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2025-01-02",
    category: "death_celebrity",
    cite_urls: CITES,
  });
  const row = getMemory().people.find((p) => p.id === created.person.id);
  assert.ok(row);
  row.tags = ["celebrity", "official", "ceo", "non_civilian"];

  const firedCelebs = await listPeople({
    category: "firings",
    tags: ["celebrity"],
  });
  assert.ok(firedCelebs.some((p) => p.id === row.id));
  const firedCivilians = await listPeople({
    category: "firings",
    tags: ["civilian"],
  });
  assert.equal(firedCivilians.some((p) => p.id === row.id), false);

  const firings = await requestPage(`/firings?tags=celebrity`);
  assert.match(firings.body, new RegExp(`href="/people/${row.id}"`));
  assert.match(firings.body, /aria-label="Identity filters"/);
  assert.match(firings.body, /value="\/firings\?tags=celebrity"[^>]*selected/);
  assert.match(firings.body, />Age</);

  const officials = await requestPage("/government");
  assert.match(officials.body, /Officials/);
  assert.match(officials.body, /aria-label="Identity filters"/);
  assert.match(officials.body, new RegExp(`href="/people/${row.id}"`));
});

test("main event pages expose identity and age filters", async () => {
  setMemory(goldSeed());
  for (const pathName of [
    "/firings",
    "/resignations",
    "/arrests",
    "/corona-comms",
    "/indictments",
    "/deaths",
    "/government",
  ]) {
    const res = await requestPage(pathName);
    assert.equal(res.status, 200, pathName);
    assert.match(res.body, /aria-label="Identity filters"/);
    assert.match(res.body, /data-filter-select/);
    assert.match(res.body, /<select class="identity-filter-select"/);
    assert.match(res.body, />All</);
    assert.match(res.body, />Civilians</);
    assert.match(res.body, />Non-civilians</);
    assert.match(res.body, />Celebrities</);
    assert.match(res.body, />Officials</);
    assert.match(res.body, />Executives</);
    assert.doesNotMatch(res.body, />CEOs</);
    assert.match(res.body, /name="min_age"/);
  }
  const deaths = await requestPage("/deaths");
  assert.match(deaths.body, /Age at death/);
  assert.match(deaths.body, /value="\/deaths\/celebrities"/);
  assert.match(deaths.body, /value="\/deaths\/officials"/);
  assert.match(deaths.body, /value="\/deaths\/ceos"/);
  assert.match(deaths.body, />Executives</);
  const ceos = await requestPage("/deaths/ceos");
  assert.equal(ceos.status, 200);
  assert.match(ceos.body, /value="\/deaths\/ceos"[^>]*selected/);
  assert.match(ceos.body, /aria-current="page">Executives/);
  const gov = await requestPage("/government");
  assert.match(gov.body, /data-key="g"/);
  assert.match(gov.body, />Officials</);
});
