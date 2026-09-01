import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DisplayError,
  assertDisplayed,
  checkPersonDisplayed,
  fetchCatalogHtml,
  listPathForPerson,
} from "../app/lib/display-check.mjs";
import { importSourcePostsText } from "../app/lib/import-posts.mjs";
import {
  applyIdentifiedPerson,
  getMemory,
  loadSeedFile,
  promoteSourcePost,
  setMemory,
} from "../app/lib/store.mjs";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

test("list paths skip the /deaths index", () => {
  assert.equal(listPathForPerson("firings"), "/firings");
  assert.equal(listPathForPerson("resignations"), "/resignations");
  assert.equal(listPathForPerson("government_stepdowns"), "/government");
  assert.equal(listPathForPerson("arrests"), "/arrests");
  assert.equal(listPathForPerson("corona_comms"), "/corona-comms");
  assert.equal(listPathForPerson("indictment_civilian"), "/indictments/civilians");
  assert.equal(listPathForPerson("indictment_non_civilian"), "/indictments/non-civilians");
  assert.equal(listPathForPerson("death_celebrity"), "/deaths/celebrities");
  assert.equal(listPathForPerson("death_official"), "/deaths/officials");
  assert.equal(listPathForPerson("death_ceo"), "/deaths/ceos");
  assert.throws(
    () => listPathForPerson("death_unspecified"),
    (err) => err instanceof DisplayError && err.code === "deaths_index",
  );
  assert.throws(
    () => listPathForPerson("indictment_unspecified"),
    (err) => err instanceof DisplayError && err.code === "indictments_index",
  );
  assert.throws(() => listPathForPerson("dog_comms"), (err) => err instanceof DisplayError);
});

test("after insert, list + detail HTML show the row; /deaths and health do not count", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  });
  const shown = await checkPersonDisplayed(created.person);
  assert.equal(shown.detail, "/people/casey-vale");
  assert.match(shown.list, /^\/arrests/);

  const list = await fetchCatalogHtml(shown.list);
  assert.equal(list.status, 200);
  assert.match(list.body, /Casey Vale/);
  assert.match(list.body, /href="\/people\/casey-vale"/);

  const detail = await fetchCatalogHtml("/people/casey-vale");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /Casey Vale/);

  const deaths = await fetchCatalogHtml("/deaths");
  assert.equal(deaths.status, 200);
  assert.doesNotMatch(deaths.body, /href="\/people\/casey-vale"/);
  assert.match(deaths.body, /href="\/deaths\/celebrities"/);
  assert.match(deaths.body, /href="\/deaths\/officials"/);
  assert.match(deaths.body, /href="\/deaths\/ceos"/);

  const health = await fetchCatalogHtml("/api/health");
  assert.equal(health.status, 200);
  assert.match(health.body, /"people":\s*73/);
  assert.doesNotMatch(health.body, /Casey Vale/);
});

test("death promote displays on officials and the /deaths union", async () => {
  const seed = goldSeed();
  setMemory(seed);
  await importSourcePostsText(
    fs.readFileSync(path.join(ROOT, "tests", "fixtures", "source-posts.jsonl"), "utf8"),
  );
  const result = await promoteSourcePost({
    source_url: "https://example.com/n/death-1",
    subject: "Casey Vale",
    event_date: "2024-05-10",
    category: "death_official",
    cite_urls: CITES,
  });
  const shown = await assertDisplayed(result);
  assert.equal(shown.list, "/deaths/officials");
  assert.equal(shown.detail, "/people/casey-vale");

  const list = await fetchCatalogHtml("/deaths/officials");
  assert.match(list.body, /Casey Vale/);
  const index = await fetchCatalogHtml("/deaths");
  assert.match(index.body, /href="\/people\/casey-vale"/);
  const celebs = await fetchCatalogHtml("/deaths/celebrities");
  assert.doesNotMatch(celebs.body, /href="\/people\/casey-vale"/);
  assert.equal(getMemory().people.some((r) => r.id === "casey-vale"), true);
});

test("gold annotate still has to appear on live firings HTML", async () => {
  setMemory(goldSeed());
  const shown = await checkPersonDisplayed(
    getMemory().people.find((r) => r.id === "james-comey"),
  );
  assert.match(shown.list, /^\/firings/);
  assert.equal(shown.detail, "/people/james-comey");
  const list = await fetchCatalogHtml(shown.list);
  assert.match(list.body, /James Comey/);
});
