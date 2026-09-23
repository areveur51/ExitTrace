import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { dashRankEvents } from "../app/lib/dashboard.mjs";
import { DisplayError, listPathForPerson } from "../app/lib/display-check.mjs";
import { commsDetail, kindDetail, personDetail } from "../app/lib/html.mjs";
import {
  CENTRAL_CASTING_CITE_GATE,
  CENTRAL_CASTING_DETAIL,
  CENTRAL_CASTING_KEYMAP,
  CENTRAL_CASTING_PATH,
  CentralCastingClassifyError,
  KIND_COMMS,
  centralCastingCiteStanding,
  centralCastingStoredQuote,
  mergeCentralCasting,
  normalizeCentralCasting,
} from "../app/lib/kind-comms.mjs";
import {
  DEATH_KEEP_IDS,
  PROMOTE_CATEGORY_IDS,
  categoryByPath,
  mapImportCategory,
} from "../app/lib/categories.mjs";
import { supportingScreenshotPrefix } from "../app/lib/screenshot.mjs";
import {
  annotateCentralCasting,
  getMemory,
  getPerson,
  insertCentralCastingClip,
  listCentralCastingPeople,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";
import { handle } from "../app/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITE = "https://www.nytimes.com/2017/05/09/us/politics/james-comey-fired-fbi.html";
const CITE_2 = "https://www.reuters.com/world/us/james-comey-2017-05-09/";

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function evidence(overrides = {}) {
  return {
    id: "nytimes-2026-09-17-abc12345",
    person_id: "james-comey",
    posted_at: "2026-09-17",
    handle: "@nytimes",
    account_name: "The New York Times",
    text: "Stored central-casting snapshot.",
    still: "/media/central-casting-comms/nytimes-2026-09-17.jpg",
    source_url: "https://x.com/nytimes/status/2100603347044585925",
    snapshot: {
      stills: [
        "/media/central-casting-comms/nytimes-2026-09-17-2.jpg",
        "/media/central-casting-comms/nytimes-2026-09-17-3.jpg",
      ],
      supporting: [
        {
          text: "Supportive still standing on the detail.",
          still: "/media/central-casting-comms/support-2026-09-17.jpg",
          handle: "@Reuters",
          posted_at: "2026-09-17",
          source_url: "https://x.com/Reuters/status/2100603347044585999",
          account_name: "Reuters",
          stills: ["/media/central-casting-comms/support-2026-09-17-2.jpg"],
          screenshot: `${supportingScreenshotPrefix(
            "central-casting-comms",
            "nytimes-2026-09-17-abc12345",
            0,
          )}reuters.png`,
          screenshot_credit: "X",
        },
      ],
    },
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

function personHrefs(body) {
  return [...body.matchAll(/class="tui-row person-card[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
}

test("central casting is a person list, not a KIND_COMMS clip catalog", () => {
  assert.equal(KIND_COMMS.central_casting, undefined);
  assert.equal(KIND_COMMS.dog.keymapKey, "c");
  assert.equal(KIND_COMMS.red_folder.keymapKey, "e");
  assert.equal(CENTRAL_CASTING_KEYMAP, "t");
  assert.equal(CENTRAL_CASTING_PATH, "/central-casting");
  assert.equal(categoryByPath("/central-casting").kind, "central_casting");
  assert.equal(categoryByPath("/central-casting").nav, "Central Casting");
  assert.equal(categoryByPath("/central-casting-comms"), null);
  const blurb = categoryByPath("/central-casting").blurb;
  assert.match(blurb, /One card per identified person/);
  assert.doesNotMatch(blurb, /sense|glossary|looks the part|replacement/i);
  assert.equal(PROMOTE_CATEGORY_IDS.includes("central_casting"), false);
  assert.equal(PROMOTE_CATEGORY_IDS.includes("central_casting_comms"), false);
  assert.equal(DEATH_KEEP_IDS.includes("central_casting"), false);
  assert.equal(mapImportCategory("central_casting"), null);
  assert.equal(mapImportCategory("central_casting_comms"), null);
  assert.throws(() => listPathForPerson("central_casting"), (err) => err instanceof DisplayError);
  assert.throws(() => listPathForPerson("central_casting_comms"), (err) => err instanceof DisplayError);
  const ranked = dashRankEvents({
    events: [
      { kind: "firings", event_date: "2020-01-02", sources: [] },
      { kind: "central_casting", event_date: "2020-01-01", sources: [] },
    ],
  });
  assert.deepEqual(ranked.map((ev) => ev.kind), ["firings"]);
  assert.equal(CENTRAL_CASTING_CITE_GATE.personKeep, false);
  assert.equal(CENTRAL_CASTING_CITE_GATE.senses, undefined);
  assert.equal(CENTRAL_CASTING_DETAIL.supportingGroups, true);
  assert.equal(KIND_COMMS.red_folder.supportingGroups, true);
});

test("cite gate keeps official and quote-chain standing", () => {
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
  assert.equal(centralCastingCiteStanding({ sourceUrl: "https://x.com/someone/status/1" }), "");
  assert.equal(CENTRAL_CASTING_CITE_GATE.seedOnly, undefined);
});

test("legacy sense objects collapse to cite URLs and gold membership is kept", () => {
  assert.deepEqual(
    normalizeCentralCasting([
      { sense: "looks_the_part", sources: [CITE] },
      { sense: "replacement", sources: [CITE, CITE_2] },
    ]),
    [CITE, CITE_2],
  );
  assert.deepEqual(mergeCentralCasting([], [CITE]), [CITE]);
  assert.deepEqual(normalizeCentralCasting([]), []);
});

test("bootstrap drops sense and glossary, and publication does not seed", () => {
  const sql = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
  const pub = fs.readFileSync(
    path.join(ROOT, "scripts", "add-central-casting-comms-publication.sql"),
    "utf8",
  );
  const create = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS central_casting_comms"));
  const table = create.slice(0, create.indexOf(");") + 2);
  assert.match(table, /person_id TEXT NOT NULL/);
  assert.doesNotMatch(table, /sense/);
  assert.doesNotMatch(table, /glossary/);
  assert.doesNotMatch(table, /\brole\b/);
  assert.match(sql, /DROP COLUMN IF EXISTS sense/);
  assert.match(sql, /DROP COLUMN IF EXISTS role/);
  assert.match(sql, /central_casting JSONB NOT NULL/);
  assert.match(sql, /JTitor \+ Warsh/);
  assert.match(sql, /role = 'glossary'\s+AND person_id IS NULL/);
  assert.doesNotMatch(sql, /role = 'glossary' OR person_id IS NULL/);
  assert.doesNotMatch(sql, /DELETE FROM people/i);
  assert.doesNotMatch(sql, /looks_the_part|replacement/);
  assert.doesNotMatch(sql, /INSERT INTO central_casting_comms/i);
  assert.doesNotMatch(sql, /INSERT INTO people/i);
  assert.match(sql, /jsonb_array_length\(migrated\.urls\) > 0/);
  assert.match(pub, /ALTER PUBLICATION exittrace_lab_pub ADD TABLE central_casting_comms/);
  assert.match(pub, /copy_data = false/);
  assert.doesNotMatch(pub, /^\s*[^-\n]*copy_data\s*=\s*true/im);
  assert.doesNotMatch(pub, /INSERT INTO central_casting_comms/i);
  assert.doesNotMatch(pub, /glossary|looks_the_part|sense/i);
  assert.match(sql, /backfill empty Central Casting snippets/);
  assert.match(sql, /SET text = btrim\(quote\)/);
  assert.match(sql, /snapshot->>'quote'/);
  assert.match(sql, /FROM source_posts sp/);
  assert.match(sql, /btrim\(text\) = '0'/);
  assert.doesNotMatch(sql, /INSERT INTO central_casting_comms/i);
});

test("live migration keeps 7 persons and drops only the JTitor and Warsh glossary rows", async () => {
  const seed = goldSeed();
  const members = seed.people.slice(0, 7);
  assert.equal(members.length, 7);
  const before = seed.people.length;
  for (const person of members) {
    person.central_casting = [
      { sense: "looks_the_part", sources: [CITE] },
      { sense: "replacement", sources: [`https://example.com/cc/${person.id}`] },
    ];
  }
  const memberId = members[0].id;
  seed.central_casting_comms = [
    {
      id: "glossary-jtitor",
      role: "glossary",
      person_id: null,
      sense: "replacement",
      posted_at: "2026-09-01",
      handle: "",
      text: "JTitor",
      source_url: "https://www.example.com/jtitor",
    },
    {
      id: "glossary-warsh",
      role: "glossary",
      person_id: null,
      sense: "looks_the_part",
      posted_at: "2026-09-01",
      handle: "",
      text: "Warsh",
      source_url: "https://www.example.com/warsh",
    },
    evidence({
      id: "kept-evidence",
      person_id: memberId,
      role: "evidence",
      sense: "looks_the_part",
      text: "Evidence stays under the person.",
    }),
  ];
  setMemory(seed);
  assert.equal(seed.people.length, before);
  const listed = (await listCentralCastingPeople()).map((row) => row.id).sort();
  assert.deepEqual(listed, members.map((person) => person.id).sort());
  for (const person of members) {
    const row = await getPerson(person.id);
    assert.deepEqual(row.central_casting, [CITE, `https://example.com/cc/${person.id}`]);
    assert.equal(JSON.stringify(row.central_casting).includes("sense"), false);
    assert.equal(row.events.some((ev) => ev.kind === "central_casting"), false);
  }
  const page = await requestPage("/central-casting");
  assert.equal(personHrefs(page.body).length, 7);
  assert.doesNotMatch(page.body, /JTitor|Warsh|glossary|data-sense|sense-badge/i);
  const detail = await requestPage(`/people/${memberId}`);
  assert.match(detail.body, /<h3 class="event-h">Central Casting<\/h3>/);
  assert.match(detail.body, /Evidence stays under the person/);
  assert.match(detail.body, /class="event-snippet"/);
  assert.match(detail.body, /class="sources cite-list"/);
  assert.match(detail.body, /https:\/\/x\.com\/nytimes\/status\/2100603347044585925/);
  assert.doesNotMatch(detail.body, /class="detail central-casting-detail"/);
  assert.doesNotMatch(detail.body, /JTitor|Warsh|glossary|data-sense/i);
  const health = await requestPage("/api/health");
  const counts = JSON.parse(health.body);
  assert.equal(counts.central_casting, 7);
  assert.equal(counts.central_casting_comms, undefined);
});

test("missing cite and glossary are rejected; annotation does not create a person", async () => {
  const seed = goldSeed();
  setMemory(seed);
  const before = seed.people.length;
  await assert.rejects(
    () => annotateCentralCasting("james-comey", { sources: [] }),
    (err) => err instanceof CentralCastingClassifyError && err.code === "missing_cite",
  );
  await assert.rejects(
    () => annotateCentralCasting("not-a-person", { sources: [CITE] }),
    (err) => err instanceof CentralCastingClassifyError && err.code === "missing_person",
  );
  await assert.rejects(
    () => insertCentralCastingClip(evidence({ role: "glossary", person_id: "james-comey" })),
    (err) => err instanceof CentralCastingClassifyError && err.code === "glossary_removed",
  );
  await assert.rejects(
    () => insertCentralCastingClip(evidence({ person_id: "" })),
    (err) => err instanceof CentralCastingClassifyError && err.code === "evidence_person",
  );
  const person = await getPerson("james-comey");
  assert.deepEqual(person.central_casting, []);
  assert.equal(person.events.some((ev) => ev.kind === "central_casting"), false);
  assert.equal(await getPerson("nobody"), null);
  const listed = await requestPage("/central-casting");
  assert.equal(personHrefs(listed.body).length, 0);
  assert.equal(seed.people.length, before);
});

test("unique person cards, one central casting section, no sense filter or glossary", async () => {
  setMemory(goldSeed());
  await insertCentralCastingClip(evidence());
  await insertCentralCastingClip(
    evidence({
      id: "reuters-2026-09-18-def67890",
      text: "Second harvest clip under the same person.",
      still: "/media/central-casting-comms/reuters-2026-09-18.jpg",
      source_url: "https://x.com/Reuters/status/2100603347044585926",
      snapshot: { stills: ["/media/central-casting-comms/reuters-2026-09-18-2.jpg"] },
    }),
  );

  const clipsOnly = await requestPage("/central-casting");
  assert.equal(clipsOnly.status, 200);
  assert.equal(personHrefs(clipsOnly.body).length, 0);
  assert.doesNotMatch(clipsOnly.body, /glossary|data-sense|sense-badge|central-casting-sense/i);
  assert.doesNotMatch(clipsOnly.body, /class="central-casting-card"/);
  assert.doesNotMatch(clipsOnly.body, /Stored central-casting snapshot/);

  await annotateCentralCasting("james-comey", { sources: [CITE] });
  await annotateCentralCasting("james-comey", { sources: [CITE, CITE_2] });
  await annotateCentralCasting("rex-tillerson", { sources: [CITE] });
  const comey = await getPerson("james-comey");
  assert.deepEqual(comey.central_casting, [CITE, CITE_2]);
  assert.equal(comey.central_casting.some((item) => item && item.sense), false);
  assert.equal(comey.events.some((ev) => ev.kind === "central_casting"), false);

  const all = await requestPage("/central-casting");
  assert.equal(all.status, 200);
  assert.match(all.body, /class="people-list tui-list"/);
  assert.deepEqual(personHrefs(all.body).sort(), ["/people/james-comey", "/people/rex-tillerson"]);
  assert.equal(all.body.split('href="/people/james-comey"').length - 1, 1);
  assert.doesNotMatch(all.body, /data-sense|sense-badge|glossary|looks_the_part|Looks the part/i);
  assert.doesNotMatch(all.body, /class="central-casting-card"/);
  assert.doesNotMatch(all.body, /class="central-casting-evidence"/);
  assert.doesNotMatch(all.body, /Stored central-casting snapshot/);

  const ignored = await requestPage("/central-casting?sense=looks_the_part");
  assert.equal(ignored.status, 200);
  assert.deepEqual(personHrefs(ignored.body).sort(), [
    "/people/james-comey",
    "/people/rex-tillerson",
  ]);
  assert.doesNotMatch(ignored.body, /data-sense|sense-badge|glossary/i);

  const junk = await requestPage("/central-casting?sense=arrested");
  assert.equal(junk.status, 200);
  assert.equal(personHrefs(junk.body).length, 2);
  const child = await requestPage("/central-casting/looks-the-part");
  assert.equal(child.status, 404);

  const legacy = await requestPage("/central-casting-comms?sense=replacement&page=1");
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.Location, "/central-casting?page=1");

  const api = await requestPage("/api/central-casting?sense=looks_the_part");
  const json = JSON.parse(api.body);
  assert.equal(json.people.length, 2);
  assert.equal(json.central_casting, 2);
  assert.equal(json.central_casting_by_sense, undefined);

  const shot = "/media/screenshots/central-casting-comms/nytimes-2026-09-17.png";
  await insertCentralCastingClip(
    evidence({
      id: "shot-clip",
      screenshot: shot,
      text: "Screenshot clip standing on the detail.",
      snapshot: { stills: ["/media/central-casting-comms/nytimes-2026-09-17-2.jpg"] },
    }),
  );
  await insertCentralCastingClip(
    evidence({
      id: "bad-shot",
      text: "Bad screenshot is omitted.",
      screenshot: "/media/screenshots/people/nested/nope.jpg",
      snapshot: {},
    }),
  );
  const detail = await requestPage("/people/james-comey");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /class="detail person-detail"/);
  assert.match(detail.body, /class="people-list"|class="sources cite-list"/);
  assert.match(detail.body, /class="sources cite-list"/);
  assert.match(detail.body, new RegExp(CITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((detail.body.match(/<h3 class="event-h">Central Casting<\/h3>/g) || []).length, 1);
  assert.match(detail.body, /data-section="person-event"/);
  assert.match(detail.body, /class="event-snippet">Stored central-casting snapshot/);
  assert.match(detail.body, /https:\/\/x\.com\/nytimes\/status\/2100603347044585925/);
  assert.match(detail.body, /src="\/media\/central-casting-comms\/nytimes-2026-09-17\.jpg"/);
  assert.match(detail.body, /src="\/media\/central-casting-comms\/nytimes-2026-09-17-2\.jpg"/);
  assert.match(detail.body, /src="\/media\/central-casting-comms\/support-2026-09-17\.jpg"/);
  assert.match(detail.body, /src="\/media\/central-casting-comms\/support-2026-09-17-2\.jpg"/);
  assert.match(detail.body, new RegExp(shot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(detail.body, /Second harvest clip under the same person/);
  assert.doesNotMatch(detail.body, /class="detail central-casting-detail"/);
  assert.doesNotMatch(detail.body, /nested\/nope\.jpg/);
  assert.doesNotMatch(detail.body, /data-sense|sense-badge|glossary|looks_the_part/i);
  assert.equal(detail.body.split('href="/people/james-comey"').length - 1, 0);
  assert.equal(detail.body.split('class="tui-row person-card').length - 1, 0);
  const portraitAt = detail.body.indexOf('class="person-header"');
  const castingAt = detail.body.indexOf(">Central Casting<");
  assert.ok(portraitAt >= 0 && castingAt > portraitAt);

  const folder = kindDetail("red_folder", {
    ...evidence(),
    still: "/media/red-folder-comms/nytimes-2026-09-17.jpg",
    snapshot: {
      stills: [],
      supporting: [
        {
          text: "Red folder support.",
          still: "/media/red-folder-comms/support.jpg",
          handle: "@Reuters",
          posted_at: "2026-09-17",
          source_url: "https://x.com/Reuters/status/2100603347044585999",
          account_name: "Reuters",
        },
      ],
    },
  });
  const clipHtml = commsDetail(CENTRAL_CASTING_DETAIL, evidence({ screenshot: shot }));
  for (const marker of [
    'class="cite-block"',
    'class="post-text"',
    "Source ·",
    'class="supporting-group"',
    'class="detail-media detail-media--masonry"',
  ]) {
    assert.match(folder, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(clipHtml, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const html = personDetail(comey, {
    centralCastingClips: [evidence({ screenshot: shot })],
  });
  assert.match(html, /class="sources cite-list"/);
  assert.match(html, /<h3 class="event-h">Central Casting<\/h3>/);
  assert.match(html, /class="event-snippet">Stored central-casting snapshot/);
  assert.match(html, /data-section="person-event"/);
  assert.doesNotMatch(html, /class="detail central-casting-detail"/);
  assert.doesNotMatch(html, /data-sense|glossary/i);
  assert.match(
    supportingScreenshotPrefix("central-casting-comms", "nytimes-2026-09-17-abc12345", 0),
    /\/media\/screenshots\/central-casting-comms\/nytimes-2026-09-17-abc12345\/support\/0\/$/,
  );

  const health = await requestPage("/api/health");
  const counts = JSON.parse(health.body);
  assert.equal(counts.central_casting, 2);
  assert.equal(counts.byCategory.central_casting, 2);
  assert.equal(counts.central_casting_comms, undefined);
  assert.equal(counts.central_casting_by_sense, undefined);

  const home = await requestPage("/");
  assert.match(home.body, /2 central casting/);
  assert.doesNotMatch(home.body, /central casting comms/);
  assert.match(home.body, /data-key="t"/);
  assert.match(home.body, /href="\/central-casting"/);
});

test("jim-mattis central casting section uses evidence cites and hides an empty corona section", async () => {
  setMemory(goldSeed());
  const quote = "He looks like he is out of central casting.";
  const xUrl = "https://x.com/realDonaldTrump/status/1071495799875203073";
  await annotateCentralCasting("jim-mattis", {
    sources: ["https://www.nytimes.com/2018/12/20/us/politics/jim-mattis-defense-secretary-trump.html"],
  });
  await insertCentralCastingClip({
    id: "mattis-central-casting",
    person_id: "jim-mattis",
    posted_at: "2018-12-20",
    handle: "@realDonaldTrump",
    account_name: "Donald J. Trump",
    text: quote,
    source_url: xUrl,
    snapshot: {},
  });

  const page = await requestPage("/people/jim-mattis");
  assert.equal(page.status, 200);
  assert.match(page.body, /class="person-header"/);
  assert.match(page.body, /<h3 class="event-h">Resignations<\/h3>/);
  assert.equal((page.body.match(/<h3 class="event-h">Central Casting<\/h3>/g) || []).length, 1);
  assert.match(page.body, /class="person-event-section"/);
  assert.match(page.body, /data-section="person-event"/);
  assert.match(page.body, new RegExp(xUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    page.body,
    /<blockquote class="event-snippet">He looks like he is out of central casting\.<\/blockquote><a class="source-link" href="https:\/\/x\.com\/realDonaldTrump\/status\/1071495799875203073"/,
  );
  assert.doesNotMatch(page.body, /<h3 class="event-h">Corona<\/h3>/);
  assert.doesNotMatch(page.body, /class="detail central-casting-detail"/);
  const headerAt = page.body.indexOf('class="person-header"');
  const resignAt = page.body.indexOf('<h3 class="event-h">Resignations</h3>');
  const castingAt = page.body.indexOf('<h3 class="event-h">Central Casting</h3>');
  assert.ok(headerAt >= 0 && resignAt > headerAt && castingAt > resignAt);
  const section = page.body.slice(castingAt, page.body.indexOf("</section>", castingAt));
  assert.match(section, /He looks like he is out of central casting\./);
  assert.doesNotMatch(page.body.slice(0, castingAt), /He looks like he is out of central casting\./);

  const list = await requestPage("/central-casting");
  assert.equal(list.status, 200);
  assert.equal(personHrefs(list.body).filter((href) => href === "/people/jim-mattis").length, 1);

  const bare = personDetail(await getPerson("rex-tillerson"));
  assert.doesNotMatch(bare, /<h3 class="event-h">Central Casting<\/h3>/);
  assert.doesNotMatch(bare, /<h3 class="event-h">Corona<\/h3>/);

  const corona = personDetail({
    id: "casey-corona",
    name: "Casey Corona",
    category: "corona_comms",
    event_date: "2024-07-20",
    sources: [
      {
        publisher: "BBC News",
        title: "Corona note",
        url: "https://www.bbc.com/news/casey-corona",
        date: "2024-07-20",
      },
      {
        publisher: "Reuters",
        title: "Corona follow",
        url: "https://www.reuters.com/world/casey-corona",
        date: "2024-07-20",
      },
    ],
  });
  assert.match(corona, /<h3 class="event-h">Corona<\/h3>/);
  assert.match(corona, /data-kind="corona_comms"/);
  assert.match(corona, /data-section="person-event"/);
  assert.match(corona, /https:\/\/www\.bbc\.com\/news\/casey-corona/);
  assert.match(corona, /class="event-snippet">Corona note/);
  assert.match(corona, /class="event-snippet">Corona follow/);
  assert.doesNotMatch(corona, /<h3 class="event-h">Corona Comms<\/h3>/);
  assert.doesNotMatch(corona, /<h3 class="event-h">Central Casting<\/h3>/);
  assert.match(corona, /class="event-tag-row"/);
  const coronaOnly = corona.match(/<article class="event-tag-row"[\s\S]*?<\/article>/g) || [];
  assert.equal(coronaOnly.length, 1);
  assert.match(coronaOnly[0], /data-kind="corona_comms"/);
  assert.match(
    coronaOnly[0],
    /<a class="source-link"[\s\S]*<blockquote class="event-snippet">Corona note<\/blockquote>/,
  );
});

test("central casting pairs each stored quote immediately before its cite", async () => {
  assert.equal(centralCastingStoredQuote({ text: "0" }), "");
  assert.equal(centralCastingStoredQuote({ text: "  " }), "");
  assert.equal(
    centralCastingStoredQuote({ text: "0", snapshot: { quote: "He looks like he is out of central casting." } }),
    "He looks like he is out of central casting.",
  );
  assert.equal(centralCastingStoredQuote({ text: "", quote: "0", body: "0" }), "");

  const xUrl = "https://x.com/realDonaldTrump/status/1071495799875203073";
  const news = "https://www.nytimes.com/2018/12/20/us/politics/jim-mattis-defense-secretary-trump.html";
  const other = "https://www.bbc.com/news/world-us-canada-46644841";
  const secondUrl = "https://x.com/realDonaldTrump/status/1076663817831153664";
  const quote = "He looks like he is out of central casting.";
  const second = "When President Obama ingloriously fired Jim Mattis, I gave him a second chance.";
  const html = personDetail(
    {
      id: "jim-mattis",
      name: "Jim Mattis",
      category: "resignations",
      event_date: "2018-12-20",
      sources: [
        { publisher: "The New York Times", title: "Resigns", url: news, date: "2018-12-20" },
        { publisher: "BBC News", title: "Resigns", url: other, date: "2018-12-21" },
      ],
      central_casting: [news, other],
    },
    {
      centralCastingClips: [
        {
          id: "mattis-quote",
          person_id: "jim-mattis",
          posted_at: "2018-12-20",
          handle: "@realDonaldTrump",
          account_name: "Donald J. Trump",
          text: "0",
          source_url: xUrl,
          snapshot: { quote },
        },
        {
          id: "mattis-second",
          person_id: "jim-mattis",
          posted_at: "2018-12-23",
          handle: "@realDonaldTrump",
          account_name: "Donald J. Trump",
          text: "",
          source_url: secondUrl,
          snapshot: { body: second },
        },
        {
          id: "mattis-empty",
          person_id: "jim-mattis",
          posted_at: "2018-12-24",
          handle: "@realDonaldTrump",
          account_name: "Donald J. Trump",
          text: "0",
          source_url: "https://x.com/realDonaldTrump/status/1268344372648718337",
          snapshot: {},
        },
      ],
    },
  );
  const section = html.slice(
    html.indexOf('<h3 class="event-h">Central Casting</h3>'),
    html.indexOf("</section>", html.indexOf("data-kind=\"central_casting\"")),
  );
  assert.match(
    section,
    new RegExp(
      `<blockquote class="event-snippet">${quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</blockquote><a class="source-link" href="${xUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );
  assert.match(
    section,
    new RegExp(
      `<blockquote class="event-snippet">${second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</blockquote><a class="source-link" href="${secondUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    ),
  );
  const items = section.match(/<li>[\s\S]*?<\/li>/g) || [];
  assert.equal(items.length, 5);
  const newsItem = items.find((item) => item.includes(news));
  const emptyItem = items.find((item) => item.includes("1268344372648718337"));
  assert.ok(newsItem);
  assert.doesNotMatch(newsItem, /event-snippet|He looks like he is out of central casting/);
  assert.match(emptyItem, new RegExp(String.raw`href="https://x\.com/realDonaldTrump/status/1268344372648718337"`));
  assert.doesNotMatch(emptyItem, /event-snippet|>0</);
  assert.equal((section.match(/He looks like he is out of central casting\./g) || []).length, 1);
  assert.doesNotMatch(section.slice(0, section.indexOf("<ol")), /event-snippet|He looks like he is out of central casting/);
  const firstQuoteAt = section.indexOf(quote);
  const firstLinkAt = section.indexOf(xUrl);
  const secondQuoteAt = section.indexOf(second);
  const secondLinkAt = section.indexOf(secondUrl);
  assert.ok(firstQuoteAt >= 0 && firstQuoteAt < firstLinkAt);
  assert.ok(secondQuoteAt > firstLinkAt && secondQuoteAt < secondLinkAt);
});

test("empty central casting text backfills from the archived post with the same URL", async () => {
  const seed = goldSeed();
  const xUrl = "https://x.com/realDonaldTrump/status/1071495799875203073";
  const quote = "He looks like he is out of central casting.";
  seed.central_casting_comms = [
    {
      id: "mattis-archived",
      person_id: "jim-mattis",
      posted_at: "2018-12-20",
      handle: "@realDonaldTrump",
      account_name: "Donald J. Trump",
      text: "0",
      source_url: xUrl,
      snapshot: {},
    },
  ];
  seed.source_posts = [
    {
      id: "sp-mattis-casting",
      category: "resignations",
      source_url: "https://twitter.com/realDonaldTrump/status/1071495799875203073",
      text: quote,
      poster_handle: "realDonaldTrump",
      posted_at: "2018-12-20",
    },
  ];
  setMemory(seed);
  await annotateCentralCasting("jim-mattis", {
    sources: ["https://www.nytimes.com/2018/12/20/us/politics/jim-mattis-defense-secretary-trump.html"],
  });
  const page = await requestPage("/people/jim-mattis");
  assert.ok(
    page.body.includes(
      `<blockquote class="event-snippet">${quote}</blockquote><a class="source-link" href="${xUrl}"`,
    ),
  );
  const evidenceRow = getMemory().central_casting_comms.find((row) => row.id === "mattis-archived");
  assert.equal(evidenceRow.text, quote);
  const news = page.body.slice(page.body.indexOf("data-kind=\"central_casting\""));
  const newsItem = (news.match(/<li>[\s\S]*?<\/li>/g) || []).find((item) => item.includes("nytimes.com"));
  assert.ok(newsItem);
  assert.doesNotMatch(newsItem, /event-snippet/);
});
