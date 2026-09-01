import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "url";
import path from "path";
import {
  DEATH_KEEP_IDS,
  INDICTMENT_KEEP_IDS,
  catalogListKinds,
  categoryByPath,
} from "../app/lib/categories.mjs";
import { DisplayError, listPathForPerson } from "../app/lib/display-check.mjs";
import { PAGE_SIZE } from "../app/lib/paginate.mjs";
import { validateIdentifiedPersonInput, PromoteError } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
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

function newestFirst(rows) {
  return rows.slice().sort((a, b) => {
    const d = String(b.event_date).localeCompare(String(a.event_date));
    if (d !== 0) return d;
    return String(a.name).localeCompare(String(b.name));
  });
}

function countClass(html, className) {
  return (html.match(new RegExp(`class="[^"]*\\b${className}\\b`, "g")) || []).length;
}

test("parent catalog kinds are the KEEP union; children stay one kind", () => {
  assert.deepEqual(catalogListKinds("death_unspecified"), DEATH_KEEP_IDS);
  assert.deepEqual(catalogListKinds("indictment_unspecified"), INDICTMENT_KEEP_IDS);
  assert.deepEqual(catalogListKinds("death_celebrity"), ["death_celebrity"]);
  assert.deepEqual(catalogListKinds("death_official"), ["death_official"]);
  assert.deepEqual(catalogListKinds("death_ceo"), ["death_ceo"]);
  assert.deepEqual(catalogListKinds("indictment_civilian"), ["indictment_civilian"]);
  assert.deepEqual(catalogListKinds("indictment_non_civilian"), ["indictment_non_civilian"]);
  assert.deepEqual(catalogListKinds("corona_comms"), ["corona_comms"]);
  assert.equal(categoryByPath("/deaths").id, "death_unspecified");
  assert.equal(categoryByPath("/indictments").id, "indictment_unspecified");
  assert.equal(categoryByPath("/corona-comms").id, "corona_comms");
  assert.equal(categoryByPath("/corona-comms/civilians"), null);
  assert.deepEqual(DEATH_KEEP_IDS, ["death_celebrity", "death_official", "death_ceo"]);
  assert.deepEqual(INDICTMENT_KEEP_IDS, [
    "indictment_civilian",
    "indictment_non_civilian",
  ]);
});

test("unspecified classify and display-check paths stay fail-closed", () => {
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-05-10",
        category: "death_unspecified",
        cite_urls: CITES,
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-08-01",
        category: "indictment_unspecified",
        cite_urls: CITES,
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
  assert.throws(
    () => listPathForPerson("death_unspecified"),
    (err) => err instanceof DisplayError && err.code === "deaths_index",
  );
  assert.throws(
    () => listPathForPerson("indictment_unspecified"),
    (err) => err instanceof DisplayError && err.code === "indictments_index",
  );
  assert.equal(listPathForPerson("death_celebrity"), "/deaths/celebrities");
  assert.equal(listPathForPerson("indictment_civilian"), "/indictments/civilians");
  assert.equal(listPathForPerson("corona_comms"), "/corona-comms");
});

test("GET /deaths lists every death kind; child routes filter", async () => {
  const seed = goldSeed();
  setMemory(seed);
  const deaths = seed.people.filter((r) => DEATH_KEEP_IDS.includes(r.category));
  const celebs = seed.people.filter((r) => r.category === "death_celebrity");
  const officials = seed.people.filter((r) => r.category === "death_official");
  const ceos = seed.people.filter((r) => r.category === "death_ceo");
  assert.ok(deaths.length > PAGE_SIZE);
  assert.ok(celebs.length && officials.length && ceos.length);

  const parent = await requestPage("/deaths");
  assert.equal(parent.status, 200);
  assert.match(parent.body, /class="tui hud/);
  assert.match(parent.body, /class="hud-stage"/);
  assert.match(parent.body, /class="tui-row person-card/);
  assert.match(parent.body, /class="portrait thumb"/);
  assert.match(parent.body, /\/media\/thumbs\/people\//);
  assert.match(parent.body, /href="\/deaths\/celebrities"/);
  assert.match(parent.body, /href="\/deaths\/officials"/);
  assert.match(parent.body, /href="\/deaths\/ceos"/);
  assert.doesNotMatch(parent.body, /source-card/);
  assert.doesNotMatch(parent.body, /CLOSE HACK|SAMURAI PROTOCOL|BREACH PROTOCOL/i);
  assert.match(parent.body, new RegExp(`${deaths.length} available`));
  assert.equal(countClass(parent.body, "person-card"), PAGE_SIZE);

  const newest = newestFirst(deaths);
  assert.match(parent.body, new RegExp(`href="/people/${newest[0].id}"`));
  assert.match(parent.body, new RegExp(newest[0].name));
  const parentIds = newest.slice(0, PAGE_SIZE).map((r) => r.id);
  assert.ok(parentIds.some((id) => celebs.some((r) => r.id === id)));
  assert.ok(parentIds.some((id) => officials.some((r) => r.id === id)));
  assert.ok(parentIds.some((id) => ceos.some((r) => r.id === id)));

  const celebPage = await requestPage("/deaths/celebrities");
  const officialPage = await requestPage("/deaths/officials");
  const ceoPage = await requestPage("/deaths/ceos");
  for (const res of [celebPage, officialPage, ceoPage]) {
    assert.equal(res.status, 200);
    assert.match(res.body, /class="tui-row person-card/);
    assert.match(res.body, /class="hud-stage"/);
  }
  assert.match(celebPage.body, new RegExp(`${celebs.length} available`));
  assert.match(officialPage.body, new RegExp(`${officials.length} available`));
  assert.match(ceoPage.body, new RegExp(`${ceos.length} available`));

  const newestCeleb = newestFirst(celebs)[0];
  const newestOfficial = newestFirst(officials)[0];
  const newestCeo = newestFirst(ceos)[0];
  assert.match(celebPage.body, new RegExp(`href="/people/${newestCeleb.id}"`));
  assert.doesNotMatch(celebPage.body, new RegExp(`href="/people/${newestOfficial.id}"`));
  assert.doesNotMatch(celebPage.body, new RegExp(`href="/people/${newestCeo.id}"`));
  assert.match(officialPage.body, new RegExp(`href="/people/${newestOfficial.id}"`));
  assert.doesNotMatch(officialPage.body, new RegExp(`href="/people/${newestCeleb.id}"`));
  assert.match(ceoPage.body, new RegExp(`href="/people/${newestCeo.id}"`));
  assert.doesNotMatch(ceoPage.body, new RegExp(`href="/people/${newestCeleb.id}"`));
});

test("GET /indictments lists every indictment kind; child routes filter", async () => {
  setMemory(goldSeed());
  const empty = await requestPage("/indictments");
  assert.equal(empty.status, 200);
  assert.match(empty.body, /class="tui hud/);
  assert.match(empty.body, /class="hud-stage"/);
  assert.match(empty.body, /No rows on this page/);
  assert.doesNotMatch(empty.body, /person-card/);
  assert.match(empty.body, /href="\/indictments\/civilians"/);
  assert.match(empty.body, /href="\/indictments\/non-civilians"/);

  const civilian = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
  });
  const officer = await applyIdentifiedPerson({
    subject: "Riley Shaw",
    event_date: "2024-09-15",
    category: "indictment_non_civilian",
    cite_urls: CITES,
  });
  assert.equal(civilian.person.category, "indictment_civilian");
  assert.equal(officer.person.category, "indictment_non_civilian");

  const parent = await requestPage("/indictments");
  const civilians = await requestPage("/indictments/civilians");
  const nonCivilians = await requestPage("/indictments/non-civilians");
  assert.equal(parent.status, 200);
  assert.match(parent.body, /class="tui-row person-card/);
  assert.match(parent.body, /2 available/);
  assert.match(parent.body, /href="\/people\/casey-vale"/);
  assert.match(parent.body, /Casey Vale/);
  assert.match(parent.body, new RegExp(`href="/people/${officer.person.id}"`));
  assert.match(parent.body, /Riley Shaw/);
  assert.match(parent.body, /href="\/indictments\/civilians"/);
  assert.match(parent.body, /href="\/indictments\/non-civilians"/);
  assert.doesNotMatch(parent.body, /source-card/);

  assert.match(civilians.body, /href="\/people\/casey-vale"/);
  assert.doesNotMatch(civilians.body, new RegExp(`href="/people/${officer.person.id}"`));
  assert.match(civilians.body, /1 available/);
  assert.match(nonCivilians.body, new RegExp(`href="/people/${officer.person.id}"`));
  assert.doesNotMatch(nonCivilians.body, /href="\/people\/casey-vale"/);
  assert.match(nonCivilians.body, /1 available/);
});
