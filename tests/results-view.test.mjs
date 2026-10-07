import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import {
  CARD_SIZE_STORAGE_KEY,
  CARD_SIZES,
  DEFAULT_CARD_SIZE,
  DEFAULT_RESULTS_VIEW,
  RESULTS_VIEW_STORAGE_KEY,
  RESULTS_VIEWS,
  layout,
  listSection,
  peopleList,
  resultsViewControl,
  searchBody,
} from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { loadSeedFile, setMemory } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: pathname,
      headers: { host: "127.0.0.1" },
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

function countToolbar(html) {
  return (html.match(/data-results-toolbar/g) || []).length;
}

test("results view control is list/cards plus small/medium/large", () => {
  assert.deepEqual(RESULTS_VIEWS, ["list", "cards"]);
  assert.deepEqual(CARD_SIZES, ["s", "m", "l"]);
  assert.equal(DEFAULT_RESULTS_VIEW, "list");
  assert.equal(DEFAULT_CARD_SIZE, "m");
  assert.equal(RESULTS_VIEW_STORAGE_KEY, "exittrace-results-view");
  assert.equal(CARD_SIZE_STORAGE_KEY, "exittrace-card-size");
  const html = resultsViewControl();
  assert.match(html, /data-results-toolbar/);
  assert.match(html, /data-results-view-set="list"[^>]*aria-pressed="true"/);
  assert.match(html, /data-results-view-set="cards"[^>]*aria-pressed="false"/);
  assert.match(html, /data-card-size-set="s"/);
  assert.match(html, /data-card-size-set="m"[^>]*aria-pressed="true"/);
  assert.match(html, /data-card-size-set="l"/);
  assert.match(html, /aria-labelledby="results-view-label"/);
  assert.match(html, /aria-labelledby="card-size-label"/);
  assert.match(html, />List</);
  assert.match(html, />Cards</);
  assert.match(html, />Small</);
  assert.match(html, />Medium</);
  assert.match(html, />Large</);
});

test("toolbar sits once above a result list and stays off empty or rank markup", () => {
  const rows = [
    {
      id: "ada",
      name: "Ada Lovelace",
      category: "firing",
      event_date: "2024-01-02",
      net_worth_usd: null,
      photo: "",
    },
  ];
  const list = peopleList(rows);
  assert.match(list, /class="tui-row person-card/);
  assert.match(list, /tui-title/);
  assert.doesNotMatch(list, /data-results-toolbar/);
  const section = listSection(list, "<nav class='pager'></nav>", "<p class='list-head'>Firings</p>");
  assert.equal(countToolbar(section), 1);
  assert.ok(section.indexOf("data-results-toolbar") < section.indexOf("people-list"));
  assert.ok(section.indexOf("data-results-toolbar") < section.indexOf("class='pager'"));
  const empty = listSection("<p class='empty'>No rows on this page.</p>", "", "");
  assert.equal(countToolbar(empty), 0);
  const rank = listSection("<table class='dash-table'><tr><td>Reason</td></tr></table>", "", "");
  assert.equal(countToolbar(rank), 0);
  const prompt = listSection(searchBody([], ""), "", "");
  assert.equal(countToolbar(prompt), 0);
});

test("layout boot script restores view and card size from localStorage before paint", () => {
  const page = layout({
    title: "Firings",
    path: "/firings",
    heading: "Firings",
    body: "<p>rows</p>",
  });
  assert.match(page, new RegExp(RESULTS_VIEW_STORAGE_KEY));
  assert.match(page, new RegExp(CARD_SIZE_STORAGE_KEY));
  assert.match(page, /localStorage\.getItem/);
  assert.match(page, /data-results-view/);
  assert.match(page, /data-card-size/);
  assert.doesNotMatch(page, /exittrace-results-view=/);
});

test("catalog, search, and people lists include one toolbar; home, detail, and rank tables do not", async () => {
  setMemory(goldSeed());
  const surfaces = [
    "/firings",
    "/resignations",
    "/government",
    "/arrests",
    "/deaths",
    "/indictments",
    "/group-operations",
    "/unsorted",
    "/dog-comms",
    "/central-casting",
    "/corona-comms",
    "/tags/trump-nicknames",
    "/search?q=comey",
    "/dashboard/missing",
    "/dashboard/age",
  ];
  const sawList = [];
  for (const pathname of surfaces) {
    const res = await requestPage(pathname);
    assert.equal(res.status, 200, pathname);
    const hasList = res.body.includes("tui-list");
    assert.equal(countToolbar(res.body), hasList ? 1 : 0, pathname);
    if (hasList) {
      sawList.push(pathname);
      assert.match(res.body, /data-results-view-set="list"/, pathname);
      assert.match(res.body, /data-card-size-set="s"/, pathname);
      assert.match(res.body, /data-card-size-set="m"/, pathname);
      assert.match(res.body, /data-card-size-set="l"/, pathname);
    }
  }
  for (const pathname of ["/firings", "/deaths", "/dog-comms", "/search?q=comey"]) {
    assert.ok(sawList.includes(pathname), pathname);
  }
  const without = ["/", "/people/james-comey", "/dashboard", "/dashboard/reason", "/add", "/search"];
  for (const pathname of without) {
    const res = await requestPage(pathname);
    assert.equal(res.status, 200, pathname);
    assert.equal(countToolbar(res.body), 0, pathname);
  }
});

test("app.js persists results view and card size without a reload", () => {
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  assert.match(js, /exittrace-results-view/);
  assert.match(js, /exittrace-card-size/);
  assert.match(js, /data-results-view-set/);
  assert.match(js, /data-card-size-set/);
  assert.match(js, /localStorage\.setItem/);
  assert.doesNotMatch(js, /results-view[\s\S]{0,400}location\.assign/);
  assert.match(css, /html\[data-results-view="cards"\] \.tui-group/);
  assert.match(css, /html\[data-results-view="cards"\] \.card-size \{\s*display:\s*flex/);
  assert.match(css, /\.card-size \{\s*display:\s*none/);
  assert.match(css, /--result-card-min:\s*8\.25rem/);
  assert.match(css, /--result-card-min:\s*16rem/);
});
