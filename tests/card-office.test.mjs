import assert from "node:assert/strict";
import { test } from "node:test";
import { personCardOffice, personCardPosition, personDetail, personRow } from "../app/lib/html.mjs";

const HOUSE = "U.S. House of Representatives";
const UKRAINE_TEXT =
  "Voted yea on H.R. 8035, the Ukraine Security Supplemental Appropriations Act, 2024 (House Roll Call 151).";

function member(overrides = {}, event = {}) {
  return {
    id: "ruben-gallego",
    category: "notable",
    name: "Ruben Gallego",
    role: "U.S. Senator (D), Arizona",
    event_date: "2024-04-20",
    death_date: null,
    photo: "/media/people/ruben-gallego.jpg",
    net_worth_usd: null,
    events: [
      {
        seq: 0,
        kind: "notable",
        event_date: "2024-04-20",
        position: "U.S. Representative (D), Arizona",
        organization: HOUSE,
        comments: UKRAINE_TEXT,
        sources: [
          { url: "https://clerk.house.gov/evs/2024/roll151.xml", date: "2024-04-20", title: "Roll Call 151" },
          { url: "https://www.congress.gov/bill/118th-congress/house-bill/8035/all-actions", date: "2024-04-20", title: "Actions" },
        ],
        ...event,
      },
    ],
    ...overrides,
  };
}

test("card office table: role vs the card event", () => {
  const rows = [
    // [case, role, event position, event organization, expected position, expected organization]
    ["role present: Senator over a House event", "U.S. Senator (D), Arizona", "U.S. Representative (D), Arizona", HOUSE, "U.S. Senator (D), Arizona", "U.S. Senate"],
    ["role present: Representative over a House event", "U.S. Representative (D), Delaware", "U.S. Representative (D), Delaware", HOUSE, "U.S. Representative (D), Delaware", HOUSE],
    ["role present: former member keeps the event body", "Former U.S. Representative (D), Texas", "U.S. Representative (D), Texas", HOUSE, "Former U.S. Representative (D), Texas", HOUSE],
    ["role empty: falls back to the event", "", "U.S. Representative (D), Arizona", HOUSE, "U.S. Representative (D), Arizona", HOUSE],
    ["role blank: falls back to the event", "   ", "U.S. Representative (D), Arizona", HOUSE, "U.S. Representative (D), Arizona", HOUSE],
    ["non-congressional role: event office stays", "Political director", "U.S. Representative", HOUSE, "U.S. Representative", HOUSE],
    ["non-congressional event: event office stays", "U.S. Senator (D), California", "Chairman", "House Intelligence Committee", "Chairman", "House Intelligence Committee"],
    ["event without position: role, event body", "U.S. Senator (D), Michigan", "", "", "U.S. Senator (D), Michigan", "U.S. Senate"],
    ["no mapping invented for other offices", "Governor of Minnesota", "", "State of Minnesota", "Governor of Minnesota", "State of Minnesota"],
  ];
  for (const [name, role, position, organization, wantPosition, wantOrganization] of rows) {
    const row = member({ role }, { position, organization });
    assert.deepEqual(personCardOffice(row), { position: wantPosition, organization: wantOrganization }, name);
    assert.equal(personCardPosition(row), wantPosition, name);
  }
});

test("role present: the card shows the current role", () => {
  const row = member();
  assert.match(personRow(row), /<div class="tui-position">U\.S\. Senator \(D\), Arizona<\/div>/);
  assert.doesNotMatch(personRow(row), /U\.S\. Representative/);
});

test("role empty: the card falls back to the card event office", () => {
  for (const role of ["", null, undefined]) {
    const row = member({ role });
    assert.equal(personCardPosition(row), "U.S. Representative (D), Arizona");
    assert.match(personRow(row), /<div class="tui-position">U\.S\. Representative \(D\), Arizona<\/div>/);
  }
});

test("event text unchanged: the notable event keeps its stored office line and prose", () => {
  const row = member();
  const before = JSON.stringify(row);
  personRow(row);
  const html = personDetail(row);
  assert.equal(JSON.stringify(row), before, "row is not mutated");
  assert.ok(html.includes(UKRAINE_TEXT));
  assert.match(
    html,
    /<p class="event-facts">Position · U\.S\. Representative \(D\), Arizona · Organization · U\.S\. House of Representatives<\/p>/,
  );
  assert.doesNotMatch(html, /<p class="event-facts">Position · U\.S\. Senator/);
  // The detail header stays identity-only (person-detail.test.mjs); no office facts are added there.
  assert.doesNotMatch(html, /identity-label">(?:Position|Organization)</);
});

test("no office when neither role nor event has one", () => {
  const row = member({ role: "" }, { position: "", organization: "" });
  assert.deepEqual(personCardOffice(row), { position: "", organization: "" });
  assert.doesNotMatch(personRow(row), /class="tui-position"/);
});
