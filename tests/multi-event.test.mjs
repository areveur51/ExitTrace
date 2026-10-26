import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KIND_EVENT_SECTIONS, personDetail, kindEventsHtml } from "../app/lib/html.mjs";
import {
  REPEATABLE_EVENT_KINDS,
  attachPersonEvent,
  eventKey,
  eventSeq,
  eventsOfKind,
  isRepeatableKind,
  projectPerson,
} from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { assertMultiNotableReady, getPerson, listPeople, multiEventWritesEnabled, savePerson, setMemory, syncPersonEvents } from "../app/lib/store.mjs";

// These tests model a database after F7 (both sides migrated): the operator switch is on.
// The off-by-default case is its own test in tests/multi-event.test.mjs.
process.env.ET_MULTI_EVENT_WRITES = "on";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const AP = (slug, date) => ({ url: `https://apnews.com/article/${slug}`, publisher: "AP", title: slug, date });
const X = (handle, id, date) => ({ url: `https://x.com/${handle}/status/${id}`, publisher: `X (@${handle})`, date });

function keith() {
  return {
    id: "multi-keith",
    name: "Multi Keith",
    category: "notable",
    event_date: "2026-03-04",
    events: [
      { kind: "notable", seq: 0, event_date: "2026-03-04", comments: "Roll call 83 vote.", sources: [AP("roll-83", "2026-03-04")] },
      { kind: "endorsement", event_date: "2025-10-25", comments: "Endorsed.", sources: [AP("endorse", "2025-10-25")] },
    ],
  };
}

function melania() {
  return {
    id: "multi-melania",
    name: "Multi Melania",
    category: "corona_comms",
    event_date: "2020-10-01",
    events: [{ kind: "corona_comms", event_date: "2020-10-01", sources: [AP("covid", "2020-10-01")] }],
  };
}

const RF_A = {
  kind: "red_folder",
  event_date: "2024-06-13",
  comments: "On June 13, 2024, a post showed a red folder at the base of a lectern.",
  sources: [X("DanScavino", "1801362716503720098", "2024-06-13"), { url: "https://www.nytimes.com/2023/11/01/us/politics/trump-14th-amendment-case.html", publisher: "The New York Times", date: "2023-11-01" }],
  media: [
    { src: "/media/people/multi-melania/support/photo3.jpg", alt: "A red folder leans against the lectern", context: "Photo from post by @DanScavino on X, June 13, 2024", url: "https://x.com/DanScavino/status/1801362716503720098" },
    { src: "/media/people/multi-melania/support/nyt.jpg", alt: "Image from The New York Times", context: "Image from The New York Times, November 1, 2023", url: "https://www.nytimes.com/2023/11/01/us/politics/trump-14th-amendment-case.html" },
  ],
};
const RF_B = {
  kind: "red_folder",
  event_date: "2025-12-17",
  comments: "On December 17, 2025, a video posted on X showed a red folder.",
  sources: [X("MELANIATRUMP", "2001266577077837917", "2025-12-17")],
  media: [{ src: "/media/people/multi-melania/support/shot.jpg", alt: "Post on X", context: "Post by @MELANIATRUMP on X, December 17, 2025", url: "https://x.com/MELANIATRUMP/status/2001266577077837917" }],
};

test("multi-event: notable and red_folder repeat; every other kind stays one per kind", () => {
  assert.deepEqual([...REPEATABLE_EVENT_KINDS], ["notable", "red_folder"]);
  assert.equal(isRepeatableKind("red_folder"), true);
  assert.equal(isRepeatableKind("firings"), false);
  assert.equal(eventKey({ kind: "red_folder", seq: 2 }), "red_folder:2");
  assert.equal(eventKey({ kind: "firings", seq: 2 }), "firings");
  assert.equal(eventSeq({ kind: "firings", seq: 3 }), 0, "a non-repeatable kind never stores seq > 0");
});

test("multi-event: several notables on one person get seq 0..n, newest drives the headline", () => {
  let p = projectPerson(keith());
  p = attachPersonEvent(p, { kind: "notable", event_date: "2026-10-05", comments: "Arrest in plot against Self.", sources: [AP("plot", "2026-10-22")] }).person;
  p = attachPersonEvent(p, { kind: "notable", event_date: "2026-10-21", comments: "Self thanked the FBI.", sources: [X("RepKeithSelf", "2113020911939121275", "2026-10-21")] }).person;
  const notables = eventsOfKind(p.events, "notable");
  assert.deepEqual(notables.map((ev) => [ev.event_date, ev.seq]), [["2026-10-21", 2], ["2026-10-05", 1], ["2026-03-04", 0]]);
  assert.equal(p.category, "notable");
  assert.equal(p.event_date, "2026-10-21");
  // Same date plus an overlapping cite folds into the stored notable (no new seq).
  const again = attachPersonEvent(p, { kind: "notable", event_date: "2026-10-05", sources: [AP("plot", "2026-10-22"), AP("plot-2", "2026-10-22")] });
  assert.equal(again.existed, true);
  assert.equal(eventsOfKind(again.person.events, "notable").length, 3);
  const html = personDetail(p, {});
  for (const text of ["Roll call 83 vote.", "Arrest in plot against Self.", "Self thanked the FBI."]) assert.ok(html.includes(text), text);
});

test("multi-event: several red_folder events on one person; headline unchanged; a Red Folder block each", () => {
  let p = projectPerson(melania());
  p = attachPersonEvent(p, RF_A).person;
  p = attachPersonEvent(p, RF_B).person;
  assert.deepEqual(eventsOfKind(p.events, "red_folder").map((ev) => [ev.event_date, ev.seq]), [["2025-12-17", 1], ["2024-06-13", 0]]);
  assert.equal(p.category, "corona_comms", "red_folder never takes the headline");
  assert.equal(p.event_date, "2020-10-01");
  const html = personDetail(p, {});
  assert.ok(html.includes(RF_A.comments));
  assert.ok(html.includes(RF_B.comments));
  assert.equal((html.match(/<section class="detail-red-folder detail-supporting" data-kind="red_folder"/g) || []).length, 2);
  assert.equal((html.match(/<h3 class="event-h">Red Folder<\/h3>/g) || []).length, 2);
  for (const m of [...RF_A.media, ...RF_B.media]) assert.ok(html.includes(m.context), `caption ${m.context}`);
  assert.doesNotMatch(html, /· red_folder/, "no raw kind in the source label");
  assert.match(html, /Jun 13, 2024 · Red Folder/);
  // The media sit in the Red Folder blocks, not in the generic supporting block.
  const blocks = kindEventsHtml(p, "red_folder");
  for (const m of [...RF_A.media, ...RF_B.media]) {
    const n = (html.match(new RegExp(m.src.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g")) || []).length;
    const inBlocks = (blocks.match(new RegExp(m.src.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g")) || []).length;
    assert.ok(inBlocks > 0 && n === inBlocks, `${m.src} only in the Red Folder block (${n} vs ${inBlocks})`);
  }
  // The same red folder twice (same date, overlapping cite) folds.
  const again = attachPersonEvent(p, { ...RF_A, media: [] });
  assert.equal(again.existed, true);
  assert.equal(eventsOfKind(again.person.events, "red_folder").length, 2);
});

test("multi-event: a single red_folder event renders one Red Folder block and keeps the stored headline", () => {
  const p = attachPersonEvent(projectPerson(melania()), RF_B).person;
  assert.equal(p.category, "corona_comms");
  const html = personDetail(p, {});
  assert.equal((html.match(/data-kind="red_folder" data-section="person-event"/g) || []).length, 1);
  assert.ok(html.includes("Post by @MELANIATRUMP on X, December 17, 2025"));
});

test("multi-event: single-event behaviour is unchanged for other kinds", () => {
  const base = { id: "multi-casey", name: "Multi Casey", category: "firings", event_date: "2017-05-09", events: [{ kind: "firings", event_date: "2017-05-09", sources: [AP("fired", "2017-05-09")] }] };
  const p = attachPersonEvent(projectPerson(base), { kind: "firings", event_date: "2018-01-01", sources: [AP("fired-2", "2018-01-01")] });
  assert.equal(p.existed, true, "a second firings event merges into the first");
  const firings = p.person.events.filter((ev) => ev.kind === "firings");
  assert.equal(firings.length, 1);
  assert.equal(firings[0].event_date, "2017-05-09", "the stored date stays");
  assert.equal("seq" in firings[0], false, "no seq on a non-repeatable kind");
  assert.equal(p.person.category, "firings");
});

test("multi-event: memory store keeps every seq across save and read; API and the notable list show them", async () => {
  let k = projectPerson(keith());
  k = attachPersonEvent(k, { kind: "notable", event_date: "2026-10-05", comments: "Arrest in plot against Self.", sources: [AP("plot", "2026-10-22")] }).person;
  let m = attachPersonEvent(attachPersonEvent(projectPerson(melania()), RF_A).person, RF_B).person;
  setMemory({ people: [keith(), melania()] });
  await savePerson(k);
  await savePerson(m);
  const k2 = await getPerson("multi-keith");
  const m2 = await getPerson("multi-melania");
  assert.deepEqual(eventsOfKind(k2.events, "notable").map((ev) => ev.seq), [1, 0]);
  assert.deepEqual(eventsOfKind(m2.events, "red_folder").map((ev) => ev.seq), [1, 0]);
  const notable = await listPeople("notable");
  assert.equal(notable.filter((row) => row.id === "multi-keith").length, 1, "listed once on the notable list");
  const api = await new Promise((resolve, reject) => {
    const chunks = [];
    const res = { headersSent: false, statusCode: 0, setHeader() {}, writeHead(s) { this.statusCode = s; }, end(b) { if (b) chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); resolve({ status: this.statusCode || 200, body: Buffer.concat(chunks).toString("utf8") }); } };
    handle({ method: "GET", url: "/api/people", headers: { host: "127.0.0.1" } }, res).catch(reject);
  });
  assert.equal(api.status, 200);
  const people = JSON.parse(api.body).people;
  const mk = people.find((row) => row.id === "multi-melania");
  assert.deepEqual(mk.events.filter((ev) => ev.kind === "red_folder").map((ev) => ev.seq).sort(), [0, 1]);
  // Person page through the server: both notables and both Red Folder blocks.
  for (const [id, needles] of [["multi-keith", ["Roll call 83 vote.", "Arrest in plot against Self."]], ["multi-melania", [RF_A.comments, RF_B.comments]]]) {
    const page = await new Promise((resolve, reject) => {
      const chunks = [];
      const res = { headersSent: false, statusCode: 0, setHeader() {}, writeHead(s) { this.statusCode = s; }, end(b) { if (b) chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); resolve({ status: this.statusCode || 200, body: Buffer.concat(chunks).toString("utf8") }); } };
      handle({ method: "GET", url: `/people/${id}`, headers: { host: "127.0.0.1" } }, res).catch(reject);
    });
    assert.equal(page.status, 200, id);
    for (const text of needles) assert.ok(page.body.includes(text.replace(/'/g, "&#39;")) || page.body.includes(text), `${id}: ${text}`);
  }
});

function fakeClient({ pkHasSeq, notableOnly, pk }) {
  const calls = [];
  const keyCols = pk || (pkHasSeq ? ["person_id", "kind", "seq"] : ["person_id", "kind"]);
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (/FROM pg_constraint c .*JOIN pg_attribute/.test(text)) return { rows: keyCols.map((attname) => ({ attname })) };
      if (/person_events_seq_notable_only/.test(text)) return { rows: notableOnly ? [{ "?column?": 1 }] : [] };
      return { rows: [] };
    },
  };
}

test("multi-event: the write guard refuses seq > 0 until this database has the migration", async () => {
  const two = attachPersonEvent(attachPersonEvent(projectPerson(melania()), RF_A).person, RF_B).person;
  const k = attachPersonEvent(projectPerson(keith()), { kind: "notable", event_date: "2026-10-05", sources: [AP("plot", "2026-10-22")] }).person;
  await assert.rejects(assertMultiNotableReady(fakeClient({ pkHasSeq: false }), two), { code: "multi_notable_needs_phase_b" });
  await assert.rejects(assertMultiNotableReady(fakeClient({ pkHasSeq: false }), k), { code: "multi_notable_needs_phase_b" });
  await assert.rejects(assertMultiNotableReady(fakeClient({ pkHasSeq: true, notableOnly: true }), two), { code: "multi_event_needs_migration" });
  await assertMultiNotableReady(fakeClient({ pkHasSeq: true, notableOnly: true }), k);
  await assertMultiNotableReady(fakeClient({ pkHasSeq: true, notableOnly: false }), two);
  // One red_folder (seq 0) needs nothing: no catalog query at all.
  const one = attachPersonEvent(projectPerson(melania()), RF_B).person;
  const c = fakeClient({ pkHasSeq: false });
  await assertMultiNotableReady(c, one);
  assert.equal(c.calls.length, 0);
});

test("multi-event: ET_MULTI_EVENT_WRITES is off by default and seq > 0 needs both the switch and the migrated key", async () => {
  const two = attachPersonEvent(attachPersonEvent(projectPerson(melania()), RF_A).person, RF_B).person;
  const k = attachPersonEvent(projectPerson(keith()), { kind: "notable", event_date: "2026-10-05", sources: [AP("plot", "2026-10-22")] }).person;
  const migrated = () => fakeClient({ pkHasSeq: true, notableOnly: false });
  for (const env of [{}, { ET_MULTI_EVENT_WRITES: "" }, { ET_MULTI_EVENT_WRITES: "1" }, { ET_MULTI_EVENT_WRITES: "true" }, { ET_MULTI_EVENT_WRITES: "off" },
    { ET_MULTI_EVENT_WRITES: " on " }, { ET_MULTI_EVENT_WRITES: "on " }, { ET_MULTI_EVENT_WRITES: " on" }, { ET_MULTI_EVENT_WRITES: "on\n" },
    { ET_MULTI_EVENT_WRITES: "\ton" }, { ET_MULTI_EVENT_WRITES: "ON" }, { ET_MULTI_EVENT_WRITES: "On" }, { ET_MULTI_EVENT_WRITES: "yes" }]) {
    for (const p of [two, k]) {
      const c = migrated();
      await assert.rejects(assertMultiNotableReady(c, p, env), { code: "multi_event_writes_off" }, JSON.stringify(env));
      assert.equal(c.calls.length, 0, "switch off refuses before any catalog query");
    }
  }
  // Switch on but the key is still (person_id, kind): still refused.
  await assert.rejects(assertMultiNotableReady(fakeClient({ pkHasSeq: false }), k, { ET_MULTI_EVENT_WRITES: "on" }), { code: "multi_notable_needs_phase_b" });
  // Both: allowed.
  await assertMultiNotableReady(migrated(), two, { ET_MULTI_EVENT_WRITES: "on" });
  // seq 0 only (one red_folder) needs neither.
  const one = attachPersonEvent(projectPerson(melania()), RF_B).person;
  await assertMultiNotableReady(fakeClient({ pkHasSeq: false }), one, {});
  // syncPersonEvents reads process.env: off refuses before the DELETE.
  const saved = process.env.ET_MULTI_EVENT_WRITES;
  delete process.env.ET_MULTI_EVENT_WRITES;
  try {
    const c = migrated();
    await assert.rejects(syncPersonEvents(c, two), { code: "multi_event_writes_off" });
    assert.equal(c.calls.filter((x) => /DELETE|INSERT/.test(x.text)).length, 0);
  } finally {
    process.env.ET_MULTI_EVENT_WRITES = saved;
  }
});

test("multi-event: ET_MULTI_EVENT_WRITES must be exactly 'on' (no trim, no case folding) (Worf B-7)", () => {
  assert.equal(multiEventWritesEnabled({ ET_MULTI_EVENT_WRITES: "on" }), true);
  for (const v of [undefined, "", " on ", "on ", " on", "on\n", "\ton", "ON", "On", "oN", "on\u00a0", "1", "true"]) {
    assert.equal(multiEventWritesEnabled({ ET_MULTI_EVENT_WRITES: v }), false, JSON.stringify(v));
  }
});

test("multi-event: the guard accepts only the exact key (person_id, kind, seq) of public.person_events (Worf B-5)", async () => {
  const k = attachPersonEvent(projectPerson(keith()), { kind: "notable", event_date: "2026-10-05", sources: [AP("plot", "2026-10-22")] }).person;
  const on = { ET_MULTI_EVENT_WRITES: "on" };
  for (const pk of [["person_id", "kind"], ["person_id", "seq"], ["seq", "person_id", "kind"], ["kind", "person_id", "seq"],
    ["person_id", "kind", "seq", "event_date"], ["person_id", "kind", "seq", "seq"], ["seq"], []]) {
    await assert.rejects(assertMultiNotableReady(fakeClient({ pk, notableOnly: false }), k, on), { code: "multi_notable_needs_phase_b" }, JSON.stringify(pk));
  }
  const c = fakeClient({ pk: ["person_id", "kind", "seq"], notableOnly: false });
  await assertMultiNotableReady(c, k, on);
  const catalog = c.calls.map((x) => x.text).filter((t) => /pg_constraint/.test(t));
  assert.ok(catalog.length >= 1);
  for (const t of catalog) {
    assert.match(t, /to_regclass\('public\.person_events'\)/, "schema-qualified, not search_path");
    assert.doesNotMatch(t, /to_regclass\('person_events'\)/);
  }
  assert.match(catalog[0], /WITH ORDINALITY[\s\S]*ORDER BY k\.ord/, "the key is read in key order");
});

test("multi-event: every repeatable kind has exactly one person-page section, and every section is a repeatable kind (O'Brien)", () => {
  const kinds = KIND_EVENT_SECTIONS.map((s) => s.kind);
  assert.deepEqual([...kinds].sort(), [...REPEATABLE_EVENT_KINDS].sort());
  assert.equal(new Set(kinds).size, kinds.length, "no kind twice");
  for (const s of KIND_EVENT_SECTIONS) {
    assert.equal(typeof s.title, "function", s.kind);
    assert.match(s.className, /\bdetail-supporting\b/, s.kind);
  }
  assert.ok(Object.isFrozen(KIND_EVENT_SECTIONS));
});

test("multi-event: syncPersonEvents writes one companion row per (kind, seq)", async () => {
  const two = attachPersonEvent(attachPersonEvent(projectPerson(melania()), RF_A).person, RF_B).person;
  const c = fakeClient({ pkHasSeq: true, notableOnly: false });
  await syncPersonEvents(c, two);
  const inserts = c.calls.filter((x) => /INSERT INTO person_events/.test(x.text)).map((x) => `${x.params[1]}:${x.params[2]}`);
  assert.deepEqual(inserts.sort(), ["corona_comms:0", "red_folder:0", "red_folder:1"]);
});

const MIG = (step) => read(`scripts/migrations/2026-10-26-multi-event-${step}.sql`);
const sqlCode = (sql) => sql.replace(/--.*$/gm, "");

test("multi-event migrations: six files (render-a, lab, render-b; each with a down), one transaction each, no row changes", () => {
  for (const step of ["up-render-a", "down-render-a", "up-lab", "down-lab", "up-render-b", "down-render-b"]) {
    const code = sqlCode(MIG(step));
    assert.equal((code.match(/^BEGIN;$/gm) || []).length, 1, step);
    assert.equal((code.match(/^COMMIT;$/gm) || []).length, 1, step);
    assert.doesNotMatch(code, /\b(UPDATE\s+public\.person_events|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN|INSERT\s+INTO)\b/i, step);
  }
  assert.equal(fs.existsSync(path.join(ROOT, "scripts/migrations/2026-10-26-multi-event-up.sql")), false, "the single up file is split");
});

test("multi-event F2 render-a is additive only: column and phase A index, no CHECK; the primary key is untouched", () => {
  const code = sqlCode(MIG("up-render-a"));
  assert.match(code, /ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0/);
  assert.match(code, /CREATE UNIQUE INDEX person_events_person_kind_seq_key\s+ON public\.person_events \(person_id, kind, seq\)/);
  assert.doesNotMatch(code, /PRIMARY KEY USING|DROP CONSTRAINT|ADD CONSTRAINT|CHECK \(|REPLICA IDENTITY/, "no key, CHECK or identity change on Render at F2");
  assert.match(code, /primary key already contains seq/);
  assert.match(code, /unexpected primary key/);
  const down = sqlCode(MIG("down-render-a"));
  assert.doesNotMatch(down, /ALTER TABLE|DROP\s+COLUMN|DROP\s+INDEX|DROP CONSTRAINT/, "checks only: the seq column and index stay, there is no CHECK to drop");
  assert.match(down, /run down-render-b first/);
  assert.match(down, /still has seq > 0 \(or negative\) rows/);
  assert.match(down, /WHERE seq <> 0/);
});

test("multi-event migrations add no seq CHECK anywhere, so the CHECK set stays identical on lab and Render", () => {
  for (const step of ["up-render-a", "down-render-a", "up-lab", "down-lab", "up-render-b", "down-render-b"]) {
    const code = sqlCode(MIG(step));
    assert.doesNotMatch(code, /ADD CONSTRAINT person_events_seq|CHECK \(seq/, step);
    assert.doesNotMatch(code, /person_events_seq_nonneg/, step);
  }
  assert.doesNotMatch(read("scripts/bootstrap-db.sql"), /person_events_seq_nonneg|CHECK \(seq/);
});

test("multi-event migrations set lock_timeout and statement_timeout before any DDL (Worf B-6)", () => {
  for (const step of ["up-render-a", "down-render-a", "up-lab", "down-lab", "up-render-b", "down-render-b"]) {
    const code = sqlCode(MIG(step));
    const begin = code.indexOf("BEGIN;");
    const lock = code.indexOf("SET LOCAL lock_timeout = '5s';");
    const stmt = code.indexOf("SET LOCAL statement_timeout = '120s';");
    const firstDdl = code.search(/\b(ALTER TABLE|CREATE UNIQUE INDEX|DO \$\$)/);
    assert.ok(begin >= 0 && lock > begin && stmt > begin, step);
    assert.ok(lock < firstDdl && stmt < firstDdl, `${step}: timeouts before the first statement`);
  }
});

test("multi-event F3 up-lab and F5 up-render-b STOP unless REPLICA IDENTITY is DEFAULT before restating it (Worf B-3)", () => {
  for (const step of ["up-lab", "up-render-b"]) {
    const code = sqlCode(MIG(step));
    const guard = code.search(/IF ri IS DISTINCT FROM 'd' THEN\s+RAISE EXCEPTION/);
    const reset = code.indexOf("REPLICA IDENTITY DEFAULT;");
    const firstAlter = code.indexOf("ALTER TABLE");
    assert.ok(guard > 0, `${step}: relreplident guard`);
    assert.match(code, /relreplident FROM pg_class WHERE oid = 'public\.person_events'::regclass/, step);
    assert.ok(guard < firstAlter && firstAlter < reset, `${step}: the guard runs before any ALTER, the reset last`);
  }
});

test("multi-event index checks are schema-qualified and exact: valid unique public index on (person_id, kind, seq) (Worf B-4)", () => {
  for (const step of ["up-render-a", "up-lab", "up-render-b"]) {
    const code = sqlCode(MIG(step));
    assert.doesNotMatch(code, /pg_class WHERE relname = /, `${step}: no unqualified relname lookup`);
    assert.match(code, /n\.nspname = 'public'/, step);
    assert.match(code, /x\.indrelid = 'public\.person_events'::regclass/, step);
    assert.match(code, /x\.indisunique AND x\.indisvalid AND x\.indisready/, step);
    assert.match(code, /= ARRAY\['person_id', 'kind', 'seq'\]/, step);
    assert.match(code, /is not a valid unique index on public\.person_events \(person_id, kind, seq\); STOP/, step);
  }
});

test("multi-event F3 lab and F5 render-b swap the key by promoting the phase A index; downs guard their preconditions", () => {
  const lab = sqlCode(MIG("up-lab"));
  assert.match(lab, /ADD COLUMN IF NOT EXISTS seq/);
  assert.match(lab, /CREATE UNIQUE INDEX person_events_person_kind_seq_key/);
  for (const up of [lab, sqlCode(MIG("up-render-b"))]) {
    assert.match(up, /PRIMARY KEY USING INDEX person_events_person_kind_seq_key/);
    assert.match(up, /DROP CONSTRAINT IF EXISTS person_events_seq_notable_only/);
    assert.match(up, /REPLICA IDENTITY DEFAULT/);
    assert.match(up, /primary key is not \(person_id, kind, seq\) after the swap; STOP/);
  }
  assert.match(sqlCode(MIG("up-render-b")), /needs render-a first/);
  for (const step of ["down-lab", "down-render-b"]) {
    const down = sqlCode(MIG(step));
    assert.match(down, /PRIMARY KEY \(person_id, kind\)/, step);
    assert.match(down, /still has seq > 0 \(or negative\) rows/, step);
    assert.match(down, /WHERE seq <> 0/, step);
    assert.match(down, /duplicate \(person_id, kind\)/, step);
    assert.match(down, /CREATE UNIQUE INDEX IF NOT EXISTS person_events_person_kind_seq_key/, step);
  }
  assert.match(sqlCode(MIG("down-lab")), /needs REPLICA IDENTITY FULL first/);
  assert.doesNotMatch(sqlCode(MIG("down-render-b")), /REPLICA IDENTITY FULL first|DROP CONSTRAINT IF EXISTS person_events_seq_nonneg/);
  const doc = read("docs/MIGRATION.md");
  assert.match(doc, /exittrace_lab_pub/);
  assert.match(doc, /DDL is not replicated/);
  for (const f of ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"]) assert.match(doc, new RegExp(`\\*\\*${f}\\.`), f);
  assert.match(doc, /ET_MULTI_EVENT_WRITES/);
});

test("MIGRATION.md (Worf r3 B-6, F0): baseline after the freeze, Render's switch stays off, lock_timeout, F0 STOP rules", () => {
  const doc = read("docs/MIGRATION.md");
  assert.match(doc, /\*\*F1 \(freeze\) → F0 \(baseline\) → F2 → F3 → F4 → F5 → F6 → F7\.\*\*/);
  assert.match(doc, /\*\*F0\. Read-only baseline, after the freeze\*\*/);
  assert.match(doc, /\*\*Render's `ET_MULTI_EVENT_WRITES` stays off\*\*/);
  assert.match(doc, /SET LOCAL lock_timeout = '5s'/);
  assert.match(doc, /Expected on Render, and on lab:\*\* `seq integer NOT NULL DEFAULT 0`, PRIMARY KEY `\(person_id, kind\)`, `relreplident` `d`, and UNIQUE `person_events_person_kind_seq_key \(person_id, kind, seq\)`/);
  assert.match(doc, /a 3-column PK, any row with `seq <> 0` \(`seq > 0` or `seq < 0`\), no `seq` column, `relreplident` other than `d`, or a CHECK set different/);
  assert.match(doc, /Render apply-worker logs\*\*, read through the Render API's logs endpoint, read-only/);
  assert.match(doc, /last_msg_receipt_time/);
});

test("MIGRATION.md (Worf r4 MED-2 ruling): Render DB reads only inside the F2/F5 window with the DDL's credential, path-only; Render logs key path-only", () => {
  const doc = read("docs/MIGRATION.md");
  assert.match(doc, /Render catalog reads and the subscription-stats reads below are allowed \*\*only inside the Admiral-approved F2\/F5 window\*\*/);
  assert.match(doc, /\*\*the same Render DB credential the approved F2\/F5 DDL uses\*\*\. Q plants that credential/);
  assert.match(doc, /held \*\*path-only\*\*/);
  assert.match(doc, /\*\*never pulled, minted or revealed through the Render API\.\*\*/);
  assert.match(doc, /Outside the window nothing reads Render's database/);
  assert.match(doc, /\*\*Render\*\* \(inside the window, with the F2\/F5 credential above\): `pg_stat_subscription`/);
  assert.match(doc, /Render API key stays in the operator's key file and is used \*\*path-only\*\*: the client reads that file by path; the key is never `echo`ed, never on a command line or in argv/);
  assert.doesNotMatch(doc, /sourced only inside a subshell/);
});

test("multi-event: a seq above int4 is refused before any query (person_events.seq is INTEGER)", async () => {
  const two = attachPersonEvent(attachPersonEvent(projectPerson(melania()), RF_A).person, RF_B).person;
  const withSeq = (seq) => ({ ...two, events: two.events.map((ev) => (ev.kind === "red_folder" && eventSeq(ev) > 0 ? { ...ev, seq } : ev)) });
  const on = { ET_MULTI_EVENT_WRITES: "on" };
  for (const seq of [2147483648, "2147483648", 99999999999999]) {
    const c = fakeClient({ pkHasSeq: true, notableOnly: false });
    await assert.rejects(assertMultiNotableReady(c, withSeq(seq), on), { code: "event_seq_out_of_range" }, String(seq));
    assert.equal(c.calls.length, 0);
  }
  await assertMultiNotableReady(fakeClient({ pkHasSeq: true, notableOnly: false }), withSeq(2147483647), on);
});
