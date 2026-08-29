import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { sourcePostDetail, sourcePostRow } from "../app/lib/html.mjs";
import { importSourcePostsText } from "../app/lib/import-posts.mjs";
import { handle } from "../app/server.mjs";
import {
  countDogComms,
  countPeople,
  countSourcePosts,
  getMemory,
  listPeople,
  listSourcePosts,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";
import { canonicalPublicUrl } from "../app/lib/urls.mjs";

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
        chunks.push(body);
        resolve({
          status: this.statusCode,
          body: Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || "")))).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "source-posts.jsonl");

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

test("canonical public URL drops tracking and normalizes hosts", () => {
  assert.equal(
    canonicalPublicUrl("https://www.Example.com/n/fire-1?utm_source=share&utm_medium=x"),
    "https://example.com/n/fire-1",
  );
  assert.equal(
    canonicalPublicUrl("https://twitter.com/Desk/status/1/"),
    "https://x.com/Desk/status/1",
  );
  assert.equal(canonicalPublicUrl(""), "");
});

test("fixture import keeps gold 72/8 and parks standalone source rows", async () => {
  const seed = goldSeed();
  assert.equal(seed.people.length, 72);
  assert.equal(seed.dog_comms.length, 8);
  setMemory(seed);

  const comey = getMemory().people.find((r) => r.id === "james-comey");
  const comeySources = JSON.stringify(comey.sources);
  const comeyDate = comey.event_date;

  const first = await importSourcePostsText(fs.readFileSync(FIXTURE, "utf8"));
  assert.equal(await countPeople(), 72);
  assert.equal(await countDogComms(), 8);
  assert.equal(getMemory().people.length, 72);
  assert.equal(getMemory().dog_comms.length, 8);

  const after = getMemory().people.find((r) => r.id === "james-comey");
  assert.equal(after.name, "James Comey");
  assert.equal(after.event_date, comeyDate);
  assert.equal(JSON.stringify(after.sources), comeySources);
  assert.equal(after.sources.length, 2);

  const standalone = await listSourcePosts({ standalone: true });
  assert.equal(standalone.length, 4);
  assert.equal(first.annotated, 1);
  assert.ok(first.skipped_dog >= 1);
  assert.ok(first.skipped_category >= 1);

  const annotated = (getMemory().source_posts || []).filter((r) => r.gold_person_id);
  assert.equal(annotated.length, 1);
  assert.equal(annotated[0].gold_person_id, "james-comey");

  const arrests = await listSourcePosts({ category: "arrests", standalone: true });
  assert.equal(arrests.length, 1);
  assert.equal(arrests[0].poster_handle, "@example_desk");
  assert.equal(arrests[0].posted_at, "2024-03-01");
  assert.equal(arrests[0].event_date, undefined);

  const deaths = await listSourcePosts({
    category: "death_unspecified",
    standalone: true,
  });
  assert.equal(deaths.length, 1);
  assert.equal(await countPeople("death_celebrity"), 12);
  assert.equal(await countPeople("death_unspecified"), 0);
  assert.equal(await countSourcePosts({ standalone: true }), 4);
  assert.equal(await countSourcePosts({ category: "death_unspecified", standalone: true }), 1);

  const second = await importSourcePostsText(fs.readFileSync(FIXTURE, "utf8"));
  assert.equal(await countPeople(), 72);
  assert.equal(await countDogComms(), 8);
  assert.equal((await listSourcePosts({ standalone: true })).length, 4);
  assert.equal(second.inserted, 0);
  assert.ok(second.updated >= 4);
});

test("empty subject and event_date render as em dash; poster is not the subject", () => {
  const row = {
    id: "sp-fixture",
    category: "arrests",
    source_url: "https://example.com/n/arrest-1",
    quoted_url: "",
    card_url: "",
    text: "Police said a public official was arrested this morning.",
    poster_handle: "@example_desk",
    poster_name: "Example Desk",
    posted_at: "2024-03-01",
    media_urls: [],
  };
  const list = sourcePostRow(row);
  const detail = sourcePostDetail(row);
  assert.match(list, /source-card/);
  assert.match(list, />—<\/div>/);
  assert.match(list, /posted/);
  assert.match(list, /poster @example_desk/);
  assert.doesNotMatch(list, /<div class="tui-title">@example_desk/);
  assert.match(detail, /Event date · —/);
  assert.match(detail, /<h2 class="detail-title">—<\/h2>/);
  assert.match(detail, /Posted ·/);
  assert.match(detail, /Poster · @example_desk/);
  assert.match(detail, /Example Desk/);
  assert.match(detail, /https:\/\/example\.com\/n\/arrest-1/);
});

test("people lists stay people-only; all standalone posts list on Unsorted", async () => {
  const seed = goldSeed();
  setMemory(seed);
  await importSourcePostsText(fs.readFileSync(FIXTURE, "utf8"));

  const firings = await listPeople("firings");
  assert.equal(firings.length, 12);
  assert.ok(firings.every((row) => row.event_date && row.name));

  const celebs = await listPeople("death_celebrity");
  assert.equal(celebs.length, 12);
  assert.ok(celebs.every((row) => row.category === "death_celebrity"));

  const parked = await listSourcePosts({ standalone: true });
  assert.equal(parked.length, 4);
  assert.ok(parked.some((row) => row.poster_handle === "@example_biz"));
  assert.ok(parked.some((row) => row.category === "death_unspecified"));
  assert.ok(parked.every((row) => !row.gold_person_id));
});

test("Arrests has no source-card; parked posts render on Unsorted", async () => {
  const seed = goldSeed();
  setMemory(seed);
  await importSourcePostsText(fs.readFileSync(FIXTURE, "utf8"));
  const arrests = await listSourcePosts({ category: "arrests", standalone: true });
  const page = await requestPage("/arrests");
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /source-card/);
  assert.doesNotMatch(page.body, /poster @example_desk/);
  assert.match(page.body, /data-key="a"/);
  assert.match(page.body, /href="\/unsorted"/);

  const firings = await requestPage("/firings");
  assert.equal(firings.status, 200);
  assert.doesNotMatch(firings.body, /source-card/);
  assert.doesNotMatch(firings.body, /poster @example_biz/);
  assert.match(firings.body, /person-card/);
  assert.match(firings.body, / · Firings · /);

  const unsorted = await requestPage("/unsorted");
  assert.equal(unsorted.status, 200);
  assert.match(unsorted.body, /source-card/);
  assert.match(unsorted.body, /posted/);
  assert.match(unsorted.body, /poster @example_desk/);
  assert.match(unsorted.body, /poster @example_biz/);
  assert.match(unsorted.body, /poster @example_obit/);
  assert.match(unsorted.body, /poster @example_pol/);
  assert.match(unsorted.body, new RegExp(`href="/posts/${arrests[0].id}"`));
  assert.match(unsorted.body, /data-key="u"/);
  assert.match(unsorted.body, /Arrests/);

  const detail = await requestPage(`/posts/${arrests[0].id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.body, /Event date · —/);
  assert.match(detail.body, /<h2 class="detail-title">—<\/h2>/);

  const deaths = await requestPage("/deaths");
  assert.equal(deaths.status, 200);
  assert.doesNotMatch(deaths.body, /source-card/);
  assert.doesNotMatch(deaths.body, /poster @example_obit/);
  assert.match(deaths.body, /href="\/deaths\/celebrities"/);
  assert.match(deaths.body, /href="\/deaths\/officials"/);
  assert.match(deaths.body, /href="\/deaths\/ceos"/);

  const search = await requestPage("/search?q=example_desk");
  assert.equal(search.status, 200);
  assert.match(search.body, /unsorted-group/);
  assert.match(search.body, /source-card/);
  assert.match(search.body, /poster @example_desk/);
  assert.doesNotMatch(search.body, /class="tui-row person-card"/);
});
