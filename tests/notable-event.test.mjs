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
import { projectPerson, validateIdentifiedPersonInput } from "../app/lib/promote.mjs";
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

const SHOT = "/media/screenshots/people/casey-vale-notable.jpg";
const HEADER_SHOT = "/media/screenshots/people/casey-vale.jpg";
const CLIP = "/media/people/casey-vale/support/poll-clip.jpg";
const ARREST_CLIP = "/media/people/casey-vale/support/arrest-clip.jpg";
const X_POST = "https://x.com/Desk/status/2100000000000000001";

test("notable is a bottom media block, not an event timeline row", () => {
  assert.equal(
    eventTagRow({
      kind: "notable",
      event_date: "2024-08-01",
      comments: "Poll lead",
      sources: MORE.map((url) => ({ url })),
    }),
    "",
  );
  const html = personDetail({
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    photo: "/media/people/casey-vale.jpg",
    screenshot: HEADER_SHOT,
    events: [
      {
        kind: "arrests",
        event_date: "2024-06-15",
        comments: "Held after contemporaneous reports.",
        sources: [
          { url: CITES[0], publisher: "Desk", date: "2024-06-15", snippet: "Taken into custody." },
          { url: CITES[1], date: "2024-06-15" },
        ],
        media: [{ src: ARREST_CLIP, url: CITES[0], alt: "Arrest still" }],
      },
      {
        kind: "notable",
        event_date: "2024-08-01",
        comments: "Named in a published poll of public figures.",
        screenshot: SHOT,
        screenshot_credit: "X post",
        sources: [
          {
            url: MORE[0],
            publisher: "Desk",
            date: "2024-08-01",
            snippet: "Named in the poll lead",
          },
          { url: X_POST, publisher: "Desk", date: "2024-08-01", snippet: "Post text stays off the cite." },
        ],
        media: [{ src: CLIP, url: X_POST, alt: "Downloaded post still" }],
      },
    ],
  });
  assert.doesNotMatch(html, /data-kind="notable"[^>]*class="event-tag-row"|class="event-tag-row"[^>]*data-kind="notable"/);
  assert.match(html, /data-kind="arrests"/);
  const timelineAt = html.indexOf('class="event-timeline"');
  const notableAt = html.indexOf('class="detail-notable detail-supporting"');
  const supportAt = html.indexOf('class="detail-supporting"');
  assert.ok(timelineAt >= 0 && notableAt > timelineAt && supportAt > notableAt);
  const notable = html.slice(notableAt, supportAt);
  const support = html.slice(supportAt);
  const header = html.slice(0, timelineAt);
  assert.match(notable, /<h3 class="event-h">Notable event<\/h3>/);
  assert.match(notable, /Named in a published poll of public figures\./);
  assert.match(notable, /Named in the poll lead/);
  assert.match(notable, new RegExp(`src="${SHOT}"`));
  assert.match(notable, /X-post screenshot/);
  assert.match(notable, new RegExp(`src="${CLIP}"`));
  assert.match(notable, /detail-tile--support/);
  assert.match(notable, /detail-support-masonry/);
  const cites = notable.slice(notable.indexOf('class="sources cite-list"'));
  const snippetAt = cites.indexOf("Named in the poll lead");
  const citeAt = cites.indexOf("https://www.example.com/news/casey-vale-notable");
  assert.ok(snippetAt >= 0 && citeAt > snippetAt);
  assert.match(notable, new RegExp(`href="${X_POST}"`));
  assert.doesNotMatch(notable, /Post text stays off the cite/);
  assert.doesNotMatch(notable, /Comments ·/);
  assert.doesNotMatch(support, new RegExp(SHOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(support, /poll-clip\.jpg/);
  assert.match(support, /arrest-clip\.jpg/);
  assert.match(header, new RegExp(HEADER_SHOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(header, /casey-vale-notable\.jpg/);
  assert.doesNotMatch(html, /Aisha|Gaddafi|Muammar/);

  const kept = projectPerson({
    id: "casey-vale",
    name: "Casey Vale",
    category: "notable",
    event_date: "2024-08-01",
    events: [
      {
        kind: "notable",
        event_date: "2024-08-01",
        comments: "Named in a published poll of public figures.",
        sources: [{ url: MORE[0] }, { url: X_POST }],
        screenshot: "https://pbs.twimg.com/media/remote.jpg",
        media: [{ src: CLIP }, { src: "/media/screenshots/people/casey-vale-notable.jpg" }],
      },
    ],
  });
  assert.equal(kept.events[0].screenshot, undefined);
  assert.deepEqual(kept.events[0].media, [{ src: CLIP }]);
  const stored = projectPerson({
    id: "casey-vale",
    name: "Casey Vale",
    category: "notable",
    event_date: "2024-08-01",
    screenshot: HEADER_SHOT,
    events: [
      {
        kind: "notable",
        event_date: "2024-08-01",
        sources: [{ url: MORE[0] }, { url: X_POST }],
        screenshot: SHOT,
        screenshot_credit: "X post",
        media: [{ src: CLIP, alt: "Downloaded post still" }],
      },
    ],
  });
  assert.equal(stored.screenshot, HEADER_SHOT);
  assert.equal(stored.events[0].screenshot, SHOT);
  assert.equal(stored.events[0].screenshot_credit, "X post");
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
    comments: "Named in a published poll of public figures.",
    screenshot: SHOT,
    media: [{ src: CLIP, url: MORE[0], alt: "Downloaded post still" }],
  });
  const person = await getPerson("casey-vale");
  assert.equal(person.country_of_origin, "United States");
  const kinds = (person.events || []).map((ev) => ev.kind).sort();
  assert.deepEqual(kinds, ["arrests", "notable"]);
  const notableEvent = person.events.find((ev) => ev.kind === "notable");
  assert.equal(notableEvent.screenshot, SHOT);
  assert.equal(notableEvent.comments, "Named in a published poll of public figures.");
  assert.equal(notableEvent.media[0].src, CLIP);

  const html = personDetail(person);
  assert.match(html, /class="detail-notable detail-supporting"/);
  assert.match(html, /<h3 class="event-h">Notable event<\/h3>/);
  assert.doesNotMatch(html, /class="event-tag-row"[^>]*data-kind="notable"/);
  assert.match(html, /data-kind="arrests"/);
  assert.match(html, new RegExp(`src="${SHOT}"`));
  assert.match(html, new RegExp(`src="${CLIP}"`));
  assert.match(html, /Named in a published poll of public figures\./);
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
