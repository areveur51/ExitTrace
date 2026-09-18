import assert from "node:assert/strict";
import { test } from "node:test";
import {
  kindDetail,
  kindEntryStills,
  kindExtraStills,
  kindList,
  kindListRow,
  kindSourceHtml,
  kindSupportingEntries,
  kindSupportingGroupHtml,
  searchBody,
} from "../app/lib/html.mjs";
import { supportingScreenshotPrefix } from "../app/lib/screenshot.mjs";
import {
  getKindComm,
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

function supportingMelania(overrides = {}) {
  const shot0 = `${supportingScreenshotPrefix(
    "red-folder-comms",
    "melaniatrump-2025-12-17-8fe71a81",
    0,
  )}marijkeanon-2026-09-18.png`;
  const shot1 = `${supportingScreenshotPrefix(
    "red-folder-comms",
    "melaniatrump-2025-12-17-8fe71a81",
    1,
  )}areveur51-2026-09-18.png`;
  return folder({
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
          screenshot: "",
          screenshot_credit: "",
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
          screenshot: shot1,
          screenshot_credit: "X",
        },
      ],
    },
    ...overrides,
    _shots: { shot0, shot1 },
  });
}

test("red folder supporting group renders cite+source+optional screenshot+stills", () => {
  const row = supportingMelania();
  const entries = kindSupportingEntries(row);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].screenshot, "");
  assert.equal(entries[1].screenshot, row._shots.shot1);
  assert.deepEqual(kindEntryStills("red_folder", row, entries[0]), [
    "/media/red-folder-comms/marijkeanon-2026-09-18.jpg",
  ]);
  assert.deepEqual(kindEntryStills("red_folder", row, entries[1]), [
    "/media/red-folder-comms/areveur51-2026-09-18.png",
    "/media/red-folder-comms/areveur51-2026-09-18-2.png",
    "/media/red-folder-comms/areveur51-2026-09-18-3.png",
    "/media/red-folder-comms/areveur51-2026-09-18-4.png",
  ]);
  // Helper still merges supporting stills; grouped detail does not dump them on main.
  assert.deepEqual(kindExtraStills("red_folder", row), [
    "/media/red-folder-comms/marijkeanon-2026-09-18.jpg",
    "/media/red-folder-comms/areveur51-2026-09-18.png",
    "/media/red-folder-comms/areveur51-2026-09-18-2.png",
    "/media/red-folder-comms/areveur51-2026-09-18-3.png",
    "/media/red-folder-comms/areveur51-2026-09-18-4.png",
  ]);
  assert.deepEqual(kindExtraStills("red_folder", row, { includeSupporting: false }), []);
  const mainSource = kindSourceHtml(row, { includeSupporting: false });
  assert.match(mainSource, /Source · <a class="source-link" href="https:\/\/x\.com\/MELANIATRUMP\/status\/2001266577077837917"/);
  assert.doesNotMatch(mainSource, /Supporting ·|MarijkeANON|Areveur51/);

  const html = kindDetail("red_folder", row);
  assert.equal((html.match(/class="supporting-group"/g) || []).length, 2);
  assert.match(html, /data-supporting-index="0"/);
  assert.match(html, /data-supporting-index="1"/);
  // Main post: portrait + main screenshot + cite + primary Source only.
  assert.match(html, /class="detail-media detail-media--masonry" data-tiles="4"/);
  assert.doesNotMatch(html, /Supporting · @MarijkeANON|Supporting · @Areveur51/);

  const first = kindSupportingGroupHtml("red_folder", row, entries[0]);
  assert.match(first, /class="cite-block"/);
  assert.match(first, /class="handle">@MarijkeANON</);
  assert.match(first, /class="acct">MarijkeANON</);
  assert.match(first, /class="post-text">McDonald/);
  assert.match(first, /Source · <a class="source-link" href="https:\/\/x\.com\/MarijkeANON\/status\/2100995431534649639"/);
  assert.match(first, /marijkeanon-2026-09-18\.jpg/);
  assert.match(first, /data-lightbox="\/media\/red-folder-comms\/marijkeanon-2026-09-18\.jpg"/);
  assert.doesNotMatch(first, /detail-tile--screenshot/);
  assert.doesNotMatch(first, /MELANIATRUMP\/status\/2001266577077837917/);
  assert.doesNotMatch(first, /Areveur51/);

  const second = kindSupportingGroupHtml("red_folder", row, entries[1]);
  assert.match(second, /class="cite-block"/);
  assert.match(second, /class="handle">@Areveur51</);
  assert.match(second, /class="acct">Areveur51</);
  assert.match(second, /Melania Trailer features her hat/);
  assert.match(second, /Source · <a class="source-link" href="https:\/\/x\.com\/Areveur51\/status\/2101014802256494801"/);
  assert.match(second, /detail-tile--screenshot/);
  assert.match(second, new RegExp(`data-lightbox="${row._shots.shot1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(second, /areveur51-2026-09-18-4\.png/);
  assert.match(second, /data-lightbox="\/media\/red-folder-comms\/areveur51-2026-09-18-4\.png"/);
  assert.match(second, /data-tiles="7"/); // shot + 4 stills + cite + source
  assert.doesNotMatch(second, /MarijkeANON\/status\/2100995431534649639/);
  assert.doesNotMatch(second, /MELANIATRUMP\/status\/2001266577077837917/);

  assert.match(html, /marijkeanon-2026-09-18\.jpg/);
  assert.match(html, /areveur51-2026-09-18-4\.png/);
  assert.match(html, /class="supporting-group"/);
  // X URLs stay under Source tiles only (main + each group).
  const withoutSource = html.replace(
    /<section class="detail-tile detail-tile--meta detail-tile--source">[\s\S]*?<\/section>/g,
    "",
  );
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/MELANIATRUMP\/status\/2001266577077837917/);
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/MarijkeANON\/status\/2100995431534649639/);
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/Areveur51\/status\/2101014802256494801/);
});

test("red folder supporting screenshot is fail-closed and optional", () => {
  const row = folder({
    id: "melaniatrump-2025-12-17-8fe71a81",
    snapshot: {
      supporting: [
        {
          handle: "@Ally",
          account_name: "Ally",
          text: "Cite only.",
          posted_at: "2026-09-18",
          source_url: "https://x.com/Ally/status/1",
          screenshot: "/media/screenshots/people/nested/path.jpg",
          screenshot_credit: "nope",
        },
        {
          handle: "@Bea",
          account_name: "Bea",
          text: "Has a stored shot.",
          posted_at: "2026-09-18",
          source_url: "https://x.com/Bea/status/2",
          screenshot: `${supportingScreenshotPrefix(
            "red-folder-comms",
            "melaniatrump-2025-12-17-8fe71a81",
            1,
          )}bea.png`,
        },
      ],
    },
  });
  const entries = kindSupportingEntries(row);
  assert.equal(entries[0].screenshot, "");
  assert.match(entries[1].screenshot, /\/support\/1\/bea\.png$/);
  const empty = kindSupportingGroupHtml("red_folder", row, entries[0]);
  assert.match(empty, /class="cite-block"/);
  assert.match(empty, /Source ·/);
  assert.doesNotMatch(empty, /detail-tile--screenshot/);
  const shot = kindSupportingGroupHtml("red_folder", row, entries[1]);
  assert.match(shot, /detail-tile--screenshot/);
  assert.match(shot, /data-lightbox="\/media\/screenshots\/red-folder-comms\/melaniatrump-2025-12-17-8fe71a81\/support\/1\/bea\.png"/);
});

test("red folder without supporting keeps a single Source line", () => {
  const html = kindDetail("red_folder", folder());
  assert.match(html, /Source ·/);
  assert.doesNotMatch(html, /Supporting ·/);
  assert.equal((html.match(/source-link/g) || []).length, 1);
});

test("store accepts supporting screenshot fields and live detail paints groups", async () => {
  setMemory(goldSeed());
  const shot = `${supportingScreenshotPrefix(
    "red-folder-comms",
    "flotus-2026-09-17-abc12345",
    0,
  )}flotus-support.png`;
  const row = await insertKindComm(
    "red_folder",
    folder({
      snapshot: {
        supporting: [
          {
            handle: "@Ally",
            account_name: "Ally",
            text: "Support cite.",
            posted_at: "2026-09-18",
            source_url: "https://x.com/Ally/status/9",
            still: "/media/red-folder-comms/flotus-2026-09-17.jpg",
            screenshot: shot,
            screenshot_credit: "X",
          },
        ],
      },
    }),
  );
  const stored = await getKindComm("red_folder", row.id);
  assert.equal(stored.still, "/media/red-folder-comms/flotus-red-folder-2026.jpg");
  assert.equal(stored.snapshot.supporting[0].screenshot, shot);
  assert.equal(stored.snapshot.supporting[0].screenshot_credit, "X");
  const page = await requestPage(`/red-folder-comms/${row.id}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /class="supporting-group"/);
  assert.match(page.body, /class="cite-block"/);
  assert.match(page.body, /Support cite/);
  assert.match(page.body, /https:\/\/x\.com\/Ally\/status\/9/);
  assert.match(page.body, /detail-tile--screenshot/);
  assert.match(page.body, new RegExp(shot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page.body, /id="tui-lightbox"/);
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
