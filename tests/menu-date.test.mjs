import assert from "node:assert/strict";
import { test } from "node:test";
import { peopleList, shotCatalogList } from "../app/lib/html.mjs";
import { personMenuDate } from "../app/lib/menu-date.mjs";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";

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

const rogers = {
  id: "mike-rogers",
  name: "Mike Rogers",
  category: "corona_comms",
  event_date: "2021-01-03",
  tags: ["endorsements", "official"],
  events: [
    { kind: "corona_comms", event_date: "2021-01-03", sources: [] },
    { kind: "endorsement", event_date: "2026-05-18", comments: "Endorsed.", sources: [] },
  ],
};

test("a menu date is the event that menu is about", () => {
  assert.equal(personMenuDate(rogers, { tag: "endorsements" }), "2026-05-18");
  assert.equal(personMenuDate(rogers, { kinds: ["corona_comms"] }), "2021-01-03");
  assert.equal(personMenuDate(rogers, { tag: "masks" }), "");
  const list = peopleList([rogers], {
    listDate: (row) => personMenuDate(row, { tag: "endorsements" }),
  });
  assert.match(list, /<h2 class="tui-group-h">2026<\/h2>/);
  assert.match(list, /datetime="2026-05-18"/);
  assert.doesNotMatch(list, /<h2 class="tui-group-h">2021<\/h2>/);
  const stored = peopleList([rogers]);
  assert.match(stored, /<h2 class="tui-group-h">2021<\/h2>/);
});

test("nickname, file, transparency, and flight menus ignore the other event year", () => {
  const biden = {
    id: "joe-biden",
    name: "Joe Biden",
    category: "government_stepdowns",
    event_date: "2024-07-21",
    tags: ["trump_nickname", "masks"],
    events: [{ kind: "government_stepdowns", event_date: "2024-07-21", sources: [] }],
    nicknames: [
      {
        name: "Sleepy Joe",
        by: "Donald Trump",
        sources: [
          { url: "https://apnews.com/article/sleepy-a", publisher: "AP", date: "2019-06-11" },
          { url: "https://www.reuters.com/world/us/sleepy-b", publisher: "Reuters", date: "2026-09-21" },
        ],
      },
    ],
  };
  assert.equal(personMenuDate(biden, { tag: "trump_nickname" }), "2026-09-21");
  assert.equal(personMenuDate(biden, { tag: "masks" }), "");

  const scott = {
    id: "austin-scott",
    name: "Austin Scott",
    category: "corona_comms",
    event_date: "2021-01-03",
    tags: ["epstein_transparency_act"],
    events: [
      { kind: "corona_comms", event_date: "2021-01-03", sources: [] },
      {
        kind: "notable",
        event_date: "2025-07-17",
        comments:
          "On July 17, 2025, the House Rules Committee defeated a motion on H.R. 4405, the Epstein Files Transparency Act.",
        sources: [],
      },
    ],
  };
  assert.equal(personMenuDate(scott, { tag: "epstein_transparency_act" }), "2025-07-17");

  const rubio = {
    id: "marco-rubio",
    name: "Marco Rubio",
    category: "nickname",
    event_date: "2016-05-09",
    tags: ["epstein_files"],
    events: [
      {
        kind: "notable",
        event_date: "2017-10-26",
        sources: [{ url: "https://www.justice.gov/epstein/files/DataSet%209/EFTA00975176.pdf" }],
      },
    ],
  };
  assert.equal(personMenuDate(rubio, { tag: "epstein_files" }), "2017-10-26");

  const andrew = {
    id: "prince-andrew",
    name: "Prince Andrew",
    category: "resignations",
    event_date: "2019-11-20",
    tags: ["epstein_clients"],
    events: [{ kind: "resignations", event_date: "2019-11-20", sources: [] }],
  };
  assert.equal(
    personMenuDate(andrew, { tag: "epstein_clients", flightDate: "2000-05-12" }),
    "2000-05-12",
  );
  const logged = {
    ...andrew,
    events: [
      { kind: "resignations", event_date: "2019-11-20", sources: [] },
      { kind: "epstein_clients", event_date: "2000-05-12", sources: [] },
    ],
  };
  assert.equal(personMenuDate(logged, { tag: "epstein_clients", flightDate: "1999-01-01" }), "2000-05-12");
});

test("fact-tag and category pages group cards by that menu's event year", async () => {
  process.env.DATABASE_URL = "";
  setMemory({
    people: [
      rogers,
      {
        id: "other-person",
        name: "Other Person",
        category: "firings",
        event_date: "2020-01-01",
        tags: [],
        events: [
          { kind: "firings", event_date: "2020-01-01", sources: [] },
          { kind: "endorsement", event_date: "2024-06-01", sources: [] },
        ],
      },
    ],
  });
  const endorsements = await requestPage("/tags/endorsements");
  assert.equal(endorsements.status, 200);
  assert.match(endorsements.body, /<h2 class="tui-group-h">2026<\/h2>/);
  assert.match(endorsements.body, /datetime="2026-05-18"/);
  assert.doesNotMatch(endorsements.body, /<h2 class="tui-group-h">2021<\/h2>/);
  const firings = await requestPage("/firings");
  assert.match(firings.body, /<h2 class="tui-group-h">2020<\/h2>/);
  assert.match(firings.body, /datetime="2020-01-01"/);
  assert.doesNotMatch(firings.body, /<h2 class="tui-group-h">2024<\/h2>/);
});

test("a shot person card uses the post year, not the person's other event", () => {
  const html = shotCatalogList(
    [
      {
        id: "shot-1",
        posted_at: "2026-10-07T17:00:00Z",
        handle: "@example",
        snapshot: { person_ids: ["joe-biden"], named: ["Joe Biden"] },
      },
    ],
    [
      {
        id: "joe-biden",
        name: "Joe Biden",
        category: "government_stepdowns",
        event_date: "2024-07-21",
      },
    ],
  );
  assert.match(html, /<h2 class="tui-group-h">2026<\/h2>/);
  assert.match(html, /datetime="2026-10-07"/);
  assert.doesNotMatch(html, /datetime="2024-07-21"/);
});
