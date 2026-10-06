/** Notable event: person KEEP kind on person_events. Not a new table. */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROMOTE_CATEGORY_IDS,
  categoryById,
  categoryByPath,
  isDisplayedEventKind,
} from "../app/lib/categories.mjs";
import { listPathForPerson } from "../app/lib/display-check.mjs";
import { rankDimension } from "../app/lib/dashboard.mjs";
import { mapLeadReason } from "../app/lib/event-attrs.mjs";
import { eventTagRow, personDetail } from "../app/lib/html.mjs";
import { validateIdentifiedPersonInput } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { applyIdentifiedPerson, getPerson, listPeople, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];
const MORE = [
  "https://www.example.com/news/casey-vale-notable",
  "https://www.example.net/world/casey-vale-notable-event",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("notable is a person KEEP kind with Notable event / Notable titles", () => {
  const cat = categoryById("notable");
  assert.equal(cat.kind, "person");
  assert.equal(cat.title, "Notable event");
  assert.equal(cat.nav, "Notable");
  assert.equal(cat.path, "/notable");
  assert.equal(categoryByPath("/notable").id, "notable");
  assert.equal(PROMOTE_CATEGORY_IDS.includes("notable"), true);
  assert.equal(isDisplayedEventKind("notable"), true);
  assert.equal(isDisplayedEventKind("notable_event"), false);
  assert.equal(listPathForPerson("notable"), "/notable");
  assert.equal(mapLeadReason("notable"), "notable");
  assert.equal(mapLeadReason("Notable event"), null);
});

test("event tag row renders a Notable event section", () => {
  const html = eventTagRow({
    kind: "notable",
    event_date: "2024-06-15",
    comments: "Poll lead",
    sources: [
      { url: MORE[0], snippet: "Named in the poll lead", date: "2024-06-15", publisher: "Desk" },
      { url: MORE[1], date: "2024-06-15" },
    ],
  });
  assert.match(html, /<article class="event-tag-row" data-kind="notable" data-section="person-event">/);
  assert.match(html, /<h3 class="event-h">Notable event<\/h3>/);
  assert.match(html, /Named in the poll lead/);
  assert.match(html, /Comments · Poll lead/);
  const snippetAt = html.indexOf("Named in the poll lead");
  const citeAt = html.indexOf("casey-vale-notable");
  assert.ok(snippetAt >= 0 && citeAt > snippetAt);
  assert.equal(eventTagRow({ kind: "notable_event", event_date: "2024-06-15", sources: MORE.map((url) => ({ url })) }), "");
});

test("person detail shows Notable event when a notable person_event exists", async () => {
  setMemory(goldSeed());
  const before = (await listPeople("notable")).length;
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  });
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "notable",
    cite_urls: MORE,
    comments: "Poll lead",
  });
  const person = await getPerson("casey-vale");
  assert.equal(person.country_of_origin, "United States");
  const kinds = (person.events || []).map((ev) => ev.kind).sort();
  assert.deepEqual(kinds, ["arrests", "notable"]);

  const html = personDetail(person);
  assert.match(html, /data-kind="notable"/);
  assert.match(html, /<h3 class="event-h">Notable event<\/h3>/);
  assert.match(html, /data-kind="arrests"/);
  assert.match(html, /casey-vale-notable/);
  assert.doesNotMatch(html, /Aisha|Gaddafi|Muammar/);

  const page = await requestPage("/people/casey-vale");
  assert.equal(page.status, 200);
  assert.match(page.body, /<h3 class="event-h">Notable event<\/h3>/);
  assert.match(page.body, /data-kind="notable"/);

  const list = await requestPage("/notable");
  assert.equal(list.status, 200);
  assert.match(list.body, /Notable event/);
  assert.match(list.body, /href="\/notable"/);
  assert.match(list.body, />Notable</);
  assert.match(list.body, /Casey Vale/);
  assert.match(list.body, /class="pager"/);
  assert.equal((await listPeople("notable")).length, before + 1);

  const reason = rankDimension([person], "reason");
  const notable = reason.find((row) => row.key === "notable");
  assert.equal(notable.label, "Notable event");
  assert.equal(notable.href, "/notable");
  assert.equal(notable.count, 1);
});

test("promote and add form accept notable and reject an unknown kind", async () => {
  const ok = validateIdentifiedPersonInput({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "notable",
    cite_urls: CITES,
  });
  assert.equal(ok.category, "notable");
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        ...NEW_PERSON_LOCK,
        subject: "Casey Vale",
        event_date: "2024-06-15",
        category: "notable_event",
        cite_urls: CITES,
      }),
    /category must be one of:/,
  );
  const add = await requestPage("/add");
  assert.match(add.body, /value="notable"/);
  assert.match(add.body, />Notable event</);
  const home = await requestPage("/");
  assert.match(home.body, /data-key="v"[^>]*>[\s\S]*Notable</);
});
