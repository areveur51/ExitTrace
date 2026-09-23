import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { dashRankEvents } from "../app/lib/dashboard.mjs";
import { DisplayError, listPathForPerson } from "../app/lib/display-check.mjs";
import {
  kindDetail,
  kindList,
  kindListRow,
  searchBody,
} from "../app/lib/html.mjs";
import {
  CENTRAL_CASTING_CITE_GATE,
  CENTRAL_CASTING_SENSES,
  CentralCastingSenseError,
  KIND_COMMS,
  centralCastingCiteStanding,
} from "../app/lib/kind-comms.mjs";
import {
  DEATH_KEEP_IDS,
  PROMOTE_CATEGORY_IDS,
  categoryByPath,
  mapImportCategory,
} from "../app/lib/categories.mjs";
import { supportingScreenshotPrefix } from "../app/lib/screenshot.mjs";
import {
  getKindComm,
  insertKindComm,
  loadSeedFile,
  searchCatalog,
  setMemory,
} from "../app/lib/store.mjs";
import { handle } from "../app/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function casting(overrides = {}) {
  return {
    id: "nytimes-2026-09-17-abc12345",
    posted_at: "2026-09-17",
    handle: "@nytimes",
    account_name: "The New York Times",
    text: "Stored central-casting snapshot.",
    still: "/media/central-casting-comms/nytimes-2026-09-17.jpg",
    source_url: "https://x.com/nytimes/status/2100603347044585925",
    sense: "looks_the_part",
    snapshot: {
      stills: [
        "/media/central-casting-comms/nytimes-2026-09-17-2.jpg",
        "/media/central-casting-comms/nytimes-2026-09-17-3.jpg",
      ],
    },
    ...overrides,
  };
}

function replacement(overrides = {}) {
  return casting({
    id: "reuters-2026-09-18-def67890",
    posted_at: "2026-09-18",
    handle: "@Reuters",
    account_name: "Reuters",
    text: "Stored replacement-sense snapshot.",
    still: "/media/central-casting-comms/reuters-2026-09-18.jpg",
    source_url: "https://x.com/Reuters/status/2100603347044585926",
    sense: "replacement",
    snapshot: { stills: ["/media/central-casting-comms/reuters-2026-09-18-2.jpg"] },
    ...overrides,
  });
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

test("central casting kind registration mirrors dog and red folder", () => {
  const spec = KIND_COMMS.central_casting;
  assert.equal(spec.id, "central_casting");
  assert.equal(spec.table, "central_casting_comms");
  assert.equal(spec.categoryId, "central_casting_comms");
  assert.equal(spec.memoryKey, "central_casting_comms");
  assert.equal(spec.path, "/central-casting-comms");
  assert.equal(spec.mediaDir, "central-casting-comms");
  assert.equal(spec.screenshotKind, "central-casting-comms");
  assert.equal(spec.navLabel, "Central Casting");
  assert.equal(spec.keymapKey, "t");
  assert.equal(KIND_COMMS.dog.keymapKey, "c");
  assert.equal(KIND_COMMS.red_folder.keymapKey, "e");
  const keys = Object.values(KIND_COMMS).map((row) => row.keymapKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(categoryByPath("/central-casting-comms").kind, "central_casting");
  const blurb = categoryByPath("/central-casting-comms").blurb;
  assert.match(blurb, /Trump “looks the part \/ Hollywood ideal”/);
  assert.match(blurb, /“replacement” claim senses/);
  assert.match(blurb, /filter by sense/);
  assert.equal(PROMOTE_CATEGORY_IDS.includes("central_casting_comms"), false);
  assert.equal(DEATH_KEEP_IDS.includes("central_casting_comms"), false);
  assert.equal(mapImportCategory("central_casting"), null);
  assert.equal(mapImportCategory("central_casting_comms"), null);
  assert.throws(() => listPathForPerson("central_casting_comms"), (err) => err instanceof DisplayError);
  const ranked = dashRankEvents({
    events: [
      { kind: "firings", event_date: "2020-01-02", sources: [] },
      { kind: "central_casting_comms", event_date: "2020-01-01", sources: [] },
    ],
  });
  assert.deepEqual(ranked.map((ev) => ev.kind), ["firings"]);
  assert.equal(CENTRAL_CASTING_CITE_GATE.personKeep, false);
  assert.deepEqual(CENTRAL_CASTING_SENSES, ["looks_the_part", "replacement"]);
});

test("cite gate keeps official and quote-chain standing; seed exception is seed-only", () => {
  assert.equal(
    centralCastingCiteStanding({ sourceUrl: "https://www.nytimes.com/2026/09/17/us/desk.html" }),
    "official",
  );
  assert.equal(
    centralCastingCiteStanding({
      sourceUrl: "https://x.com/someone/status/1",
      quotedUrls: ["https://www.reuters.com/world/desk-2026-09-17/"],
    }),
    "quote_chain",
  );
  assert.equal(
    centralCastingCiteStanding({
      sourceUrl: "https://x.com/someone/status/1",
      seed: true,
      admiralNamed: true,
    }),
    "seed_admiral_named",
  );
  assert.equal(
    centralCastingCiteStanding({
      sourceUrl: "https://x.com/someone/status/1",
      admiralNamed: true,
    }),
    "",
  );
  assert.deepEqual([...CENTRAL_CASTING_CITE_GATE.ongoingKeep], [
    "official",
    "gov",
    "news-org",
    "quote-chain",
  ]);
  assert.match(CENTRAL_CASTING_CITE_GATE.seedOnly, /death_unconfirmed-class/);
  assert.equal(CENTRAL_CASTING_CITE_GATE.screenshot, "omit fail-closed");
  assert.equal(CENTRAL_CASTING_CITE_GATE.detailMedia, "all post media on detail");
});

test("bootstrap sense is NOT NULL and publication adds the table without seeding", () => {
  const sql = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
  const pub = fs.readFileSync(
    path.join(ROOT, "scripts", "add-central-casting-comms-publication.sql"),
    "utf8",
  );
  const create = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS central_casting_comms"));
  const table = create.slice(0, create.indexOf(");") + 2);
  assert.match(table, /sense TEXT NOT NULL/);
  assert.doesNotMatch(table, /\btags?\b/i);
  assert.match(sql, /CHECK \(sense IN \('looks_the_part', 'replacement'\)\)/);
  assert.doesNotMatch(sql, /INSERT INTO central_casting_comms/i);
  assert.match(pub, /ALTER PUBLICATION exittrace_lab_pub ADD TABLE central_casting_comms/);
  assert.match(pub, /copy_data = false/);
  assert.doesNotMatch(pub, /^\s*[^-\n]*copy_data\s*=\s*true/im);
  assert.doesNotMatch(pub, /INSERT INTO central_casting_comms/i);
});

test("invalid sense is rejected and both locked senses insert", async () => {
  setMemory(goldSeed());
  await assert.rejects(
    () => insertKindComm("central_casting", casting({ sense: "" })),
    (err) => err instanceof CentralCastingSenseError,
  );
  await assert.rejects(
    () => insertKindComm("central_casting", casting({ sense: "arrested" })),
    (err) => err instanceof CentralCastingSenseError,
  );
  const looks = await insertKindComm("central_casting", casting());
  const replaced = await insertKindComm("central_casting", replacement());
  assert.equal(looks.sense, "looks_the_part");
  assert.equal(replaced.sense, "replacement");
  assert.equal((await getKindComm("central_casting", looks.id)).sense, "looks_the_part");
});

test("list filter ?sense= and badges; invalid sense is 400", async () => {
  setMemory(goldSeed());
  await insertKindComm("central_casting", casting());
  await insertKindComm("central_casting", replacement());

  const all = await requestPage("/central-casting-comms");
  assert.equal(all.status, 200);
  assert.match(all.body, /central-casting-card/);
  assert.match(all.body, /@nytimes/);
  assert.match(all.body, /@Reuters/);
  assert.match(all.body, /class="sense-badge" data-sense="looks_the_part"/);
  assert.match(all.body, /class="sense-badge" data-sense="replacement"/);
  assert.match(all.body, />Looks the part</);
  assert.match(all.body, />Replacement</);
  assert.match(all.body, /aria-label="Central Casting sense"/);
  assert.match(all.body, /value="\/central-casting-comms" selected/);
  assert.match(all.body, /value="\/central-casting-comms\?sense=looks_the_part"/);
  assert.match(all.body, /value="\/central-casting-comms\?sense=replacement"/);
  assert.match(all.body, /looks the part/i);
  assert.doesNotMatch(all.body, /widgets\.js/);

  const looks = await requestPage("/central-casting-comms?sense=looks_the_part");
  assert.equal(looks.status, 200);
  assert.match(looks.body, /@nytimes/);
  assert.match(looks.body, /data-sense="looks_the_part"/);
  assert.doesNotMatch(looks.body, /@Reuters/);
  assert.match(looks.body, /sense=looks_the_part" selected/);

  const replaced = await requestPage("/central-casting-comms?sense=replacement");
  assert.equal(replaced.status, 200);
  assert.match(replaced.body, /@Reuters/);
  assert.match(replaced.body, /data-sense="replacement"/);
  assert.doesNotMatch(replaced.body, /@nytimes/);

  const bad = await requestPage("/central-casting-comms?sense=arrested");
  assert.equal(bad.status, 400);

  const api = await requestPage("/api/central-casting-comms?sense=looks_the_part");
  assert.equal(api.status, 200);
  const json = JSON.parse(api.body);
  assert.equal(json.central_casting_comms.length, 1);
  assert.equal(json.central_casting_comms[0].sense, "looks_the_part");
  const apiBad = await requestPage("/api/central-casting-comms?sense=nope");
  assert.equal(apiBad.status, 400);

  const child = await requestPage("/central-casting-comms/looks-the-part");
  assert.equal(child.status, 404);
});

test("detail keeps every post still, omits a bad screenshot, and badges sense", async () => {
  const row = casting({
    screenshot: "https://evil.example/shot.jpg",
  });
  const card = kindListRow("central_casting", row);
  assert.match(card, /class="sense-badge" data-sense="looks_the_part"/);
  assert.match(card, /href="\/central-casting-comms\/nytimes-2026-09-17-abc12345"/);
  assert.match(card, /\/media\/thumbs\/central-casting-comms\/nytimes-2026-09-17\.jpg/);
  const html = kindDetail("central_casting", row);
  assert.match(html, /class="detail central-casting-detail"/);
  assert.match(html, /class="sense-badge" data-sense="looks_the_part"/);
  assert.match(html, /src="\/media\/central-casting-comms\/nytimes-2026-09-17\.jpg"/);
  assert.match(html, /src="\/media\/central-casting-comms\/nytimes-2026-09-17-2\.jpg"/);
  assert.match(html, /src="\/media\/central-casting-comms\/nytimes-2026-09-17-3\.jpg"/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(html, /detail-tile--screenshot/);
  assert.match(kindList("central_casting", []), /No rows on this page/);

  const shot = "/media/screenshots/central-casting-comms/nytimes-2026-09-17.png";
  const withShot = kindDetail("central_casting", casting({ screenshot: shot }));
  assert.match(withShot, /detail-tile--screenshot/);
  assert.match(withShot, new RegExp(shot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const support = `${supportingScreenshotPrefix(
    "central-casting-comms",
    "nytimes-2026-09-17-abc12345",
    0,
  )}ally.png`;
  assert.match(support, /\/media\/screenshots\/central-casting-comms\/nytimes-2026-09-17-abc12345\/support\/0\/ally\.png$/);
  const nested = kindDetail(
    "central_casting",
    casting({
      snapshot: {
        stills: ["/media/central-casting-comms/nytimes-2026-09-17-2.jpg"],
        supporting: [
          {
            handle: "@Ally",
            account_name: "Ally",
            text: "Support cite.",
            posted_at: "2026-09-18",
            source_url: "https://x.com/Ally/status/9",
            still: "/media/central-casting-comms/nytimes-2026-09-17-3.jpg",
            screenshot: "/media/screenshots/people/nested/nope.jpg",
          },
        ],
      },
    }),
  );
  assert.match(nested, /nytimes-2026-09-17-3\.jpg/);
  assert.doesNotMatch(nested, /screenshots\/people\/nested\/nope/);
});

test("live detail, search, health total, and home count include central casting", async () => {
  setMemory(goldSeed());
  const row = await insertKindComm(
    "central_casting",
    casting({
      screenshot: "/media/screenshots/central-casting-comms/nytimes-2026-09-17.png",
    }),
  );
  await insertKindComm("central_casting", replacement());
  const detail = await requestPage(`/central-casting-comms/${row.id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.body, /<article class="detail central-casting-detail">/);
  assert.match(detail.body, /class="sense-badge" data-sense="looks_the_part"/);
  assert.match(detail.body, /nytimes-2026-09-17-2\.jpg/);
  assert.match(detail.body, /nytimes-2026-09-17-3\.jpg/);
  assert.match(detail.body, /detail-tile--screenshot/);
  assert.match(detail.body, /class="cite-block"/);

  const hits = await searchCatalog("nytimes");
  assert.ok(hits.some((hit) => hit.type === "central_casting" && hit.row.id === row.id));
  const search = searchBody(
    [{ type: "central_casting", row: casting() }],
    "nytimes",
  );
  assert.match(search, /central-casting-card/);
  assert.match(search, /data-sense="looks_the_part"/);

  const health = await requestPage("/api/health");
  const json = JSON.parse(health.body);
  assert.equal(json.central_casting_comms, 2);
  assert.equal(json.byCategory.central_casting_comms, 2);
  assert.deepEqual(json.central_casting_by_sense, { looks_the_part: 1, replacement: 1 });

  const home = await requestPage("/");
  assert.match(home.body, /2 central casting comms/);
  assert.match(home.body, /data-key="t"/);
  assert.match(home.body, /data-key="c"/);
  assert.match(home.body, /data-key="e"/);
  assert.match(home.body, /\]<\/span> Central Casting</);
});
