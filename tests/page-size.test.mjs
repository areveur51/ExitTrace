import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { layout, pageSizeSelector, pager } from "../app/lib/html.mjs";
import {
  DOG_PAGE_SIZE,
  PAGE_SIZE,
  PAGE_SIZES,
  PAGE_SIZE_STORAGE_KEY,
} from "../app/lib/paginate.mjs";
import { handle } from "../app/server.mjs";
import { loadSeedFile, setMemory } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LARP =
  /CLOSE HACK|CLOSE HACK IMMEDIATELY|SAMURAI PROTOCOL|BREACH PROTOCOL|ROOT@|SurveilTrack|BIO-INTERFACE|ADMIN ACCESS GRANTED|BATTLEDECK|KILO MICROCYBER|leftover/i;

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function requestPage(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: pathname,
      headers: { host: "127.0.0.1", ...headers },
    };
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

function countClass(html, className) {
  return (html.match(new RegExp(`class="[^"]*\\b${className}\\b`, "g")) || []).length;
}

test("page-size selector is 17/34/51 and persists under exittrace-page-size", () => {
  const html = pageSizeSelector(17);
  assert.match(html, /data-page-size-set="17"/);
  assert.match(html, /data-page-size-set="34"/);
  assert.match(html, /data-page-size-set="51"/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /data-page-size-set="10"/);
  assert.doesNotMatch(html, LARP);
  const pagerHtml = pager(
    { page: 1, totalPages: 2, total: 20, hasPrev: false, hasNext: true, pageSize: 17 },
    { basePath: "/firings", pageSizes: PAGE_SIZES },
  );
  assert.match(pagerHtml, /class="page-size"/);
  assert.match(pagerHtml, /href="\/firings\?page=2"/);
  const bare = pager(
    { page: 1, totalPages: 1, total: 7, hasPrev: false, hasNext: false, pageSize: 10 },
    { basePath: "/dog-comms" },
  );
  assert.doesNotMatch(bare, /class="page-size"/);
});

test("layout boot script syncs localStorage to a cookie without changing ?page=", () => {
  const page = layout({
    title: "Firings",
    path: "/firings",
    heading: "Firings",
    pageSize: 17,
    body: `<p class="list-head">Firings</p>`,
  });
  assert.match(page, /data-page-size="17"/);
  assert.match(page, new RegExp(PAGE_SIZE_STORAGE_KEY));
  assert.match(page, /localStorage\.getItem/);
  assert.match(page, /document\.cookie/);
  assert.doesNotMatch(page, /leftover/);
});

test("person list pages default to 17 and honor the cookie; dog comms stay 10", async () => {
  setMemory(goldSeed());
  const firings = await requestPage("/firings");
  const resignations = await requestPage("/resignations");
  const government = await requestPage("/government");
  const arrests = await requestPage("/arrests");
  const indictments = await requestPage("/indictments");
  const deaths = await requestPage("/deaths");
  const celebs = await requestPage("/deaths/celebrities");
  const unsorted = await requestPage("/unsorted");
  const dogs = await requestPage("/dog-comms");
  const home = await requestPage("/");
  const add = await requestPage("/add");
  const detail = await requestPage("/people/james-comey");

  for (const res of [
    firings,
    resignations,
    government,
    arrests,
    indictments,
    deaths,
    celebs,
    unsorted,
  ]) {
    assert.equal(res.status, 200);
    assert.match(res.body, /data-page-size="17"/);
    assert.match(res.body, /data-page-size-set="17"/);
    assert.match(res.body, /data-page-size-set="34"/);
    assert.match(res.body, /data-page-size-set="51"/);
  }
  for (const res of [dogs, home, add, detail]) {
    assert.doesNotMatch(res.body, /data-page-size=/);
    assert.doesNotMatch(res.body, /data-page-size-set=/);
    assert.doesNotMatch(res.body, /class="page-size"/);
  }
  assert.doesNotMatch(dogs.body, /class="age-filter"/);

  const seed = goldSeed();
  const deathCount = seed.people.filter((r) => String(r.category).startsWith("death_")).length;
  assert.ok(deathCount > PAGE_SIZE);
  assert.equal(countClass(deaths.body, "person-card"), PAGE_SIZE);
  assert.match(deaths.body, /href="\/deaths\?page=2"/);
  assert.doesNotMatch(deaths.body, /href="\/deaths\?page=1"/);

  const wide = await requestPage("/deaths", {
    cookie: `${PAGE_SIZE_STORAGE_KEY}=34`,
  });
  assert.equal(wide.status, 200);
  assert.match(wide.body, /data-page-size="34"/);
  assert.equal(countClass(wide.body, "person-card"), Math.min(34, deathCount));
  assert.match(wide.body, /data-page-size-set="34" aria-pressed="true"/);

  const dogCards = countClass(dogs.body, "dog-card");
  assert.ok(dogCards <= DOG_PAGE_SIZE);
  assert.ok(dogCards > 0);
});

test("app.js persists page size in localStorage like themes", () => {
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  assert.match(js, /exittrace-page-size/);
  assert.match(js, /data-page-size-set/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /searchParams\.delete\("page"\)/);
  assert.doesNotMatch(js, LARP);
  assert.doesNotMatch(js, /leftover/);
});
