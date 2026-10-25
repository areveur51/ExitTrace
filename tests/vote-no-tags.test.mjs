import assert from "node:assert/strict";
import { test } from "node:test";
import { personDetail } from "../app/lib/html.mjs";
import { personMenuDate } from "../app/lib/menu-date.mjs";
import { projectPerson } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { listPeople, setMemory, setPoolForTests, syncPersonEvents } from "../app/lib/store.mjs";
import { ATTRIBUTE_TAG_IDS, attributeTagById, normalizeTags } from "../app/lib/tags.mjs";
import {
  VOTE_NO_KIND_IDS,
  VOTE_NO_TAGS,
  VOTE_ROLLS,
  houseClerkVoteUrl,
  houseClerkXmlUrl,
  officialRollUrls,
  parseRollId,
  senateRollCallUrl,
} from "../app/lib/vote-rolls.mjs";

/** Recorded-no rolls. The catalog also holds vote-fact rolls for the dashboard party split. */
const NO_ROLLS = Object.values(VOTE_ROLLS).filter((roll) => VOTE_NO_KIND_IDS.includes(roll.tag));
const PROCEDURAL = new Set(["S-119-2-73", "S-119-2-231", "H-119-2-83"]);

const LABELS = {
  big_beautiful_bill_act: ["One Big Beautiful Bill Act", "/tags/one-big-beautiful-bill-act"],
  save_act: ["SAVE Act", "/tags/save-act"],
  secure_the_border_act: ["Secure the Border Act", "/tags/secure-the-border-act"],
  laken_riley_act: ["Laken Riley Act", "/tags/laken-riley-act"],
  save_america_act: ["SAVE America Act", "/tags/save-america-act"],
  s_5271_photo_id: ["S. 5271", "/tags/s-5271"],
};

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

function personWith(events) {
  return projectPerson({
    id: "vote-card",
    name: "Vote Card",
    category: "notable",
    event_date: "2019-01-03",
    tags: [...new Set(events.map((ev) => ev.kind))],
    events: [
      { kind: "notable", event_date: "2019-01-03", comments: "Earlier record.", sources: [] },
      ...events,
    ],
  });
}

function voteSections(html) {
  return html.match(/<section class="detail-recorded-vote\b[^"]*"[\s\S]*?<\/section>/g) || [];
}

test("the closed catalog has six labels and normalizeTags keeps them", () => {
  assert.deepEqual(VOTE_NO_KIND_IDS, Object.keys(LABELS));
  assert.equal(VOTE_NO_TAGS.length, 6);
  for (const tag of VOTE_NO_TAGS) {
    const [nav, path] = LABELS[tag.id];
    assert.equal(tag.nav, nav);
    assert.equal(tag.path, path);
    assert.equal(attributeTagById(tag.id)?.nav, nav);
    assert.equal(attributeTagById(tag.id)?.path, path);
    assert.equal(ATTRIBUTE_TAG_IDS.includes(tag.id), true);
    assert.doesNotMatch(tag.nav, /voted\s+no/i);
    assert.doesNotMatch(tag.nav, /\b(?:19|20)\d{2}\b/);
    if (tag.id === "s_5271_photo_id") {
      assert.equal(tag.nav, "S. 5271");
    } else {
      assert.doesNotMatch(tag.nav, /\b(?:H\.?\s*R\.?|H\.?\s*Res\.?|S\.)\s*\d+/i);
    }
  }
  assert.deepEqual(normalizeTags([...VOTE_NO_KIND_IDS, "nope"]), [...VOTE_NO_KIND_IDS]);
});

test("VOTE_ROLLS entries are dated, staged, and point at catalog tags", () => {
  const ids = Object.keys(VOTE_ROLLS);
  assert.equal(ids.length, 13);
  assert.equal(NO_ROLLS.length, 10);
  for (const id of ids) {
    const roll = VOTE_ROLLS[id];
    assert.equal(roll.id, id);
    assert.match(roll.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(roll.stage === "passage" || roll.stage === "procedural", id);
    assert.equal(ATTRIBUTE_TAG_IDS.includes(roll.tag), true, roll.tag);
    assert.equal(roll.chamber === "House" || roll.chamber === "Senate", true);
  }
  for (const id of ids) {
    assert.equal(VOTE_ROLLS[id].stage, PROCEDURAL.has(id) ? "procedural" : "passage", id);
  }
});

test("URL helpers build the official House and Senate pages from the roll id", () => {
  assert.equal(houseClerkVoteUrl("H-119-1-145", "2025-05-22"), "https://clerk.house.gov/Votes/2025145");
  assert.equal(houseClerkXmlUrl("H-119-1-145", "2025-05-22"), "https://clerk.house.gov/evs/2025/roll145.xml");
  assert.deepEqual(officialRollUrls("H-119-1-145"), [
    "https://clerk.house.gov/Votes/2025145",
    "https://clerk.house.gov/evs/2025/roll145.xml",
  ]);
  assert.equal(
    senateRollCallUrl("S-119-1-372"),
    "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00372.htm",
  );
  assert.deepEqual(officialRollUrls("S-119-1-372"), [
    "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00372.htm",
  ]);
  assert.equal(
    senateRollCallUrl("S-119-2-231"),
    "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00231.htm",
  );
  assert.deepEqual(officialRollUrls("S-119-2-231"), [
    "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00231.htm",
  ]);
});

test("roll_call stays on each event and does not replace the stored category or date", () => {
  const row = projectPerson({
    id: "keep-example",
    name: "Keep Example",
    category: "firings",
    event_date: "2019-06-01",
    tags: ["big_beautiful_bill_act"],
    events: [
      { kind: "firings", event_date: "2019-06-01", sources: [] },
      {
        kind: "big_beautiful_bill_act",
        event_date: "2025-05-22",
        roll_call: "H-119-1-145",
        sources: [],
      },
      {
        kind: "big_beautiful_bill_act",
        event_date: "2025-07-01",
        roll_call: "S-119-1-372",
        sources: [],
      },
      {
        kind: "big_beautiful_bill_act",
        event_date: "2025-07-03",
        roll_call: "H-119-1-190",
        sources: [],
      },
    ],
  });
  assert.equal(row.category, "firings");
  assert.equal(row.event_date, "2019-06-01");
  const rolls = row.events.filter((ev) => ev.kind === "big_beautiful_bill_act");
  assert.deepEqual(
    rolls.map((ev) => ev.roll_call).sort(),
    ["H-119-1-145", "H-119-1-190", "S-119-1-372"],
  );
  const json = JSON.parse(JSON.stringify(row));
  assert.deepEqual(
    json.events.filter((ev) => ev.kind === "big_beautiful_bill_act").map((ev) => ev.roll_call).sort(),
    ["H-119-1-145", "H-119-1-190", "S-119-1-372"],
  );

  for (const tag of VOTE_NO_KIND_IDS) {
    const sample = Object.values(VOTE_ROLLS).find((roll) => roll.tag === tag);
    const kept = projectPerson({
      id: `keep-${tag}`,
      name: "Keep Example",
      category: "notable",
      event_date: "2019-01-03",
      tags: [tag],
      events: [
        { kind: "notable", event_date: "2019-01-03", sources: [] },
        { kind: tag, event_date: sample.date, roll_call: sample.id, sources: [] },
      ],
    });
    assert.equal(kept.category, "notable", tag);
    assert.equal(kept.event_date, "2019-01-03", tag);
    assert.equal(kept.events.find((ev) => ev.kind === tag).roll_call, sample.id);
  }

  const fromComments = projectPerson({
    id: "token-example",
    name: "Token Example",
    category: "notable",
    event_date: "2019-01-03",
    tags: ["save_act"],
    events: [
      { kind: "notable", event_date: "2019-01-03", sources: [] },
      { kind: "save_act", event_date: "2025-04-10", comments: "H-119-1-102", sources: [] },
    ],
  });
  assert.equal(fromComments.events.find((ev) => ev.kind === "save_act").roll_call, "H-119-1-102");
});

test("a passage card shows Final passage and Voted no, with cites escaped", () => {
  const row = personWith([
    {
      kind: "big_beautiful_bill_act",
      event_date: "2025-05-22",
      roll_call: "H-119-1-145",
      comments: "Tom & <Jerry>",
      sources: [
        {
          url: "https://example.com/news-a",
          publisher: "Desk <b> &",
          date: "2025-05-22",
          snippet: "Quote <a> & co",
        },
        { url: "https://example.com/news-b", publisher: "Other Desk", date: "2025-05-22" },
      ],
      media: [{ src: "/media/people/vote-card/support/roll-clip.jpg", alt: "clip" }],
    },
  ]);
  const html = personDetail(row);
  const [section] = voteSections(html);
  assert.ok(section);
  assert.match(section, /H\.R\. 1 · House roll 145/);
  assert.match(section, /Final passage/);
  assert.match(section, /Position · Voted no/);
  assert.match(section, /datetime="2025-05-22"/);
  assert.match(section, /Congress 119, session 1/);
  assert.match(section, /roll 145/);
  assert.match(section, /Question · On Passage/);
  assert.match(section, /Passed · 215-214, 1 present, 2 not voting/);
  assert.match(section, /https:\/\/example\.com\/news-a/);
  assert.match(section, /https:\/\/example\.com\/news-b/);
  assert.match(section, /https:\/\/clerk\.house\.gov\/Votes\/2025145/);
  assert.ok((section.match(/<li\b/g) || []).length >= 2);
  assert.match(section, /Tom &amp; &lt;Jerry&gt;/);
  assert.match(section, /Desk &lt;b&gt; &amp;/);
  assert.match(section, /Quote &lt;a&gt; &amp; co/);
  assert.doesNotMatch(section, /Tom & <Jerry>/);
  assert.doesNotMatch(section, /Desk <b>/);
  assert.doesNotMatch(section, /Quote <a>/);
  assert.doesNotMatch(html, /roll-clip\.jpg/);
  assert.doesNotMatch(html, /aria-label="Supporting media"/);
  const keptMedia = row.events.find((ev) => ev.kind === "big_beautiful_bill_act");
  assert.equal(keptMedia.media[0].src, "/media/people/vote-card/support/roll-clip.jpg");
  assert.equal(row.category, "notable");
  assert.equal(row.event_date, "2019-01-03");
});

test("the official roll URL is added when missing and not repeated when present", () => {
  const missing = personWith([
    {
      kind: "big_beautiful_bill_act",
      event_date: "2025-05-22",
      roll_call: "H-119-1-145",
      sources: [
        { url: "https://example.com/news-a", publisher: "Example", date: "2025-05-22" },
        { url: "https://example.com/news-b", publisher: "Example Two", date: "2025-05-22" },
      ],
    },
  ]);
  const [added] = voteSections(personDetail(missing));
  assert.equal((added.match(/href="https:\/\/clerk\.house\.gov\/Votes\/2025145"/g) || []).length, 1);

  const present = personWith([
    {
      kind: "big_beautiful_bill_act",
      event_date: "2025-05-22",
      roll_call: "H-119-1-145",
      sources: [
        {
          url: "https://clerk.house.gov/Votes/2025145",
          publisher: "Office of the Clerk, U.S. House of Representatives",
          date: "2025-05-22",
        },
        { url: "https://example.com/news-b", publisher: "Other Desk", date: "2025-05-22" },
      ],
    },
  ]);
  const [again] = voteSections(personDetail(present));
  assert.equal((again.match(/href="https:\/\/clerk\.house\.gov\/Votes\/2025145"/g) || []).length, 1);
  assert.ok((again.match(/<li\b/g) || []).length >= 2);
});

test("a procedural roll says Procedural (cloture) and does not say passage", () => {
  const row = personWith([
    {
      kind: "s_5271_photo_id",
      event_date: "2026-08-08",
      roll_call: "S-119-2-231",
      sources: [
        { url: "https://example.com/cloture-a", publisher: "Example", date: "2026-08-08" },
        { url: "https://example.com/cloture-b", publisher: "Example Two", date: "2026-08-08" },
      ],
    },
  ]);
  const [section] = voteSections(personDetail(row));
  assert.match(section, /S\. 5271 · Senate vote 231/);
  assert.match(section, /Procedural \(cloture\)/);
  assert.match(section, /Position · Voted no/);
  assert.match(section, /On Cloture on the Motion to Proceed/);
  assert.match(section, /52-46, 2 not voting/);
  assert.doesNotMatch(section, /passage/i);
  assert.match(
    section,
    /https:\/\/www\.senate\.gov\/legislative\/LIS\/roll_call_votes\/vote1192\/vote_119_2_00231\.htm/,
  );
  assert.ok((section.match(/<li\b/g) || []).length >= 2);
});

test("a missing roll_call renders from the event and does not throw", () => {
  const row = personWith([
    {
      kind: "save_act",
      event_date: "2025-04-10",
      roll_call: "nope",
      comments: "A note & <b>",
      sources: [
        { url: "https://example.com/s1", publisher: "One", date: "2025-04-10" },
        { url: "https://example.com/s2", publisher: "Two", date: "2025-04-10" },
      ],
    },
  ]);
  assert.equal(row.events.find((ev) => ev.kind === "save_act").roll_call, undefined);
  const [section] = voteSections(personDetail(row));
  assert.match(section, />SAVE Act</);
  assert.match(section, /Position · Voted no/);
  assert.match(section, /A note &amp; &lt;b&gt;/);
  assert.doesNotMatch(section, /A note & <b>/);
  assert.doesNotMatch(section, /Final passage/);
  assert.doesNotMatch(section, /clerk\.house\.gov/);
  assert.equal((section.match(/<li\b/g) || []).length, 2);
});

test("menuDate for each vote tag is the newest event of that kind", () => {
  const byTag = new Map();
  for (const roll of NO_ROLLS) {
    const list = byTag.get(roll.tag) || [];
    list.push({
      kind: roll.tag,
      event_date: roll.date,
      roll_call: roll.id,
      sources: [],
    });
    byTag.set(roll.tag, list);
  }
  for (const [tag, events] of byTag) {
    const newest = events.map((ev) => ev.event_date).sort().at(-1);
    const row = {
      id: tag,
      name: "Menu Example",
      category: "notable",
      event_date: "2010-01-01",
      tags: [tag],
      events: [{ kind: "notable", event_date: "2010-01-01", sources: [] }, ...events],
    };
    assert.equal(personMenuDate(row, { tag }), newest, tag);
    assert.notEqual(personMenuDate(row, { tag }), "2010-01-01");
  }
});

test("a deceased former member stays on the tag list and the card", async () => {
  const member = {
    id: "former-member-example",
    name: "Former Member Example",
    category: "death_official",
    role: "Former U.S. Representative",
    event_date: "2026-01-15",
    death_date: "2026-01-15",
    tags: ["big_beautiful_bill_act", "official"],
    events: [
      {
        kind: "death_official",
        event_date: "2026-01-15",
        sources: [
          { url: "https://example.com/death-a", publisher: "Example", date: "2026-01-15" },
          { url: "https://example.com/death-b", publisher: "Example Two", date: "2026-01-15" },
        ],
      },
      {
        kind: "big_beautiful_bill_act",
        event_date: "2025-05-22",
        roll_call: "H-119-1-145",
        sources: [
          { url: "https://example.com/vote-a", publisher: "Example", date: "2025-05-22" },
          { url: "https://example.com/vote-b", publisher: "Example Two", date: "2025-05-22" },
        ],
      },
    ],
  };
  setMemory({
    people: [
      member,
      {
        id: "living-other",
        name: "Living Other",
        category: "firings",
        role: "Former U.S. Representative",
        event_date: "2024-01-01",
        tags: [],
        events: [{ kind: "firings", event_date: "2024-01-01", sources: [] }],
      },
      {
        id: "dead-other",
        name: "Dead Other",
        category: "death_official",
        role: "Former U.S. Senator",
        event_date: "2025-02-02",
        death_date: "2025-02-02",
        tags: ["official"],
        events: [{ kind: "death_official", event_date: "2025-02-02", sources: [] }],
      },
    ],
  });
  const listed = await listPeople({ tags: ["big_beautiful_bill_act"] });
  assert.deepEqual(listed.map((row) => row.id), ["former-member-example"]);
  assert.equal(listed[0].category, "death_official");
  assert.equal(listed[0].death_date, "2026-01-15");
  assert.match(listed[0].role, /Former/);

  const page = await requestPage("/tags/one-big-beautiful-bill-act");
  assert.equal(page.status, 200);
  assert.match(page.body, /One Big Beautiful Bill Act/);
  assert.match(page.body, /voted no on H\.R\. 1/);
  assert.match(page.body, /href="\/people\/former-member-example"/);
  assert.match(page.body, /Former Member Example/);
  assert.match(page.body, /Former U\.S\. Representative/);
  assert.doesNotMatch(page.body, /href="\/people\/living-other"/);
  assert.doesNotMatch(page.body, /href="\/people\/dead-other"/);
  assert.doesNotMatch(page.body, /<option[^>]*>One Big Beautiful Bill Act<\/option>/);

  const [section] = voteSections(personDetail(listed[0]));
  assert.match(section, /data-kind="big_beautiful_bill_act"/);
  assert.match(section, /H\.R\. 1 · House roll 145/);
  assert.match(section, /Final passage/);
  assert.match(section, /Position · Voted no/);
});

function recordingClient() {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };
  return { client, queries };
}

function eventInserts(queries) {
  return queries.filter((q) => /INSERT INTO person_events/.test(q.sql));
}

function ordersOf(items) {
  if (items.length <= 1) return [items];
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const head = items[i];
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of ordersOf(rest)) out.push([head, ...tail]);
  }
  return out;
}

function hrefCount(html, url) {
  return String(html || "").split(`href="${url}"`).length - 1;
}

function pageVariants(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const path = `${parsed.pathname}${parsed.search}`;
  return [
    `https://${host}${path}`,
    `http://${host}${path}`,
    `https://www.${host}${path}`,
    `http://www.${host}${path}`,
  ];
}

function voteSectionFor(kind, rollId, date, url) {
  const row = personWith([
    {
      kind,
      event_date: date,
      roll_call: rollId,
      sources: [
        { url, publisher: "Record", date },
        { url: "https://example.com/news-b", publisher: "Other", date },
      ],
    },
  ]);
  return voteSections(personDetail(row))[0];
}

test("the companion row is the newest H.R. 1 roll in every input order", async () => {
  const rolls = [
    {
      kind: "big_beautiful_bill_act",
      event_date: "2025-05-22",
      roll_call: "H-119-1-145",
      sources: [],
    },
    {
      kind: "big_beautiful_bill_act",
      event_date: "2025-07-01",
      roll_call: "S-119-1-372",
      sources: [],
    },
    {
      kind: "big_beautiful_bill_act",
      event_date: "2025-07-03",
      roll_call: "H-119-1-190",
      sources: [],
    },
  ];
  const orders = ordersOf(rolls);
  assert.equal(orders.length, 6);
  for (const order of orders) {
    const row = {
      id: "hr1-member",
      name: "HR One",
      category: "firings",
      event_date: "2019-01-03",
      events: [{ kind: "firings", event_date: "2019-01-03", sources: [] }, ...order],
    };
    const { client, queries } = recordingClient();
    await syncPersonEvents(client, row);
    const inserts = eventInserts(queries);
    const companions = inserts.filter((q) => q.params[1] === "big_beautiful_bill_act");
    assert.equal(companions.length, 1);
    assert.equal(companions[0].params[3], "2025-07-03");
    assert.equal(companions[0].params[3], personMenuDate(row, { tag: "big_beautiful_bill_act" }));
    assert.match(companions[0].sql, /ON CONFLICT \(person_id, kind, seq\)/);
    assert.equal(queries.some((q) => /to_regclass\('person_events'\)/.test(q.sql)), false);
  }
});

test("listed event date SQL reads person_events.event_date", async () => {
  const queries = [];
  setPoolForTests({
    query(sql, params) {
      queries.push({ sql: String(sql), params });
      return Promise.resolve({ rows: [] });
    },
  });
  try {
    await listPeople({ category: "firings", minAge: 40, limit: 1 });
  } finally {
    setPoolForTests(null);
  }
  const sql = queries.map((q) => q.sql).join("\n");
  assert.match(sql, /FROM person_events e/);
  assert.match(sql, /MAX\(e\.event_date\)/);
  assert.match(sql, /ORDER BY COALESCE\(\(\s*SELECT MAX\(e\.event_date\) FROM person_events e/s);
  assert.match(sql, /EXTRACT\(YEAR FROM age\(/);
});

test("equal vote dates keep the greater roll id, and the same roll keeps the first", async () => {
  const lower = {
    kind: "big_beautiful_bill_act",
    event_date: "2025-07-03",
    roll_call: "H-119-1-145",
    comments: "lower roll",
    sources: [],
  };
  const higher = {
    kind: "big_beautiful_bill_act",
    event_date: "2025-07-03",
    roll_call: "H-119-1-190",
    comments: "higher roll",
    sources: [],
  };
  for (const order of [ [lower, higher], [higher, lower] ]) {
    const { client, queries } = recordingClient();
    await syncPersonEvents(client, {
      id: "tie-member",
      name: "Tie Member",
      category: "firings",
      event_date: "2019-01-03",
      events: order,
    });
    const companions = eventInserts(queries).filter((q) => q.params[1] === "big_beautiful_bill_act");
    assert.equal(companions.length, 1);
    assert.equal(companions[0].params[3], "2025-07-03");
    assert.equal(companions[0].params[10], "higher roll");
  }

  const seenFirst = { ...higher, comments: "seen first" };
  const seenSecond = { ...higher, comments: "seen second" };
  for (const [first, second] of [
    [seenFirst, seenSecond],
    [seenSecond, seenFirst],
  ]) {
    const { client, queries } = recordingClient();
    await syncPersonEvents(client, {
      id: "tie-member",
      name: "Tie Member",
      category: "firings",
      event_date: "2019-01-03",
      events: [first, second],
    });
    const companions = eventInserts(queries).filter((q) => q.params[1] === "big_beautiful_bill_act");
    assert.equal(companions.length, 1);
    assert.equal(companions[0].params[10], first.comments);
  }
});

test("a non-vote kind still keeps the first folded event on the companion row", async () => {
  const { client, queries } = recordingClient();
  await syncPersonEvents(client, {
    id: "firing-member",
    name: "Firing Member",
    category: "firings",
    event_date: "2024-01-01",
    events: [
      { kind: "firings", event_date: "2024-01-01", comments: "first firing", sources: [] },
      { kind: "firings", event_date: "2024-06-15", comments: "later firing", sources: [] },
    ],
  });
  const inserts = eventInserts(queries).filter((q) => q.params[1] === "firings");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params[3], "2024-01-01");
  assert.equal(inserts[0].params[10], "first firing");
});

test("each roll number and tally appears in its tag lede", () => {
  for (const roll of NO_ROLLS) {
    const tag = VOTE_NO_TAGS.find((item) => item.id === roll.tag);
    assert.ok(tag, roll.id);
    const noun = roll.chamber === "Senate" ? "vote" : "roll";
    assert.match(tag.lede, new RegExp(`\\b${noun} ${roll.number}\\b`), roll.id);
    const ledeTokens = new Set(tag.lede.toLowerCase().match(/[a-z0-9]+/g) || []);
    for (const token of String(roll.tally).toLowerCase().match(/[a-z0-9]+/g) || []) {
      assert.equal(ledeTokens.has(token), true, `${roll.id} ${token}`);
    }
  }
});

test("a same-roll page does not suppress a different clerk or senate roll", () => {
  const official = houseClerkVoteUrl("H-119-1-145", "2025-05-22");
  const xml = houseClerkXmlUrl("H-119-1-145", "2025-05-22");
  for (const url of [...pageVariants(official), ...pageVariants(xml)]) {
    const section = voteSectionFor("big_beautiful_bill_act", "H-119-1-145", "2025-05-22", url);
    assert.equal(hrefCount(section, url), 1, url);
    assert.equal(hrefCount(section, official), url === official ? 1 : 0, url);
  }

  const otherHouse = houseClerkVoteUrl("H-119-1-190", "2025-07-03");
  const houseSection = voteSectionFor(
    "big_beautiful_bill_act",
    "H-119-1-145",
    "2025-05-22",
    otherHouse,
  );
  assert.equal(hrefCount(houseSection, otherHouse), 1);
  assert.equal(hrefCount(houseSection, official), 1);

  const otherSenate = senateRollCallUrl("S-119-1-372");
  const senateCite = voteSectionFor(
    "big_beautiful_bill_act",
    "H-119-1-145",
    "2025-05-22",
    otherSenate,
  );
  assert.equal(hrefCount(senateCite, otherSenate), 1);
  assert.equal(hrefCount(senateCite, official), 1);

  const senateOfficial = senateRollCallUrl("S-119-1-372");
  for (const url of pageVariants(senateOfficial)) {
    const section = voteSectionFor("big_beautiful_bill_act", "S-119-1-372", "2025-07-01", url);
    assert.equal(hrefCount(section, url), 1, url);
    assert.equal(hrefCount(section, senateOfficial), url === senateOfficial ? 1 : 0, url);
  }
  const differentSenate = senateRollCallUrl("S-119-2-231");
  const senateSection = voteSectionFor(
    "big_beautiful_bill_act",
    "S-119-1-372",
    "2025-07-01",
    differentSenate,
  );
  assert.equal(hrefCount(senateSection, differentSenate), 1);
  assert.equal(hrefCount(senateSection, senateOfficial), 1);
});

test("catalog roll years match congress and session", () => {
  for (const roll of Object.values(VOTE_ROLLS)) {
    const year = 1787 + 2 * roll.congress + (roll.session - 1);
    assert.equal(Number(roll.date.slice(0, 4)), year, roll.id);
  }
});

test("parseRollId rejects a leading zero", () => {
  assert.equal(parseRollId("H-119-1-0145"), null);
  assert.equal(parseRollId("H-019-1-145"), null);
  assert.equal(parseRollId("H-119-1-145")?.number, 145);
  assert.equal(parseRollId("H-119-1-145")?.congress, 119);
});

test("a non-vote kind does not keep a roll id from comments", () => {
  const row = projectPerson({
    id: "plain-firing",
    name: "Plain Firing",
    category: "firings",
    event_date: "2019-06-01",
    events: [
      {
        kind: "firings",
        event_date: "2019-06-01",
        comments: "H-119-1-145",
        sources: [],
      },
    ],
  });
  const ev = row.events.find((item) => item.kind === "firings");
  assert.equal(ev.roll_call, undefined);
  assert.equal(ev.comments, "H-119-1-145");
});
