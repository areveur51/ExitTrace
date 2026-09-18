import assert from "node:assert/strict";
import { test } from "node:test";
import {
  kindDetail,
  kindExtraStills,
  kindList,
  kindListRow,
  kindSourceHtml,
  kindSupportingEntries,
  searchBody,
} from "../app/lib/html.mjs";
import {
  insertKindComm,
  searchCatalog,
  setMemory,
  loadSeedFile,
  mergeKindSnapshotFillEmpty,
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

test("red folder supporting X links render in Source tile; stills join masonry", () => {
  const row = folder({
    id: "melaniatrump-2025-12-17-8fe71a81",
    handle: "@MELANIATRUMP",
    account_name: "MELANIA TRUMP",
    text: "MELANIA, the film, exclusively in theaters worldwide on January 30th, 2026.",
    still: "/media/red-folder-comms/melaniatrump-2025-12-17.jpg",
    screenshot: "/media/screenshots/red-folder-comms/melaniatrump-2025-12-17.png",
    source_url: "https://x.com/MELANIATRUMP/status/2001266577077837917",
    snapshot: {
      stills: ["/media/red-folder-comms/melaniatrump-2025-12-17.jpg"],
      supporting: [
        {
          text: "McDonald’s - Melania",
          still: "/media/red-folder-comms/marijkeanon-2026-09-18.jpg",
          handle: "@MarijkeANON",
          posted_at: "2026-09-18",
          source_url: "https://x.com/MarijkeANON/status/2100995431534649639",
          account_name: "MarijkeANON",
          stills: [],
        },
        {
          text: "@MarijkeANON Melania Trailer features her hat + red folder + Barron",
          still: "/media/red-folder-comms/areveur51-2026-09-18.png",
          handle: "@Areveur51",
          posted_at: "2026-09-18",
          source_url: "https://x.com/Areveur51/status/2101014802256494801",
          account_name: "Areveur51",
          stills: [
            "/media/red-folder-comms/areveur51-2026-09-18-2.png",
            "/media/red-folder-comms/areveur51-2026-09-18-3.png",
            "/media/red-folder-comms/areveur51-2026-09-18-4.png",
          ],
        },
      ],
    },
  });
  assert.equal(kindSupportingEntries(row).length, 2);
  assert.deepEqual(kindExtraStills("red_folder", row), [
    "/media/red-folder-comms/marijkeanon-2026-09-18.jpg",
    "/media/red-folder-comms/areveur51-2026-09-18.png",
    "/media/red-folder-comms/areveur51-2026-09-18-2.png",
    "/media/red-folder-comms/areveur51-2026-09-18-3.png",
    "/media/red-folder-comms/areveur51-2026-09-18-4.png",
  ]);
  const sources = kindSourceHtml(row);
  assert.match(sources, /Source · <a class="source-link" href="https:\/\/x\.com\/MELANIATRUMP\/status\/2001266577077837917"/);
  assert.match(sources, /Supporting · @MarijkeANON · <a class="source-link" href="https:\/\/x\.com\/MarijkeANON\/status\/2100995431534649639"/);
  assert.match(sources, /Supporting · @Areveur51 · <a class="source-link" href="https:\/\/x\.com\/Areveur51\/status\/2101014802256494801"/);

  const html = kindDetail("red_folder", row);
  assert.match(html, /data-tiles="9"/); // portrait+shot+5 stills + cite + source
  assert.match(html, /marijkeanon-2026-09-18\.jpg/);
  assert.match(html, /areveur51-2026-09-18-4\.png/);
  assert.match(html, /Supporting · @MarijkeANON/);
  assert.match(html, /Supporting · @Areveur51/);
  // Primary + supporting X URLs stay under the Source tile only.
  const withoutSource = html.replace(
    /<section class="detail-tile detail-tile--meta detail-tile--source">[\s\S]*?<\/section>/,
    "",
  );
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/MELANIATRUMP\/status\/2001266577077837917/);
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/MarijkeANON\/status\/2100995431534649639/);
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/Areveur51\/status\/2101014802256494801/);
});

test("red folder without supporting keeps a single Source line", () => {
  const html = kindDetail("red_folder", folder());
  assert.match(html, /Source ·/);
  assert.doesNotMatch(html, /Supporting ·/);
  assert.equal((html.match(/source-link/g) || []).length, 1);
});

test("mergeKindSnapshotFillEmpty keeps prior supporting and stills", () => {
  const merged = mergeKindSnapshotFillEmpty(
    { text: "seed" },
    {
      stills: ["/media/red-folder-comms/a.jpg"],
      supporting: [{ source_url: "https://x.com/a/status/1", handle: "@a" }],
    },
  );
  assert.deepEqual(merged.stills, ["/media/red-folder-comms/a.jpg"]);
  assert.equal(merged.supporting[0].source_url, "https://x.com/a/status/1");
  const keepNext = mergeKindSnapshotFillEmpty(
    {
      stills: ["/media/red-folder-comms/b.jpg"],
      supporting: [{ source_url: "https://x.com/b/status/2" }],
    },
    {
      stills: ["/media/red-folder-comms/a.jpg"],
      supporting: [{ source_url: "https://x.com/a/status/1" }],
    },
  );
  assert.deepEqual(keepNext.stills, ["/media/red-folder-comms/b.jpg"]);
  assert.equal(keepNext.supporting[0].source_url, "https://x.com/b/status/2");
});
