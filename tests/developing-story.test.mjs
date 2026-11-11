import assert from "node:assert/strict";
import { test } from "node:test";
import { commsDetail, personDetail } from "../app/lib/html.mjs";
import { KIND_COMMS } from "../app/lib/kind-comms.mjs";
import { isOfficialCiteUrl, isOfficialPublisherUrl } from "../app/lib/official.mjs";
import { applyRedFolderSnapshotStanding, mergeProcessOverlay } from "../app/lib/add-request.mjs";
import {
  copyEventRow,
  eventStandingFromSources,
  incomingPersonEvent,
  personEvents,
  uniqueEvents,
} from "../app/lib/promote.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

test("person card and red_folder comm detail render a Developing story marker", () => {
  const person = {
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    events: [
      {
        kind: "arrests",
        event_date: "2024-06-15",
        sources: [],
        standing: "developing",
      },
    ],
  };
  const card = personDetail(person);
  assert.match(card, /Developing story/);
  assert.match(card, /data-standing="developing"/);
  assert.match(card, /class="meta-line developing-story"/);

  const full = personDetail({
    ...person,
    events: [{ kind: "arrests", event_date: "2024-06-15", sources: [] }],
  });
  assert.doesNotMatch(full, /Developing story/);

  const spec = KIND_COMMS.red_folder;
  const fromSnapshot = commsDetail(
    spec,
    {
      id: "rf-dev",
      handle: "@example",
      posted_at: "2020-03-09",
      text: "posted",
      source_url: "https://x.com/example/status/1",
      snapshot: { standing: "developing" },
    },
    { linkedPeople: [] },
  );
  assert.match(fromSnapshot, /Developing story/);

  const fromLinked = commsDetail(
    spec,
    {
      id: "rf-linked",
      handle: "@example",
      posted_at: "2020-03-09",
      text: "posted",
      source_url: "https://x.com/example/status/1",
      snapshot: { person_ids: ["casey-vale"] },
    },
    {
      linkedPeople: [
        {
          ...person,
          events: [
            {
              kind: "red_folder",
              event_date: "2020-03-09",
              sources: [],
              standing: "developing",
            },
          ],
        },
      ],
    },
  );
  assert.match(fromLinked, /Developing story/);
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITE1 = "https://www.nytimes.com/2024/06/15/world/casey-vale.html";
const CITE2 = "https://www.theatlantic.com/politics/2024/06/casey-vale/123456";

test("a second allowed cite clears developing standing on merge", () => {
  const first = uniqueEvents([
    incomingPersonEvent(
      { category: "arrests", event_date: "2024-06-15", standing: "developing" },
      [{ url: CITE1 }],
    ),
  ]);
  assert.equal(first[0].standing, "developing");
  const merged = uniqueEvents([
    first[0],
    incomingPersonEvent(
      { category: "arrests", event_date: "2024-06-15", standing: "full" },
      [{ url: CITE2 }],
    ),
  ]);
  assert.equal(Object.hasOwn(merged[0], "standing"), false);
});

test("explicit full with one allowed cite stays developing", () => {
  const rows = uniqueEvents([
    incomingPersonEvent(
      { category: "arrests", event_date: "2024-06-15", standing: "full" },
      [{ url: CITE1 }],
    ),
  ]);
  assert.equal(rows[0].standing, "developing");
});

test("red_folder snapshot standing clears at two allowed cites", () => {
  assert.equal(eventStandingFromSources([CITE1]), "developing");
  assert.equal(eventStandingFromSources([CITE1, CITE2]), undefined);
  const src = fs.readFileSync(path.join(ROOT, "app/lib/add-request.mjs"), "utf8");
  assert.match(src, /applyRedFolderSnapshotStanding/);
  const planned = { standing: "developing" };
  const clearedPlan = applyRedFolderSnapshotStanding({ handle: "x", standing: "developing" }, { standing: "full" }, [CITE1, CITE2]);
  assert.equal(Object.hasOwn(clearedPlan, "standing"), false);
  const keptPlan = applyRedFolderSnapshotStanding({ handle: "x" }, planned, [CITE1]);
  assert.equal(keptPlan.standing, "developing");
  const noPlanClear = applyRedFolderSnapshotStanding({ handle: "x", standing: "developing" }, { skipped: "missing_person" }, [CITE1, CITE2]);
  assert.equal(Object.hasOwn(noPlanClear, "standing"), false);
});

test("incomingPersonEvent standing comes only from validateIdentifiedPersonInput", () => {
  const dig = fs.readFileSync(path.join(ROOT, "app/lib/mention-dig.mjs"), "utf8");
  assert.match(dig, /delete overlay\.standing;/);
  const merged = mergeProcessOverlay(
    { kind: "person", subject: "Casey Vale", standing: "developing", operator_lead: true },
    { cite_urls: [CITE1] },
  );
  assert.equal(Object.hasOwn(merged, "standing"), false);
  assert.equal(merged.operator_lead, false);
  const vip = fs.readFileSync(path.join(ROOT, "app/lib/promote.mjs"), "utf8");
  assert.match(vip, /operatorLead \? \{ operator_lead: true, standing \}/);
  const incoming = fs.readFileSync(path.join(ROOT, "app/lib/promote.mjs"), "utf8");
  assert.match(incoming, /if \(input\.standing === "developing" \|\| input\.standing === "full"\)/);
  const queue = fs.readFileSync(path.join(ROOT, "scripts/process-add-request.mjs"), "utf8");
  assert.equal(queue.includes("standing:"), false);
});

test("legacy one-cite events without standing stay unmarked on normalize, merge, and copy", () => {
  const raw = { kind: "arrests", event_date: "2024-06-15", sources: [{ url: CITE1 }] };
  const normalized = uniqueEvents([raw]);
  assert.equal(Object.hasOwn(normalized[0], "standing"), false);
  const merged = uniqueEvents([normalized[0], { kind: "arrests", event_date: "2024-06-15", sources: [{ url: CITE1 }] }]);
  assert.equal(Object.hasOwn(merged[0], "standing"), false);
  assert.equal(Object.hasOwn(copyEventRow(raw), "standing"), false);
});

test("duplicate official URLs count as one allowed cite", () => {
  assert.equal(eventStandingFromSources([CITE1, CITE1]), "developing");
  assert.equal(eventStandingFromSources([CITE1, CITE1 + "?utm_source=share"]), "developing");
  const rows = uniqueEvents([
    incomingPersonEvent(
      { category: "arrests", event_date: "2024-06-15", standing: "developing" },
      [{ url: CITE1 }, { url: CITE1 }],
    ),
  ]);
  assert.equal(rows[0].standing, "developing");
});

test("personEvents render adds no marker to a legacy unmarked card", () => {
  const person = {
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    events: [{ kind: "arrests", event_date: "2024-06-15", sources: [{ url: CITE1 }] }],
  };
  assert.equal(Object.hasOwn(personEvents(person)[0], "standing"), false);
  assert.doesNotMatch(personDetail(person), /Developing story/);
});

test("a legacy snapshot without standing stays unmarked", () => {
  const snap = applyRedFolderSnapshotStanding({ handle: "x", posted_at: "2020-03-09" }, null, [CITE1]);
  assert.equal(Object.hasOwn(snap, "standing"), false);
  const plannedUnmarked = applyRedFolderSnapshotStanding(
    { handle: "x" },
    { standing: "full" },
    [CITE1, CITE2],
  );
  assert.equal(Object.hasOwn(plannedUnmarked, "standing"), false);
});
