import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { dashRankEvents } from "../app/lib/dashboard.mjs";
import { DisplayError, listPathForPerson } from "../app/lib/display-check.mjs";
import { personDetail } from "../app/lib/html.mjs";
import {
  CENTRAL_CASTING_CITE_GATE,
  CENTRAL_CASTING_KEYMAP,
  CENTRAL_CASTING_PATH,
  CENTRAL_CASTING_SENSES,
  CentralCastingClassifyError,
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
  annotateCentralCasting,
  getPerson,
  insertCentralCastingClip,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";
import { handle } from "../app/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITE = "https://www.nytimes.com/2017/05/09/us/politics/james-comey-fired-fbi.html";

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function evidence(overrides = {}) {
  return {
    id: "nytimes-2026-09-17-abc12345",
    role: "evidence",
    person_id: "james-comey",
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
  assert.match(blurb, /Trump “looks the part \/ Hollywood ideal”/);
  assert.match(blurb, /“replacement” claim senses/);
  assert.match(blurb, /filter by sense/);
  assert.match(blurb, /One card per identified person/);
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
  assert.equal(centralCastingCiteStanding({ sourceUrl: "https://x.com/someone/status/1" }), "");
  assert.match(CENTRAL_CASTING_CITE_GATE.seedOnly, /death_unconfirmed-class/);
});

test("bootstrap sense is NOT NULL, glossary person_id is null, and publication does not seed", () => {
  const sql = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
  const pub = fs.readFileSync(
    path.join(ROOT, "scripts", "add-central-casting-comms-publication.sql"),
    "utf8",
  );
  const create = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS central_casting_comms"));
  const table = create.slice(0, create.indexOf(");") + 2);
  assert.match(table, /sense TEXT NOT NULL/);
  assert.match(table, /person_id TEXT/);
  assert.match(table, /role TEXT NOT NULL/);
  assert.match(sql, /CHECK \(sense IN \('looks_the_part', 'replacement'\)\)/);
  assert.match(sql, /role = 'glossary' AND person_id IS NULL/);
  assert.match(sql, /role = 'evidence' AND person_id IS NOT NULL/);
  assert.match(sql, /central_casting JSONB NOT NULL/);
  assert.doesNotMatch(table, /\btags?\b/i);
  assert.doesNotMatch(sql, /INSERT INTO central_casting_comms/i);
  assert.doesNotMatch(sql, /INSERT INTO people/i);
  assert.match(pub, /ALTER PUBLICATION exittrace_lab_pub ADD TABLE central_casting_comms/);
  assert.match(pub, /copy_data = false/);
  assert.doesNotMatch(pub, /^\s*[^-\n]*copy_data\s*=\s*true/im);
  assert.doesNotMatch(pub, /INSERT INTO central_casting_comms/i);
});

test("invalid sense and missing cite are rejected; annotation does not create a person", async () => {
  const seed = goldSeed();
  setMemory(seed);
  const before = seed.people.length;
  await assert.rejects(
    () => annotateCentralCasting("james-comey", { sense: "", sources: [CITE] }),
    (err) => err instanceof CentralCastingSenseError,
  );
  await assert.rejects(
    () => annotateCentralCasting("james-comey", { sense: "arrested", sources: [CITE] }),
    (err) => err instanceof CentralCastingSenseError,
  );
  await assert.rejects(
    () => annotateCentralCasting("james-comey", { sense: "looks_the_part", sources: [] }),
    (err) => err instanceof CentralCastingClassifyError && err.code === "missing_cite",
  );
  await assert.rejects(
    () => annotateCentralCasting("not-a-person", { sense: "replacement", sources: [CITE] }),
    (err) => err instanceof CentralCastingClassifyError && err.code === "missing_person",
  );
  await assert.rejects(
    () => insertCentralCastingClip(evidence({ role: "glossary", person_id: "james-comey" })),
    (err) => err instanceof CentralCastingClassifyError && err.code === "glossary_person",
  );
  await assert.rejects(
    () => insertCentralCastingClip(evidence({ role: "evidence", person_id: "" })),
    (err) => err instanceof CentralCastingClassifyError && err.code === "evidence_person",
  );
  const person = await getPerson("james-comey");
  assert.deepEqual(person.central_casting, []);
  assert.equal(person.events.some((ev) => ev.kind === "central_casting"), false);
  assert.equal((await getPerson("nobody")), null);
  const listed = await requestPage("/central-casting");
  assert.equal(personHrefs(listed.body).length, 0);
  assert.equal(seed.people.length, before);
});

test("unique person cards, dual badges, sense filter, glossary null person, no clip cards", async () => {
  setMemory(goldSeed());
  await insertCentralCastingClip(evidence());
  await insertCentralCastingClip(
    evidence({
      id: "reuters-2026-09-18-def67890",
      sense: "replacement",
      text: "Stored replacement clip.",
      still: "/media/central-casting-comms/reuters-2026-09-18.jpg",
      source_url: "https://x.com/Reuters/status/2100603347044585926",
    }),
  );
  await insertCentralCastingClip({
    id: "glossary-replacement",
    role: "glossary",
    person_id: null,
    sense: "replacement",
    posted_at: "2026-09-01",
    handle: "",
    text: "Replacement definition",
    source_url: "https://www.example.com/jtitor17-definition",
  });
  await insertCentralCastingClip({
    id: "glossary-looks",
    role: "glossary",
    person_id: null,
    sense: "looks_the_part",
    posted_at: "2026-09-01",
    handle: "",
    text: "Looks the part definition",
    source_url: "https://www.example.com/warsh-clip",
  });

  const clipsOnly = await requestPage("/central-casting");
  assert.equal(clipsOnly.status, 200);
  assert.equal(personHrefs(clipsOnly.body).length, 0);
  assert.match(clipsOnly.body, /role="glossary"/);
  assert.match(clipsOnly.body, /data-person-id=""/);
  assert.doesNotMatch(clipsOnly.body, /class="central-casting-card"/);
  assert.doesNotMatch(clipsOnly.body, /Stored central-casting snapshot/);

  await annotateCentralCasting("james-comey", { sense: "looks_the_part", sources: [CITE] });
  await annotateCentralCasting("james-comey", { sense: "replacement", sources: [CITE] });
  await annotateCentralCasting("rex-tillerson", { sense: "replacement", sources: [CITE] });
  const comey = await getPerson("james-comey");
  assert.deepEqual(
    comey.central_casting.map((item) => item.sense),
    ["looks_the_part", "replacement"],
  );
  assert.equal(comey.events.some((ev) => ev.kind === "central_casting"), false);

  const all = await requestPage("/central-casting");
  assert.equal(all.status, 200);
  assert.deepEqual(personHrefs(all.body).sort(), ["/people/james-comey", "/people/rex-tillerson"]);
  assert.equal(all.body.split('href="/people/james-comey"').length - 1, 1);
  assert.match(all.body, /data-sense="looks_the_part"/);
  assert.match(all.body, />Looks the part</);
  assert.match(all.body, /data-sense="replacement"/);
  assert.match(all.body, />Replacement</);
  assert.match(all.body, /value="\/central-casting" selected/);
  assert.match(all.body, /value="\/central-casting\?sense=looks_the_part"/);
  assert.match(all.body, /value="\/central-casting\?sense=replacement"/);
  assert.match(all.body, /role="glossary"/);
  assert.doesNotMatch(all.body, /class="central-casting-card"/);
  assert.doesNotMatch(all.body, /class="central-casting-evidence"/);
  assert.doesNotMatch(all.body, /Stored central-casting snapshot/);

  const looks = await requestPage("/central-casting?sense=looks_the_part");
  assert.deepEqual(personHrefs(looks.body), ["/people/james-comey"]);
  assert.match(looks.body, /data-sense="looks_the_part"/);
  assert.match(looks.body, /data-sense="replacement"/);

  const replaced = await requestPage("/central-casting?sense=replacement");
  assert.deepEqual(personHrefs(replaced.body).sort(), [
    "/people/james-comey",
    "/people/rex-tillerson",
  ]);
  assert.equal(replaced.body.split('href="/people/james-comey"').length - 1, 1);
  assert.equal(replaced.body.split('href="/people/rex-tillerson"').length - 1, 1);

  const bad = await requestPage("/central-casting?sense=arrested");
  assert.equal(bad.status, 400);
  const child = await requestPage("/central-casting/looks-the-part");
  assert.equal(child.status, 404);

  const legacy = await requestPage("/central-casting-comms?sense=replacement");
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.Location, "/central-casting?sense=replacement");

  const api = await requestPage("/api/central-casting?sense=looks_the_part");
  const json = JSON.parse(api.body);
  assert.equal(json.people.length, 1);
  assert.equal(json.people[0].id, "james-comey");
  assert.equal(json.central_casting, 1);

  const shot = "/media/screenshots/central-casting-comms/nytimes-2026-09-17.png";
  await insertCentralCastingClip(
    evidence({
      id: "shot-clip",
      screenshot: shot,
      snapshot: { stills: ["/media/central-casting-comms/nytimes-2026-09-17-2.jpg"] },
    }),
  );
  await insertCentralCastingClip(
    evidence({
      id: "bad-shot",
      screenshot: "/media/screenshots/people/nested/nope.jpg",
    }),
  );
  const detail = await requestPage("/people/james-comey");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /class="detail person-detail"/);
  assert.match(detail.body, /data-sense="looks_the_part"/);
  assert.match(detail.body, /data-sense="replacement"/);
  assert.match(detail.body, /class="central-casting-evidence"/);
  assert.match(detail.body, /src="\/media\/central-casting-comms\/nytimes-2026-09-17\.jpg"/);
  assert.match(detail.body, /src="\/media\/central-casting-comms\/nytimes-2026-09-17-2\.jpg"/);
  assert.match(detail.body, new RegExp(shot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(detail.body, /nested\/nope\.jpg/);
  assert.equal(detail.body.split('href="/people/james-comey"').length - 1, 0);

  const html = personDetail(comey, {
    centralCastingClips: [evidence({ screenshot: shot })],
  });
  assert.match(html, /data-sense="looks_the_part"/);
  assert.match(html, /data-sense="replacement"/);
  assert.match(
    supportingScreenshotPrefix("central-casting-comms", "nytimes-2026-09-17-abc12345", 0),
    /\/media\/screenshots\/central-casting-comms\/nytimes-2026-09-17-abc12345\/support\/0\/$/,
  );

  const health = await requestPage("/api/health");
  const counts = JSON.parse(health.body);
  assert.equal(counts.central_casting, 2);
  assert.equal(counts.byCategory.central_casting, 2);
  assert.equal(counts.central_casting_comms, undefined);
  assert.deepEqual(counts.central_casting_by_sense, { looks_the_part: 1, replacement: 2 });

  const home = await requestPage("/");
  assert.match(home.body, /2 central casting/);
  assert.doesNotMatch(home.body, /central casting comms/);
  assert.match(home.body, /data-key="t"/);
  assert.match(home.body, /href="\/central-casting"/);
});
