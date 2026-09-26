import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboard, rankDimension } from "../app/lib/dashboard.mjs";
import { parseHeadcount, personHeadcount } from "../app/lib/event-attrs.mjs";
import { eventTagRow } from "../app/lib/html.mjs";
import { personEvents } from "../app/lib/promote.mjs";
import { counts, setMemory } from "../app/lib/store.mjs";

const cites = [
  { url: "https://www.example.com/news/group-left" },
  { url: "https://www.example.net/world/group-left" },
];

function groupCard() {
  return {
    id: "doj-civil-rights-division-attorneys",
    category: "resignations",
    name: "DOJ Civil Rights Division attorneys",
    event_date: "2026-09-23",
    events: [
      {
        kind: "resignations",
        event_date: "2026-09-23",
        sources: cites,
        headcount: 300,
        position: "Attorneys",
      },
    ],
  };
}

function oneResignation() {
  return {
    id: "one-resign",
    category: "resignations",
    name: "One Resign",
    event_date: "2026-09-01",
    events: [
      {
        kind: "resignations",
        event_date: "2026-09-01",
        sources: cites,
      },
    ],
  };
}

test("parseHeadcount keeps a stored group size and ignores a single card", () => {
  assert.equal(parseHeadcount(300), 300);
  assert.equal(parseHeadcount("300"), 300);
  assert.equal(parseHeadcount(1), null);
  assert.equal(parseHeadcount(0), null);
  assert.equal(parseHeadcount("about 300"), null);
  assert.equal(parseHeadcount(300.5), null);
  assert.equal(parseHeadcount(100001), null);
});

test("a group resignation counts as its headcount on the home census and dashboard", async () => {
  const group = groupCard();
  const one = oneResignation();
  assert.equal(personEvents(group)[0].headcount, 300);
  assert.equal(personHeadcount(group), 300);
  assert.equal(personHeadcount(one), 1);
  const model = buildDashboard([group, one]);
  assert.equal(model.people, 301);
  const reason = rankDimension([group, one], "reason");
  const resignations = reason.find((row) => row.key === "resignations");
  assert.equal(resignations.count, 301);
  const html = eventTagRow(personEvents(group)[0]);
  assert.match(html, /Group size · 300/);
  assert.doesNotMatch(eventTagRow(personEvents(one)[0]), /Group size/);
  setMemory({ people: [group, one] });
  const census = await counts();
  assert.equal(census.people, 301);
  assert.equal(census.byCategory.resignations, 301);
});
