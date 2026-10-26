import assert from "node:assert/strict";
import { test } from "node:test";
import { attachPersonEvent, derivePersonFields, isHeadlineExcluded, normalizePersonEvent, projectPerson } from "../app/lib/promote.mjs";
import { getPerson, savePerson, setMemory } from "../app/lib/store.mjs";

const CITE_A = { title: "A", publisher: "Reuters", url: "https://www.reuters.com/world/us/pin-a", date: "2025-01-20" };
const CITE_B = { title: "B", publisher: "AP", url: "https://apnews.com/article/pin-b", date: "2026-10-20" };

function basePerson() {
  return {
    id: "pin-subject",
    name: "Pin Subject",
    category: "resignations",
    event_date: "2025-01-20",
    role: "",
    sources: [CITE_A],
    events: [{ kind: "resignations", event_date: "2025-01-20", sources: [CITE_A] }],
  };
}

const NEWER = { kind: "arrests", event_date: "2026-10-20", sources: [CITE_B] };

test("headline pin: only a literal true headline_exclude is kept on the event", () => {
  assert.equal(normalizePersonEvent({ ...NEWER, headline_exclude: true }).headline_exclude, true);
  for (const v of [false, "true", 1, null, undefined]) {
    assert.equal("headline_exclude" in normalizePersonEvent({ ...NEWER, headline_exclude: v }), false, String(v));
  }
  assert.equal(isHeadlineExcluded({ headline_exclude: "yes" }), false);
});

test("headline pin: a flagged newer event leaves category and card date unchanged", () => {
  const before = projectPerson(basePerson());
  const { person } = attachPersonEvent(before, { ...NEWER, headline_exclude: true });
  assert.equal(person.category, "resignations");
  assert.equal(person.event_date, "2025-01-20");
  assert.equal(person.category, before.category);
  assert.equal(person.event_date, before.event_date);
  // The event is still on the card.
  const added = person.events.find((ev) => ev.kind === "arrests");
  assert.ok(added, "flagged event kept");
  assert.equal(added.headline_exclude, true);
  assert.equal(added.event_date, "2026-10-20");
  // A kind-filtered projection still uses the flagged event for its own list.
  assert.equal(derivePersonFields(person, ["arrests"]).event_date, "2026-10-20");
});

test("headline pin: unchanged behaviour without the flag (newest event drives the headline)", () => {
  const { person } = attachPersonEvent(projectPerson(basePerson()), NEWER);
  assert.equal(person.category, "arrests");
  assert.equal(person.event_date, "2026-10-20");
  assert.equal("headline_exclude" in person.events.find((ev) => ev.kind === "arrests"), false);
  const falsy = attachPersonEvent(projectPerson(basePerson()), { ...NEWER, headline_exclude: false }).person;
  assert.equal(falsy.category, "arrests");
  assert.equal(falsy.event_date, "2026-10-20");
});

test("headline pin: the pin holds on save and every re-read (memory store and a stored-row re-projection)", async () => {
  setMemory({ people: [basePerson()] });
  const start = await getPerson("pin-subject");
  const { person } = attachPersonEvent(start, { ...NEWER, headline_exclude: true });
  await savePerson(person);
  let read = await getPerson("pin-subject");
  for (let i = 0; i < 3; i += 1) {
    assert.equal(read.category, "resignations");
    assert.equal(read.event_date, "2025-01-20");
    assert.equal(read.events.find((ev) => ev.kind === "arrests").headline_exclude, true);
    // Same shape a database row has after a JSON round trip of people.events.
    const stored = JSON.parse(JSON.stringify({ ...read }));
    read = projectPerson(stored);
    await savePerson(read);
    read = await getPerson("pin-subject");
  }
  // A later merge of the same kind keeps the pin.
  const merged = attachPersonEvent(read, { kind: "arrests", event_date: "2026-10-20", sources: [CITE_A] }).person;
  assert.equal(merged.category, "resignations");
  assert.equal(merged.events.find((ev) => ev.kind === "arrests").headline_exclude, true);
});

test("headline pin: an unflagged event newer than the pinned one still takes the headline", () => {
  const pinned = attachPersonEvent(projectPerson(basePerson()), { ...NEWER, headline_exclude: true }).person;
  const next = attachPersonEvent(pinned, { kind: "firings", event_date: "2026-10-25", sources: [CITE_B] }).person;
  assert.equal(next.category, "firings");
  assert.equal(next.event_date, "2026-10-25");
});
