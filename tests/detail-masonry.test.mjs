import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asPostedAt,
  formatPosted,
  formatXDateTime,
  hasPostedTime,
  postedAtValue,
} from "../app/lib/categories.mjs";
import { getDogComm, setMemory } from "../app/lib/store.mjs";
import {
  citeBlock,
  citeFromRow,
  dogDetail,
  dogExtraStills,
  operationDetail,
  personDetail,
  sourcePostDetail,
} from "../app/lib/html.mjs";

function dog(overrides = {}) {
  return {
    id: "ezraacohen-dow-2026",
    posted_at: "2026-01-15",
    handle: "@EzraACohen",
    account_name: "Ezra Cohen",
    text: "Multi-still dog post.",
    still: "/media/dog-comms/ezraacohen-dow-2026.jpg",
    still_credit: "Stored snapshot",
    screenshot: "/media/screenshots/dog-comms/ezraacohen-dow-2026.png",
    screenshot_credit:
      "@EzraACohen · live x.com dark border-crop expand+ts · https://x.com/EzraACohen/status/2092784717917462982",
    source_url: "https://x.com/EzraACohen/status/2092784717917462982",
    snapshot: {
      stills: [
        "/media/dog-comms/ezraacohen-dow-2026.jpg",
        "/media/dog-comms/ezraacohen-dow-2026-2.jpg",
        "/media/dog-comms/ezraacohen-dow-2026-3.jpg",
        "/media/dog-comms/ezraacohen-dow-2026-4.jpg",
      ],
    },
    ...overrides,
  };
}

function masonryInner(html) {
  const start = html.indexOf('class="detail-media detail-media--masonry"');
  if (start < 0) return "";
  const open = html.indexOf(">", start);
  let depth = 1;
  let i = open + 1;
  while (i < html.length && depth > 0) {
    if (html.startsWith("<div", i)) {
      depth += 1;
      i += 4;
      continue;
    }
    if (html.startsWith("</div>", i)) {
      depth -= 1;
      if (depth === 0) return html.slice(open + 1, i);
      i += 6;
      continue;
    }
    i += 1;
  }
  return html.slice(open + 1);
}

function metaTiles(html) {
  return html.match(/<section class="detail-tile detail-tile--meta[\s\S]*?<\/section>/g) || [];
}

function tileByKind(html, kind) {
  const re = new RegExp(
    `<section class="detail-tile detail-tile--meta detail-tile--${kind}"[\\s\\S]*?</section>`,
    "g",
  );
  return html.match(re) || [];
}

test("formatPosted is X-native clock · date; date-only does not invent a time", () => {
  assert.equal(formatPosted, formatXDateTime);
  assert.equal(formatPosted("2026-08-26T18:39:00Z"), "6:39 PM · Aug 26, 2026");
  assert.equal(formatPosted("2026-08-26 18:39:00"), "6:39 PM · Aug 26, 2026");
  assert.equal(formatPosted("6:39 PM · Aug 26, 2026"), "6:39 PM · Aug 26, 2026");
  assert.equal(formatPosted("2026-01-15"), "Jan 15, 2026");
  assert.equal(formatPosted("2022-10-04"), "Oct 4, 2022");
  assert.equal(formatPosted(""), "—");
  assert.equal(hasPostedTime("2026-08-26T18:39:00Z"), true);
  assert.equal(hasPostedTime("2026-08-26T00:00:00Z"), true);
  assert.equal(hasPostedTime("2026-01-15"), false);
  assert.equal(hasPostedTime(new Date("2026-08-26T18:39:00Z")), true);
  assert.equal(hasPostedTime(new Date("2026-08-26T00:00:00.000Z")), false);
  assert.equal(formatPosted(new Date("2026-08-26T18:39:00Z")), "6:39 PM · Aug 26, 2026");
  assert.equal(formatPosted(new Date("2026-08-26T00:00:00.000Z")), "Aug 26, 2026");
  assert.equal(formatPosted("2026-08-26T00:00:00Z"), "12:00 AM · Aug 26, 2026");
  assert.equal(asPostedAt("2026-08-26T18:39:00Z"), "2026-08-26T18:39:00Z");
  assert.equal(asPostedAt("2026-01-15"), "2026-01-15");
  assert.equal(asPostedAt(new Date("2026-08-26T18:39:00Z")), "2026-08-26T18:39:00.000Z");
  assert.equal(asPostedAt(new Date("2026-10-04T00:00:00.000Z")), "2026-10-04");
  const localMidnight = new Date(2022, 9, 4, 0, 0, 0, 0);
  assert.equal(hasPostedTime(localMidnight), false);
  assert.equal(asPostedAt(localMidnight), "2022-10-04");
  assert.equal(formatPosted(localMidnight), "Oct 4, 2022");
  assert.equal(
    postedAtValue("2022-10-04", "2026-08-26T18:39:00Z"),
    "2026-08-26T18:39:00Z",
  );
  assert.equal(postedAtValue("2022-10-04", "2022-10-04"), "2022-10-04");
});

test("citeBlock is the shared CITE markup; citeFromRow maps dog and source-post fields", () => {
  const html = citeBlock({
    handle: "EzraACohen",
    accountName: "Ezra Cohen",
    postedAt: "2026-08-26T18:39:00Z",
    body: "Line one.\nLine two.",
  });
  assert.match(html, /class="cite-block"/);
  assert.match(html, /class="handle">@EzraACohen</);
  assert.match(html, /class="acct">Ezra Cohen</);
  assert.match(html, /<time datetime="2026-08-26T18:39:00Z">6:39 PM · Aug 26, 2026<\/time>/);
  assert.match(html, /class="post-text">Line one\.\nLine two\.</);
  assert.doesNotMatch(html, /Handle ·|Account ·|Posted ·|Body ·|Source ·|Citation:/);

  assert.equal(citeFromRow({ name: "James Comey", category: "firings" }), "");
  assert.equal(citeFromRow({ summary: "Federal operation." }), "");
  const fromDog = citeFromRow(dog());
  const fromPost = citeFromRow({
    poster_handle: "@EzraACohen",
    poster_name: "Ezra Cohen",
    posted_at: "2026-01-15",
    text: "Multi-still dog post.",
  });
  assert.equal(fromDog, citeBlock({
    handle: "@EzraACohen",
    accountName: "Ezra Cohen",
    postedAt: "2026-01-15",
    body: "Multi-still dog post.",
  }));
  assert.equal(fromPost, fromDog);

  const fromSnapTime = citeFromRow({
    handle: "@FLOTUS",
    account_name: "The First Lady",
    posted_at: "2022-10-04",
    text: "Champ and Major have joined us in the White House! 💕🐾",
    snapshot: { posted_at: "2022-10-04T22:41:00Z" },
  });
  assert.match(fromSnapTime, /<time datetime="2022-10-04T22:41:00Z">10:41 PM · Oct 4, 2022<\/time>/);
  const flotusDateOnly = citeFromRow({
    handle: "@FLOTUS",
    account_name: "The First Lady",
    posted_at: "2022-10-04",
    text: "Today marks 50 years.",
    snapshot: { posted_at: "2022-10-04" },
  });
  assert.match(flotusDateOnly, /<time datetime="2022-10-04">Oct 4, 2022<\/time>/);
  assert.doesNotMatch(flotusDateOnly, /AM|PM/);
});

test("dogExtraStills skips primary and keeps local dog media only", () => {
  assert.deepEqual(dogExtraStills(dog()), [
    "/media/dog-comms/ezraacohen-dow-2026-2.jpg",
    "/media/dog-comms/ezraacohen-dow-2026-3.jpg",
    "/media/dog-comms/ezraacohen-dow-2026-4.jpg",
  ]);
  assert.deepEqual(dogExtraStills(dog({ snapshot: {} })), []);
  assert.deepEqual(
    dogExtraStills(
      dog({
        snapshot: {
          stills: [
            "/media/dog-comms/ezraacohen-dow-2026.jpg",
            "https://evil.example/x.jpg",
            "/media/people/james-comey.jpg",
          ],
        },
      }),
    ),
    [],
  );
});

test("dog detail masonry: one CITE tile + Source; lightbox on media only; X URL only under Source", () => {
  const html = dogDetail(dog());
  assert.match(html, /detail-media--masonry/);
  assert.doesNotMatch(html, /detail-media--tiles-3/);
  // 5 media + ONE cite + Source
  assert.match(html, /data-tiles="7"/);
  assert.match(html, /detail-tile--portrait/);
  assert.match(html, /detail-tile--screenshot/);
  assert.match(html, /detail-tile--meta/);
  assert.equal(tileByKind(html, "cite").length, 1);
  assert.equal(tileByKind(html, "source").length, 1);
  assert.equal(tileByKind(html, "title").length, 0);
  assert.equal(tileByKind(html, "handle").length, 0);
  assert.equal(tileByKind(html, "account").length, 0);
  assert.equal(tileByKind(html, "posted").length, 0);
  assert.equal(tileByKind(html, "body").length, 0);
  assert.equal((html.match(/detail-tile--line/g) || []).length, 0);
  assert.equal((html.match(/detail-tile--still/g) || []).length, 3);
  const inner = masonryInner(html);
  assert.match(inner, /detail-tile--portrait/);
  assert.match(inner, /detail-tile--meta/);
  const citeTile = tileByKind(html, "cite")[0];
  assert.match(citeTile, /class="cite-block"/);
  assert.match(citeTile, /class="handle">@EzraACohen</);
  assert.match(citeTile, /class="acct">Ezra Cohen</);
  assert.match(citeTile, /<time datetime="2026-01-15">Jan 15, 2026<\/time>/);
  assert.match(citeTile, /class="post-text">Multi-still dog post\.</);
  assert.doesNotMatch(citeTile, /Source ·|https:\/\/x\.com/);
  assert.doesNotMatch(html, /Handle ·|Account ·|Posted ·|Body ·/);
  // Interleave: first media, then first meta, then screenshot
  assert.match(inner, /detail-tile--portrait[\s\S]*detail-tile--meta[\s\S]*detail-tile--screenshot/);
  assert.doesNotMatch(html, /detail-media--masonry[\s\S]*<\/div>\s*<div class="detail-copy"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/screenshots\/dog-comms\/ezraacohen-dow-2026\.png"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026-2\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026-4\.jpg"/);
  for (const tile of metaTiles(html)) {
    assert.doesNotMatch(tile, /lightbox-open/);
    assert.doesNotMatch(tile, /data-lightbox="/);
  }
  const sourceTile = tileByKind(html, "source")[0];
  assert.match(sourceTile, /Source · <a class="source-link" href="https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982"/);
  assert.doesNotMatch(sourceTile, /cite-block|Multi-still dog post/);
  // No X URL / capture cite clutter outside Source (screenshot credit stripped).
  const withoutSource = html.replace(
    /<p class="meta-line">Source ·[\s\S]*?<\/p>/,
    "",
  );
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982/);
  assert.doesNotMatch(html, /screenshot-credit/);
  assert.doesNotMatch(html, /Batcave/i);
  assert.doesNotMatch(html, /Sources · \d+ available/);
  assert.doesNotMatch(html, /dog-snapshot|Citation:/);

  const timed = dogDetail(
    dog({
      posted_at: "2026-08-26T18:39:00Z",
      snapshot: { posted_at: "2026-08-26T18:39:00Z" },
    }),
  );
  assert.match(tileByKind(timed, "cite")[0], /6:39 PM · Aug 26, 2026/);
  assert.match(tileByKind(timed, "cite")[0], /datetime="2026-08-26T18:39:00Z"/);
});

test("dog CITE is one glass tile even when the post has several TUI lines; Source stays separate", () => {
  const html = dogDetail(
    dog({
      text: "First TUI line of the post.\nSecond TUI line of the post.\nThird line.",
    }),
  );
  const cites = tileByKind(html, "cite");
  const sources = tileByKind(html, "source");
  assert.equal(cites.length, 1);
  assert.equal(sources.length, 1);
  assert.match(cites[0], /First TUI line of the post/);
  assert.match(cites[0], /Second TUI line of the post/);
  assert.match(cites[0], /Third line/);
  assert.doesNotMatch(cites[0], /Source ·/);
  assert.doesNotMatch(cites[0], /lightbox-open|data-lightbox="/);
  assert.match(sources[0], /Source ·/);
  assert.doesNotMatch(sources[0], /First TUI line of the post/);
  assert.doesNotMatch(sources[0], /lightbox-open|data-lightbox="/);
  assert.equal(tileByKind(html, "handle").length, 0);
  assert.equal(tileByKind(html, "account").length, 0);
  assert.equal(tileByKind(html, "posted").length, 0);
  assert.equal(tileByKind(html, "body").length, 0);
});

test("people / ops / corona reuse interleaved masonry; cite tile only when cite fields apply", () => {
  const person = personDetail({
    id: "james-comey",
    category: "firings",
    name: "James Comey",
    event_date: "2017-05-09",
    photo: "/media/people/james-comey.jpg",
    screenshot: "/media/screenshots/people/james-comey.jpg",
    sources: [
      { url: "https://www.example.com/a", title: "A" },
      { url: "https://www.example.com/b", title: "B" },
    ],
    events: [],
  });
  assert.match(person, /detail-media--masonry/);
  assert.match(person, /detail-tile--portrait/);
  assert.match(person, /detail-tile--screenshot/);
  assert.match(person, /detail-tile--meta/);
  assert.match(masonryInner(person), /detail-tile--meta[\s\S]*James Comey/);
  assert.match(person, /data-lightbox="\/media\/people\/james-comey\.jpg"/);
  assert.equal(tileByKind(person, "cite").length, 0);
  for (const tile of metaTiles(person)) {
    assert.doesNotMatch(tile, /lightbox-open/);
    assert.doesNotMatch(tile, /data-lightbox="/);
  }
  assert.doesNotMatch(person, /Batcave/i);

  const corona = personDetail({
    id: "casey-vale",
    category: "corona_comms",
    name: "Casey Vale",
    event_date: "2024-07-20",
    photo: "/media/people/james-comey.jpg",
    sources: [],
    events: [],
  });
  assert.match(corona, /detail-media--masonry/);
  assert.match(corona, /detail-tile--meta/);
  assert.equal(tileByKind(corona, "cite").length, 0);
  assert.doesNotMatch(corona, /Batcave/i);

  const coronaCite = personDetail({
    id: "casey-vale",
    category: "corona_comms",
    name: "Casey Vale",
    event_date: "2024-07-20",
    photo: "/media/people/james-comey.jpg",
    handle: "@CaseyVale",
    account_name: "Casey Vale",
    posted_at: "2024-07-20T15:04:00Z",
    text: "Official corona note.",
    sources: [],
    events: [],
  });
  assert.equal(tileByKind(coronaCite, "cite").length, 1);
  assert.match(tileByKind(coronaCite, "cite")[0], /class="cite-block"/);
  assert.match(tileByKind(coronaCite, "cite")[0], /3:04 PM · Jul 20, 2024/);
  assert.match(tileByKind(coronaCite, "cite")[0], /Official corona note/);

  const op = operationDetail({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    event_date: "2024-08-01",
    agencies: ["U.S. Department of Justice"],
    summary: "Federal operation.",
    tags: ["missing_kids"],
    sources: [{ url: "https://www.justice.gov/opa/pr/restore-justice" }],
    screenshot: "/media/screenshots/operations/restore.jpg",
  });
  assert.match(op, /detail-media--masonry/);
  assert.match(op, /detail-tile--screenshot/);
  assert.match(op, /detail-tile--meta/);
  assert.match(op, /detail-tile--body/);
  assert.match(op, /detail-tile--sources/);
  assert.equal(tileByKind(op, "cite").length, 0);
  assert.equal(tileByKind(op, "body").length, 1);
  assert.equal(tileByKind(op, "sources").length, 1);
  assert.doesNotMatch(tileByKind(op, "body")[0], /pane-h">Sources</);
  assert.doesNotMatch(tileByKind(op, "sources")[0], /Federal operation/);
  const opInner = masonryInner(op);
  assert.match(opInner, /Operation Restore Justice/);
  assert.match(opInner, /pane-h">Sources</);
  assert.match(opInner, /cite-list/);
  assert.match(op, /data-lightbox="\/media\/screenshots\/operations\/restore\.jpg"/);
  for (const tile of metaTiles(op)) {
    assert.doesNotMatch(tile, /lightbox-open/);
    assert.doesNotMatch(tile, /data-lightbox="/);
  }
  assert.doesNotMatch(op, /sources-pane/);
  assert.doesNotMatch(op, /Batcave/i);

  const post = sourcePostDetail({
    id: "sp-arrest",
    category: "arrests",
    poster_handle: "@example_desk",
    poster_name: "Example Desk",
    posted_at: "2024-03-01",
    text: "Police said a public official was arrested this morning.",
    source_url: "https://example.com/n/arrest-1",
  });
  assert.match(post, /class="cite-block"/);
  assert.match(post, /class="handle">@example_desk</);
  assert.match(post, /class="acct">Example Desk</);
  assert.match(post, /<time datetime="2024-03-01">Mar 1, 2024<\/time>/);
  assert.doesNotMatch(post, /Poster ·|Posted ·|Synopsis/);

  const timedPost = sourcePostDetail({
    id: "sp-arrest-timed",
    category: "arrests",
    poster_handle: "@example_desk",
    poster_name: "Example Desk",
    posted_at: "2024-03-01T14:05:00Z",
    text: "Police said a public official was arrested this morning.",
    source_url: "https://example.com/n/arrest-1",
  });
  assert.match(timedPost, /2:05 PM · Mar 1, 2024/);
});

test("dense masonry counts media + cite + Source; no screenshot span / tiles-3 class", () => {
  const multi = dogDetail(dog());
  assert.doesNotMatch(multi, /detail-media--tiles-3/);
  assert.match(multi, /detail-tile--screenshot/);
  assert.match(multi, /data-tiles="7"/);

  const two = dogDetail(
    dog({
      snapshot: { stills: ["/media/dog-comms/ezraacohen-dow-2026.jpg"] },
      screenshot: "/media/screenshots/dog-comms/ezraacohen-dow-2026.png",
    }),
  );
  // portrait + screenshot + cite + Source
  assert.doesNotMatch(two, /detail-media--tiles-3/);
  assert.match(two, /data-tiles="4"/);
  assert.match(two, /detail-tile--screenshot/);
  assert.match(two, /detail-tile--meta/);
  assert.equal(tileByKind(two, "cite").length, 1);
  assert.equal(tileByKind(two, "source").length, 1);
  assert.equal((two.match(/detail-tile--line/g) || []).length, 0);
});

test("store normalizeDog keeps ISO posted_at; date-only FLOTUS stays date-only", async () => {
  setMemory({
    people: [],
    dog_comms: [
      dog({
        id: "ezra-iso",
        posted_at: "2026-08-26T18:39:00Z",
        snapshot: { posted_at: "2026-08-26T18:39:00Z" },
      }),
      {
        id: "flotus-haney-commander",
        posted_at: "2022-10-04",
        handle: "@FLOTUS",
        account_name: "The First Lady",
        text: "Today marks 50 years.",
        still: "/media/dog-comms/flotus-haney-commander.jpg",
        source_url: "https://x.com/FLOTUS/status/1577448330208346113",
        snapshot: { posted_at: "2022-10-04" },
      },
    ],
  });
  const iso = await getDogComm("ezra-iso");
  assert.equal(iso.posted_at, "2026-08-26T18:39:00Z");
  assert.match(dogDetail(iso), /6:39 PM · Aug 26, 2026/);
  const flotus = await getDogComm("flotus-haney-commander");
  assert.equal(flotus.posted_at, "2022-10-04");
  const html = dogDetail(flotus);
  assert.match(html, /<time datetime="2022-10-04">Oct 4, 2022<\/time>/);
  assert.doesNotMatch(html, /AM|PM/);
});
