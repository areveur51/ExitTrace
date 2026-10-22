/** Multiple dated notables per person. One firing stays one firing. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  attachPersonEvent,
  derivePersonFields,
  eventKey,
  mergePersonAnnotate,
  notableEvents,
  personEvents,
  projectPerson,
  sameNotable,
  uniqueEvents,
} from "../app/lib/promote.mjs";
import { keymapFooter, personDetail } from "../app/lib/html.mjs";
import { pickRow, buildUpsertSql } from "../app/lib/gap-upsert.mjs";
import { syncPersonEvents } from "../app/lib/store.mjs";

const CITE_A = { url: "https://www.example.com/news/a" };
const CITE_B = { url: "https://www.example.net/world/b" };
const CITE_C = { url: "https://www.example.org/desk/c" };

function notable(overrides = {}) {
  return {
    kind: "notable",
    event_date: "2024-08-01",
    comments: "Named in a published poll.",
    sources: [CITE_A, CITE_B],
    ...overrides,
  };
}

test("two notables with different dates both survive uniqueEvents and get seq 0/1", () => {
  const events = uniqueEvents([
    notable({ event_date: "2020-01-15", comments: "Older notable.", sources: [CITE_A] }),
    notable({ event_date: "2024-08-01", comments: "Newer notable.", sources: [CITE_B] }),
  ]);
  assert.equal(events.length, 2);
  const seqs = events.map((ev) => ev.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [0, 1]);
  assert.ok(events.every((ev) => ev.kind === "notable"));
  assert.equal(events[0].event_date, "2024-08-01");
  assert.equal(events[1].event_date, "2020-01-15");
  assert.notEqual(events[0].seq, events[1].seq);
});

test("personEvents and derivePerson keep both notables and notable-only category", () => {
  const row = {
    id: "casey-vale",
    name: "Casey Vale",
    category: "nickname",
    event_date: "2017-10-26",
    events: [
      notable({ event_date: "2020-01-15", comments: "Older notable.", sources: [CITE_A] }),
      notable({ event_date: "2024-08-01", comments: "Newer notable.", sources: [CITE_B] }),
    ],
  };
  const events = personEvents(row);
  assert.equal(events.filter((ev) => ev.kind === "notable").length, 2);
  const derived = derivePersonFields(row);
  assert.equal(derived.events.length, 2);
  assert.equal(derived.category, "nickname");
  const notableOnly = derivePersonFields({
    category: "firings",
    events: row.events,
  });
  assert.equal(notableOnly.category, "firings");
  const asNotable = derivePersonFields({ category: "notable", events: row.events });
  assert.equal(asNotable.category, "notable");
  assert.equal(asNotable.events.length, 2);
});

test("notableEvents orders newest date first, null dates last, seq asc tiebreak", () => {
  const ordered = notableEvents([
    notable({ event_date: "2020-01-15", seq: 0, comments: "Old" }),
    notable({ event_date: "2024-08-01", seq: 2, comments: "New-b" }),
    notable({ event_date: "2024-08-01", seq: 1, comments: "New-a" }),
    { kind: "firings", event_date: "2023-01-01", sources: [CITE_A] },
  ]);
  assert.deepEqual(
    ordered.map((ev) => ev.comments),
    ["New-a", "New-b", "Old"],
  );
  const withNull = notableEvents([
    notable({ event_date: "2024-08-01", comments: "Dated" }),
    { kind: "notable", event_date: null, comments: "Undated", sources: [CITE_C] },
  ]);
  assert.equal(withNull[0].comments, "Dated");
  assert.equal(withNull[1].comments, "Undated");
});

test("same seq or same date plus shared cite still folds notables", () => {
  const bySeq = uniqueEvents([
    notable({ seq: 0, event_date: "2020-01-15", comments: "A", sources: [CITE_A] }),
    notable({ seq: 0, event_date: "2024-08-01", comments: "B", sources: [CITE_B] }),
  ]);
  assert.equal(bySeq.length, 1);
  assert.equal(bySeq[0].seq, 0);
  assert.equal(bySeq[0].sources.length, 2);

  const byCite = uniqueEvents([
    notable({ event_date: "2024-08-01", comments: "Poll A", sources: [CITE_A, CITE_B] }),
    notable({ event_date: "2024-08-01", comments: "Poll B", sources: [CITE_A] }),
  ]);
  assert.equal(byCite.length, 1);
  assert.ok(byCite[0].sources.some((s) => s.url === CITE_A.url));
  assert.ok(byCite[0].sources.some((s) => s.url === CITE_B.url));

  assert.equal(
    sameNotable(
      notable({ seq: 3, event_date: "2020-01-01" }),
      notable({ seq: 3, event_date: "2021-01-01" }),
    ),
    true,
  );
  assert.equal(
    sameNotable(
      notable({ event_date: "2024-08-01", sources: [CITE_A] }),
      notable({ event_date: "2020-01-01", sources: [CITE_A] }),
    ),
    false,
  );
});

test("a non-notable duplicate kind still folds to one", () => {
  const events = uniqueEvents([
    { kind: "firings", event_date: "2024-01-01", sources: [CITE_A], comments: "First" },
    { kind: "firings", event_date: "2024-06-15", sources: [CITE_B], comments: "Second" },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "firings");
  assert.equal(events[0].event_date, "2024-01-01");
  assert.equal(Object.hasOwn(events[0], "seq"), false);
  assert.equal(eventKey(events[0]), "firings");
});

test("attachPersonEvent appends a second notable with a new seq", () => {
  const person = projectPerson({
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    events: [
      { kind: "arrests", event_date: "2024-06-15", sources: [CITE_A, CITE_B] },
      notable({ event_date: "2020-01-15", comments: "First notable.", sources: [CITE_A] }),
    ],
  });
  const first = person.events.find((ev) => ev.kind === "notable");
  assert.equal(first.seq, 0);
  const attached = attachPersonEvent(person, {
    kind: "notable",
    event_date: "2024-08-01",
    comments: "Second notable.",
    sources: [CITE_B, CITE_C],
  });
  assert.equal(attached.existed, false);
  const notables = attached.person.events.filter((ev) => ev.kind === "notable");
  assert.equal(notables.length, 2);
  assert.deepEqual(notables.map((ev) => ev.seq).sort((a, b) => a - b), [0, 1]);
  const merged = attachPersonEvent(attached.person, {
    kind: "notable",
    event_date: "2024-08-01",
    comments: "Second notable.",
    sources: [CITE_B],
  });
  assert.equal(merged.existed, true);
  assert.equal(merged.person.events.filter((ev) => ev.kind === "notable").length, 2);
});

test("person detail renders two Notable blocks newest first and no Notable nav", () => {
  const html = personDetail({
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    events: [
      {
        kind: "arrests",
        event_date: "2024-06-15",
        comments: "Held after contemporaneous reports.",
        sources: [CITE_A, CITE_B],
      },
      notable({ event_date: "2020-01-15", comments: "Older notable.", sources: [CITE_A] }),
      notable({ event_date: "2024-08-01", comments: "Newer notable.", sources: [CITE_B] }),
    ],
  });
  const blocks = html.match(/class="detail-notable detail-supporting"/g) || [];
  assert.equal(blocks.length, 2);
  const newerAt = html.indexOf("Newer notable.");
  const olderAt = html.indexOf("Older notable.");
  assert.ok(newerAt >= 0 && olderAt > newerAt);
  assert.equal((html.match(/<h3 class="event-h">Notable event<\/h3>/g) || []).length, 2);
  assert.doesNotMatch(html, /href="\/notable"/);
  assert.doesNotMatch(html, />Notable</);
  const footer = keymapFooter("/");
  assert.doesNotMatch(footer, /href="\/notable"/);
  assert.doesNotMatch(footer, />Notable</);
});

test("syncPersonEvents uses ON CONFLICT (person_id, kind, seq) and passes seq", async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  await syncPersonEvents(client, {
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    events: [
      { kind: "arrests", event_date: "2024-06-15", sources: [CITE_A, CITE_B] },
      notable({ event_date: "2020-01-15", seq: 0, comments: "First", sources: [CITE_A] }),
      notable({ event_date: "2024-08-01", seq: 1, comments: "Second", sources: [CITE_B] }),
    ],
  });
  const inserts = queries.filter((q) => /INSERT INTO person_events/.test(q.sql));
  assert.equal(inserts.length, 3);
  for (const q of inserts) {
    assert.match(q.sql, /ON CONFLICT \(person_id, kind, seq\)/);
    assert.match(q.sql, /\bseq\b/);
  }
  const pairs = inserts.map((q) => [q.params[1], q.params[2]]).sort();
  assert.deepEqual(pairs, [
    ["arrests", 0],
    ["notable", 0],
    ["notable", 1],
  ]);
});

test("gold death_unconfirmed with null date stays null after mergePersonAnnotate with a dated prior", () => {
  const merged = mergePersonAnnotate(
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "death_unconfirmed",
      events: [
        {
          kind: "death_unconfirmed",
          event_date: null,
          comments: "Gold unconfirmed.",
          sources: [CITE_A, CITE_B],
        },
      ],
    },
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "death_unconfirmed",
      event_date: "2024-08-01",
      events: [
        {
          kind: "death_unconfirmed",
          event_date: "2024-08-01",
          comments: "Prior dated.",
          sources: [CITE_C],
        },
      ],
    },
  );
  const row = merged.events.find((ev) => ev.kind === "death_unconfirmed");
  assert.ok(row);
  assert.equal(row.event_date, null);
});

test("gap-upsert person_events key and columns include seq", () => {
  const planned = buildUpsertSql("person_events", [
    { person_id: "casey-vale", kind: "notable", seq: 1, event_date: "2024-08-01" },
    { person_id: "casey-vale", kind: "firings", event_date: "2024-01-01" },
  ]);
  assert.match(planned.sql, /ON CONFLICT \(person_id, kind, seq\)/);
  assert.match(planned.sql, /INSERT INTO person_events \(person_id, kind, seq,/);
  assert.equal(planned.params[2], 1);
  const missing = pickRow("person_events", {
    person_id: "casey-vale",
    kind: "firings",
    event_date: "2024-01-01",
  });
  assert.equal(missing.seq, 0);
});
