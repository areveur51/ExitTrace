import assert from "node:assert/strict";
import { test } from "node:test";
import {
  kindDetail,
  kindList,
  kindListRow,
  searchBody,
} from "../app/lib/html.mjs";
import {
  insertKindComm,
  searchCatalog,
  setMemory,
  loadSeedFile,
} from "../app/lib/store.mjs";
import { handle } from "../app/server.mjs";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function folder(overrides = {}) {
  return {
    id: "flotus-2026-09-17-abc12345",
    posted_at: "2026-09-17",
    handle: "@FLOTUS",
    account_name: "Melania Trump",
    text: "Stored official red-folder snapshot.",
    still: "/media/red-folder-comms/flotus-red-folder-2026.jpg",
    source_url: "https://x.com/FLOTUS/status/2100603347044585925",
    ...overrides,
  };
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, hdrs) {
        this.statusCode = status;
        this.headers = hdrs || {};
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          headers: this.headers,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("red folder list and search thumbs use still.thumb like dog comms", () => {
  const row = kindListRow("red_folder", folder());
  const search = searchBody([{ type: "red_folder", row: folder() }], "FLOTUS");
  assert.match(row, /class="still thumb"/);
  assert.match(row, /width="40" height="52"/);
  assert.match(row, /src="\/media\/thumbs\/red-folder-comms\/flotus-red-folder-2026\.jpg\?p=3"/);
  assert.doesNotMatch(row, /src="\/media\/red-folder-comms\/flotus-red-folder-2026\.jpg"/);
  assert.match(row, /href="\/red-folder-comms\/flotus-2026-09-17-abc12345"/);
  assert.match(row, /Red Folder comms/);
  assert.match(search, /class="still thumb"/);
  assert.doesNotMatch(search, /src="\/media\/red-folder-comms\/flotus-red-folder-2026\.jpg"/);
});

test("red folder detail keeps the full still", () => {
  const html = kindDetail("red_folder", folder());
  assert.match(html, /class="detail red-folder-detail"/);
  assert.match(html, /src="\/media\/red-folder-comms\/flotus-red-folder-2026\.jpg"/);
  assert.match(html, /width="192" height="250"/);
  assert.doesNotMatch(html, /\/media\/thumbs\//);
  assert.match(html, /Source ·/);
});

test("empty red folder list still paginates", () => {
  assert.match(kindList("red_folder", []), /No rows on this page/);
});

test("live red-folder insert is listed, detailed, and searchable", async () => {
  setMemory(goldSeed());
  const row = await insertKindComm("red_folder", folder());
  const list = await requestPage("/red-folder-comms");
  assert.equal(list.status, 200);
  assert.match(list.body, /red-folder-card/);
  assert.match(list.body, /@FLOTUS/);
  assert.match(list.body, new RegExp(`/red-folder-comms/${row.id}`));
  assert.match(list.body, /\/media\/thumbs\/red-folder-comms\//);
  assert.doesNotMatch(list.body, /src="\/media\/red-folder-comms\//);
  assert.doesNotMatch(list.body, /widgets\.js/);

  const detail = await requestPage(`/red-folder-comms/${row.id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.body, /<article class="detail red-folder-detail">/);
  assert.match(detail.body, /@FLOTUS/);
  assert.match(detail.body, /https:\/\/x\.com\/FLOTUS\/status\/2100603347044585925/);
  assert.match(detail.body, /class="cite-block"/);

  const hits = await searchCatalog("FLOTUS");
  assert.ok(hits.some((h) => h.type === "red_folder" && h.row.id === row.id));
  const search = await requestPage("/search?q=FLOTUS");
  assert.equal(search.status, 200);
  assert.match(search.body, /red-folder-card/);

  const health = await requestPage("/api/health");
  assert.equal(health.status, 200);
  const json = JSON.parse(health.body);
  assert.equal(json.red_folder_comms, 1);
  assert.equal(json.byCategory.red_folder_comms, 1);
});
