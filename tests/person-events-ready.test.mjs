import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPeopleToRange } from "../app/lib/dashboard.mjs";
import { personEvents, projectPerson } from "../app/lib/promote.mjs";

function signature(events) {
  return events.map((ev) => ({
    kind: ev.kind,
    event_date: ev.event_date,
    headcount: ev.headcount ?? null,
    unsealed: ev.unsealed === true,
    urls: (ev.sources || []).map((source) => source.url).sort(),
  }));
}

const raw = {
  id: "ada-example",
  category: "firings",
  name: "Ada Example",
  event_date: "2024-01-02",
  birth_date: "1980-05-01",
  sources: [{ url: "https://www.example.com/extra" }],
  events: [
    {
      kind: "firings",
      event_date: "2024-01-02",
      headcount: 12,
      sources: [{ url: "https://www.example.com/a" }],
    },
    {
      kind: "firings",
      event_date: "2024-01-03",
      sources: [{ url: "https://www.example.net/b" }],
    },
    {
      kind: "resignations",
      event_date: "2024-04-01",
      sources: [{ url: "https://www.example.com/c" }],
    },
  ],
};

test("a projected person reuses prepared events", () => {
  const slow = personEvents(raw);
  assert.notEqual(personEvents(raw), slow);
  const projected = projectPerson(raw);
  const fast = personEvents(projected);
  assert.equal(personEvents(projected), fast);
  assert.deepEqual(signature(fast), signature(slow));
  assert.equal(fast.find((ev) => ev.kind === "firings").age_at_event, 43);
  const json = JSON.parse(JSON.stringify(projected));
  assert.equal(Object.hasOwn(json, "personEventsReady"), false);
  assert.ok(Array.isArray(json.events));
});

test("replacing events drops the prepared mark and keeps the new kind", () => {
  const projected = projectPerson(raw);
  const replaced = {
    ...projected,
    events: [
      ...personEvents(projected),
      {
        kind: "arrests",
        event_date: "2024-05-01",
        sources: [
          { url: "https://www.example.com/arrest" },
          { url: "https://www.example.net/arrest" },
        ],
      },
    ],
  };
  const events = personEvents(replaced);
  assert.notEqual(events, replaced.events);
  assert.ok(events.some((ev) => ev.kind === "arrests" && ev.event_date === "2024-05-01"));
  const again = projectPerson(replaced);
  assert.equal(personEvents(again), again.events);
});

test("an in-range copy of a prepared person stays prepared", () => {
  const projected = projectPerson(raw);
  const ranged = filterPeopleToRange([projected], {
    id: "custom",
    from: "2024-03-01",
    to: "2024-12-31",
  });
  assert.equal(ranged.length, 1);
  const events = personEvents(ranged[0]);
  assert.equal(personEvents(ranged[0]), events);
  assert.deepEqual(
    events.map((ev) => ev.kind),
    ["resignations"],
  );
});
