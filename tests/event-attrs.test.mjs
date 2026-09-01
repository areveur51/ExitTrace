import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_ATTR_FIELDS,
  deathKindFromTags,
  eventFromLead,
  mapLeadReason,
  normalizeEventAttrs,
  resignKindFromRole,
  resolveEventCalendar,
} from "../app/lib/event-attrs.mjs";
import { PromoteError, validateIdentifiedPersonInput } from "../app/lib/promote.mjs";

const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];

test("event attr fields stay one shared list", () => {
  assert.deepEqual(EVENT_ATTR_FIELDS, [
    "position",
    "organization",
    "country",
    "branch",
    "comments",
  ]);
});

test("event_date is Last Day else Announced; both empty do not insert", () => {
  assert.deepEqual(resolveEventCalendar({ last_day: "2024-07-02", announced: "2024-06-15" }), {
    event_date: "2024-07-02",
    announced_date: "2024-06-15",
  });
  assert.deepEqual(resolveEventCalendar({ announced: "2024-06-15" }), {
    event_date: "2024-06-15",
    announced_date: "",
  });
  assert.deepEqual(resolveEventCalendar({ "Last Day": "2024-07-02", Announced: "2024-07-02" }), {
    event_date: "2024-07-02",
    announced_date: "",
  });
  assert.deepEqual(resolveEventCalendar({}), { event_date: null, announced_date: "" });
  assert.throws(
    () => validateIdentifiedPersonInput({ subject: "Casey Vale", category: "firings", cite_urls: CITES }),
    (err) => err instanceof PromoteError && err.code === "missing_event_date",
  );
  const fromLastDay = validateIdentifiedPersonInput({
    subject: "Casey Vale",
    last_day: "2024-07-02",
    announced: "2024-06-15",
    reason: "Fired",
    position: "Anchor, CNN",
    cite_urls: CITES,
  });
  assert.equal(fromLastDay.event_date, "2024-07-02");
  assert.equal(fromLastDay.announced_date, "2024-06-15");
  assert.equal(fromLastDay.category, "firings");
  assert.equal(fromLastDay.position, "Anchor, CNN");
});

test("lead Reason maps to existing KEEP kinds only", () => {
  assert.equal(mapLeadReason("Fired"), "firings");
  assert.equal(mapLeadReason("Resigned"), "resignations");
  assert.equal(mapLeadReason("Retired"), "resignations");
  assert.equal(mapLeadReason("Term Ended"), "resignations");
  assert.equal(mapLeadReason("Resigned", { tags: ["official"] }), "government_stepdowns");
  assert.equal(resignKindFromRole({ role: "Prime Minister of the United Kingdom" }), "resignations");
  assert.equal(mapLeadReason("Dead", { tags: ["celebrity"] }), "death_celebrity");
  assert.equal(mapLeadReason("Dead", { tags: ["official"] }), "death_official");
  assert.equal(mapLeadReason("Dead", { tags: ["ceo"] }), "death_ceo");
  assert.equal(mapLeadReason("Dead"), null);
  assert.equal(deathKindFromTags(["celebrity", "official"]), null);
  assert.equal(mapLeadReason("Unknown"), null);
  assert.equal(mapLeadReason("arrests"), "arrests");
  assert.equal(mapLeadReason("corona_comms"), "corona_comms");
});

test("eventFromLead is the harvest shape dashboard ranks", () => {
  const ev = eventFromLead({
    "Last Day": "2024-07-02",
    Announced: "2024-06-15",
    Reason: "Fired",
    Position: "Anchor, CNN",
    Organization: "Example Desk",
    Country: "USA",
    Branch: "News",
    Comments: "lead note",
  });
  assert.deepEqual(ev, {
    kind: "firings",
    event_date: "2024-07-02",
    announced_date: "2024-06-15",
    position: "Anchor, CNN",
    organization: "Example Desk",
    country: "USA",
    branch: "News",
    comments: "lead note",
  });
  assert.equal(eventFromLead({ Reason: "Fired" }), null);
  assert.equal(eventFromLead({ last_day: "2024-07-02", reason: "Dead" }), null);
});

test("empty country and branch stay empty — name and role are not guessed", () => {
  const attrs = normalizeEventAttrs({
    position: "Prime Minister of the United Kingdom",
    name: "Casey Vale of Canada",
  });
  assert.equal(attrs.country, "");
  assert.equal(attrs.organization, "");
  assert.equal(attrs.branch, "");
  assert.equal(attrs.position, "Prime Minister of the United Kingdom");
  assert.equal(
    eventFromLead({
      last_day: "2024-07-02",
      reason: "Resigned",
      position: "Prime Minister of the United Kingdom",
    }).country,
    "",
  );
});
