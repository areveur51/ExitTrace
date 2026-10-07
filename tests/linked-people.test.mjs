import assert from "node:assert/strict";
import { test } from "node:test";
import { kindDetail } from "../app/lib/html.mjs";
import { linkedPersonIds } from "../app/lib/kind-comms.mjs";
import { buildUpsertSql, pickRow, PUBLISHED_TABLES } from "../app/lib/gap-upsert.mjs";
import {
  getKindComm,
  getPeopleByIds,
  mergeGoldKindComms,
  mergeKindSnapshotFillEmpty,
  setMemory,
} from "../app/lib/store.mjs";
import { handle } from "../app/server.mjs";

const SHOT = "/media/screenshots/shot-comms/newstreason.png";
const VIDEO = "/media/shot-comms/newstreason.mp4";
const STILL = "/media/shot-comms/newstreason.jpg";
const EXTRA = "/media/shot-comms/newstreason-extra.jpg";
const SUPPORT = "/media/shot-comms/newstreason-support.jpg";
const IDS = ["joe-biden", "hillary-clinton", "barack-obama", "donald-trump"];

function person(id, name) {
  return {
    id,
    category: "firings",
    name,
    event_date: "2021-01-20",
    photo: `/media/people/${id}.jpg`,
    sources: [],
    events: [],
  };
}

const PEOPLE = [
  person("joe-biden", "Joe Biden"),
  person("hillary-clinton", "Hillary Clinton"),
  person("barack-obama", "Barack Obama"),
  person("donald-trump", "Donald Trump"),
];

function shotRow(overrides = {}) {
  return {
    id: "newstreason-2026-10-07-792caf90",
    posted_at: "2026-10-07T17:54:00Z",
    handle: "@NewsTreason",
    account_name: "NewsTreason Channel 17",
    text: "I've had my shot, and STILL DO…at Biden, at Hillary Clinton, and Barack Hussein Obama…",
    still: STILL,
    still_credit: "Stored video thumbnail",
    screenshot: SHOT,
    screenshot_credit: "@NewsTreason",
    source_url: "https://x.com/NewsTreason/status/2107892293160386907",
    snapshot: {
      video: VIDEO,
      stills: [STILL, EXTRA],
      person_ids: [...IDS],
      supporting: [
        {
          handle: "@Ally",
          source_url: "https://x.com/Ally/status/2",
          still: SUPPORT,
        },
      ],
    },
    ...overrides,
  };
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, hdrs) {
        this.statusCode = status;
        this.headers = hdrs || {};
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          headers: this.headers,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

function sliceBetween(html, startMark, endMark) {
  const start = html.indexOf(startMark);
  const end = endMark ? html.indexOf(endMark) : html.length;
  assert.ok(start >= 0, startMark);
  assert.ok(end > start, endMark || "end");
  return html.slice(start, end);
}

test("linkedPersonIds keeps order and drops blanks, repeats, and non-strings", () => {
  assert.deepEqual(
    linkedPersonIds({
      person_ids: ["joe-biden", " joe-biden ", "hillary-clinton", "", "  ", 3, { id: "x" }, "barack-obama"],
    }),
    ["joe-biden", "hillary-clinton", "barack-obama"],
  );
  assert.deepEqual(linkedPersonIds(["donald-trump", "donald-trump"]), ["donald-trump"]);
  assert.deepEqual(linkedPersonIds({}), []);
  assert.deepEqual(linkedPersonIds(null), []);
});

test("kind snapshot keeps person_ids across read and fill-empty merge", async () => {
  setMemory({
    people: [],
    shot_comms: [
      shotRow({
        snapshot: {
          person_ids: ["joe-biden", "joe-biden", " hillary-clinton ", "", { id: "nope" }, "barack-obama"],
          video: VIDEO,
        },
      }),
    ],
  });
  const stored = await getKindComm("shot", "newstreason-2026-10-07-792caf90");
  assert.deepEqual(stored.snapshot.person_ids, ["joe-biden", "hillary-clinton", "barack-obama"]);
  assert.equal(stored.snapshot.video, VIDEO);

  const kept = mergeKindSnapshotFillEmpty(
    { video: VIDEO },
    {
      person_ids: [...IDS],
      stills: [STILL],
      supporting: [{ source_url: "https://x.com/Ally/status/2", handle: "@Ally" }],
    },
  );
  assert.deepEqual(kept.person_ids, IDS);
  assert.deepEqual(kept.stills, [STILL]);
  assert.equal(kept.supporting[0].source_url, "https://x.com/Ally/status/2");
  assert.equal(kept.video, VIDEO);

  const emptyNext = mergeKindSnapshotFillEmpty({ person_ids: [] }, { person_ids: ["joe-biden"] });
  assert.deepEqual(emptyNext.person_ids, ["joe-biden"]);
  const seedWins = mergeKindSnapshotFillEmpty(
    { person_ids: ["donald-trump"] },
    { person_ids: ["joe-biden"] },
  );
  assert.deepEqual(seedWins.person_ids, ["donald-trump"]);

  const gold = mergeGoldKindComms(
    [
      shotRow({
        snapshot: { video: VIDEO },
      }),
    ],
    [
      shotRow({
        snapshot: { person_ids: [...IDS], video: "/media/shot-comms/old.mp4" },
      }),
    ],
    "shot",
  );
  assert.deepEqual(gold[0].snapshot.person_ids, IDS);
  assert.equal(gold[0].snapshot.video, VIDEO);
});

test("official post cards sit after context and before one shared supporting copy", () => {
  const html = kindDetail("shot", shotRow(), { linkedPeople: PEOPLE });
  const mainAt = html.indexOf('class="detail-official-post"');
  const contextAt = html.indexOf('class="detail-context"');
  const linkedAt = html.indexOf('class="detail-linked-people"');
  const supportAt = html.indexOf('class="detail-supporting"');
  assert.ok(mainAt >= 0 && contextAt > mainAt && linkedAt > contextAt && supportAt > linkedAt);

  const main = sliceBetween(html, 'class="detail-official-post"', 'class="detail-context"');
  const context = sliceBetween(html, 'class="detail-context"', 'class="detail-linked-people"');
  const linked = sliceBetween(html, 'class="detail-linked-people"', 'class="detail-supporting"');
  const support = html.slice(supportAt);

  assert.match(main, /detail-tile--video/);
  assert.match(main, new RegExp(VIDEO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(main, /poster="\/media\/shot-comms\/newstreason\.jpg"/);
  assert.match(main, /class="cite-block"/);
  assert.match(main, /class="handle">@NewsTreason</);
  assert.ok(main.includes(EXTRA));
  assert.doesNotMatch(main, /newstreason\.png/);
  assert.doesNotMatch(main, /detail-tile--source/);
  assert.doesNotMatch(main, /person-card/);

  assert.match(context, /Source ·/);
  assert.match(context, /2107892293160386907/);
  assert.doesNotMatch(context, /lightbox-open|person-card|detail-tile--screenshot/);

  assert.match(linked, /Linked individuals/);
  assert.match(linked, /<a class="tui-row person-card"/);
  assert.match(linked, /class="row-media"/);
  const hrefs = [...linked.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, IDS.map((id) => `/people/${id}`));
  assert.doesNotMatch(linked, /newstreason\.(png|mp4|jpg)/);
  assert.doesNotMatch(linked, /lightbox-open/);

  assert.match(support, /Supporting media/);
  assert.match(support, /data-supporting-own="post"/);
  assert.match(support, /detail-tile--screenshot/);
  assert.ok(support.includes(SHOT));
  assert.ok(support.includes(SUPPORT));
  assert.doesNotMatch(support, /newstreason\.mp4/);
  assert.doesNotMatch(support, /<img[^>]+src="\/media\/shot-comms\/newstreason\.jpg"/);
  assert.doesNotMatch(support, /class="cite-block"|person-card/);
  assert.ok(support.indexOf(SHOT) < support.indexOf(SUPPORT));

  assert.equal((html.match(/detail-tile--video/g) || []).length, 1);
  assert.equal((html.match(/detail-tile--screenshot/g) || []).length, 1);
  assert.equal((html.match(/newstreason\.png/g) || []).length, 2);
});

test("unknown person ids are omitted and no linked block renders without links", async () => {
  const partial = kindDetail("shot", shotRow(), {
    linkedPeople: [PEOPLE[0], PEOPLE[3]],
  });
  const linked = sliceBetween(partial, 'class="detail-linked-people"', 'class="detail-supporting"');
  const hrefs = [...linked.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/people/joe-biden", "/people/donald-trump"]);
  assert.doesNotMatch(partial, /hillary-clinton|barack-obama/);

  const bare = kindDetail("shot", shotRow({ snapshot: { video: VIDEO, stills: [EXTRA] } }), {
    linkedPeople: PEOPLE,
  });
  assert.doesNotMatch(bare, /detail-linked-people|data-supporting-own/);
  assert.match(bare, /class="detail-official-post"[\s\S]*newstreason\.png/);
  assert.doesNotMatch(bare, /detail-supporting[\s\S]*newstreason\.png/);

  const unknownOnly = kindDetail("shot", shotRow(), { linkedPeople: [] });
  assert.doesNotMatch(unknownOnly, /detail-linked-people|data-supporting-own/);
  assert.match(unknownOnly, /class="detail-official-post"[\s\S]*detail-tile--screenshot/);

  setMemory({ people: PEOPLE, shot_comms: [] });
  const found = await getPeopleByIds([
    "not-a-person",
    "hillary-clinton",
    "joe-biden",
    "joe-biden",
    "",
  ]);
  assert.deepEqual(
    found.map((row) => row.id),
    ["hillary-clinton", "joe-biden"],
  );
});

test("dog official posts reuse the same linked-person block", () => {
  const html = kindDetail(
    "dog",
    {
      id: "dog-linked",
      posted_at: "2026-01-15",
      handle: "@EzraACohen",
      account_name: "Ezra Cohen",
      text: "Dog post.",
      still: "/media/dog-comms/ezra.jpg",
      screenshot: "/media/screenshots/dog-comms/ezra.png",
      source_url: "https://x.com/EzraACohen/status/1",
      snapshot: { person_ids: ["joe-biden", "not-real"] },
    },
    { linkedPeople: [PEOPLE[0]] },
  );
  const mainAt = html.indexOf('class="detail-official-post"');
  const contextAt = html.indexOf('class="detail-context"');
  const linkedAt = html.indexOf('class="detail-linked-people"');
  const supportAt = html.indexOf('class="detail-supporting"');
  assert.ok(mainAt >= 0 && contextAt > mainAt && linkedAt > contextAt && supportAt > linkedAt);
  assert.match(html, /href="\/people\/joe-biden"/);
  assert.doesNotMatch(html, /not-real/);
  assert.equal((html.match(/detail-tile--screenshot/g) || []).length, 1);
  assert.ok(html.indexOf("ezra.png") > supportAt);
  assert.doesNotMatch(html.slice(mainAt, contextAt), /ezra\.png/);
});

test("shot detail route resolves linked people and does not repeat post media on cards", async () => {
  setMemory({
    people: PEOPLE,
    shot_comms: [
      shotRow({
        snapshot: {
          video: VIDEO,
          stills: [STILL],
          person_ids: ["joe-biden", "not-a-person", "joe-biden", "hillary-clinton", "barack-obama", "donald-trump"],
        },
      }),
    ],
  });
  const page = await requestPage("/shot-comms/newstreason-2026-10-07-792caf90");
  assert.equal(page.status, 200);
  const html = page.body;
  const linked = sliceBetween(html, 'class="detail-linked-people"', 'class="detail-supporting"');
  const hrefs = [...linked.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, IDS.map((id) => `/people/${id}`));
  assert.doesNotMatch(linked, /newstreason\.(png|mp4|jpg)/);
  assert.match(html, /data-supporting-own="post"/);
  assert.equal((html.match(/detail-tile--screenshot/g) || []).length, 1);
  assert.equal((html.match(/detail-tile--video/g) || []).length, 1);
  const supportAt = html.indexOf('class="detail-supporting"');
  const main = sliceBetween(html, 'class="detail-official-post"', 'class="detail-context"');
  assert.doesNotMatch(main, /newstreason\.png/);
  assert.ok(html.indexOf("newstreason.png") > supportAt);
});

test("gap-upsert carries person_ids inside snapshot and adds no column", () => {
  assert.ok(PUBLISHED_TABLES.includes("shot_comms"));
  const row = shotRow();
  const picked = pickRow("shot_comms", row);
  assert.deepEqual(Object.keys(picked), [
    "id",
    "posted_at",
    "handle",
    "account_name",
    "text",
    "still",
    "still_credit",
    "screenshot",
    "screenshot_credit",
    "source_url",
    "snapshot",
  ]);
  assert.equal("person_ids" in picked, false);
  const snap = JSON.parse(picked.snapshot);
  assert.deepEqual(snap.person_ids, IDS);
  assert.equal(snap.video, VIDEO);
  const built = buildUpsertSql("shot_comms", [row]);
  assert.match(built.sql, /INSERT INTO shot_comms/);
  assert.match(built.sql, /snapshot/);
  assert.doesNotMatch(built.sql, /\bperson_ids\b/);
  assert.match(JSON.stringify(built.params), /joe-biden/);
  assert.doesNotMatch(built.sql, /DROP |DELETE |TRUNCATE /);
});
