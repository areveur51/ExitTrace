import assert from "node:assert/strict";
import { test } from "node:test";
import { peopleList, personDetail, personHeader } from "../app/lib/html.mjs";
import {
  mergeNicknames,
  nicknameCatalogDate,
  nicknameJson,
  normalizeNicknames,
  trumpNicknameReportDate,
} from "../app/lib/nicknames.mjs";
import { applyIdentifiedPerson, ensurePersonNicknames, getPerson, setMemory } from "../app/lib/store.mjs";
import { LOCK_MEDIA_DIR, LOCK_PORTRAIT, NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const CITES = [
  {
    url: "https://www.reuters.com/world/us/sleepy-joe",
    publisher: "Reuters",
    date: "2019-06-11",
    snippet: "Sleepy Joe",
  },
  {
    url: "https://www.nytimes.com/2019/06/11/us/politics/sleepy-joe.html",
    publisher: "The New York Times",
    date: "2019-06-11",
    snippet: "Same thing is happening with Sleepy Joe.",
  },
];

const NICK = [{ name: "Sleepy Joe", by: "Donald Trump", sources: CITES }];

test("a nickname-only card dates from the earliest Trump-nickname cite", () => {
  assert.equal(trumpNicknameReportDate(NICK), "2019-06-11");
  assert.equal(
    trumpNicknameReportDate([
      {
        name: "Newscum",
        by: "Donald Trump",
        sources: [
          { url: "https://www.reuters.com/world/us/newscum", date: "2026-03-16" },
          { url: "https://apnews.com/article/newscum", date: "2025-06-09" },
        ],
      },
    ]),
    "2025-06-09",
  );
  assert.equal(trumpNicknameReportDate([{ name: "Sleepy Joe", by: "Someone Else", sources: CITES }]), null);
});

test("a nickname without two official cites is dropped", () => {
  assert.deepEqual(normalizeNicknames(undefined), []);
  assert.deepEqual(
    normalizeNicknames([
      { name: "Newscum", by: "Donald Trump", sources: [{ url: "https://www.reuters.com/a" }] },
    ]),
    [],
  );
  assert.deepEqual(
    normalizeNicknames([
      {
        name: "Newscum",
        by: "Donald Trump",
        sources: [
          { url: "https://en.wikipedia.org/wiki/Gavin_Newsom" },
          { url: "https://www.reuters.com/world/us/newscum" },
        ],
      },
    ]),
    [],
  );
  assert.equal(normalizeNicknames([{ name: "Newscum", sources: CITES }]).length, 0);
});

const LIST_URL = "https://en.wikipedia.org/wiki/List_of_nicknames_used_by_Donald_Trump";

test("a Wikipedia list exception is kept without two news cites", () => {
  const kept = normalizeNicknames([
    {
      name: "Slow Joe",
      by: "Donald Trump",
      list_exception: true,
      sources: [{ url: LIST_URL, publisher: "Wikipedia", title: "List of nicknames used by Donald Trump" }],
    },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, "Slow Joe");
  assert.equal(kept[0].list_exception, true);
  assert.equal(kept[0].sources.length, 1);
  assert.equal(kept[0].sources[0].url, LIST_URL);
  assert.equal(kept[0].sources[0].publisher, "Wikipedia");
  assert.equal(kept[0].sources[0].snippet, undefined);

  const noQuote = normalizeNicknames([
    {
      name: "Slow Joe",
      by: "Donald Trump",
      list_exception: true,
      sources: [{ url: "https://example.com/not-a-cite", publisher: "Example" }],
    },
  ]);
  assert.equal(noQuote.length, 1);
  assert.equal(noQuote[0].list_exception, true);
  assert.deepEqual(noQuote[0].sources, []);

  assert.deepEqual(
    normalizeNicknames([
      {
        name: "Slow Joe",
        by: "Donald Trump",
        list_exception: "true",
        sources: [{ url: LIST_URL, publisher: "Wikipedia" }],
      },
    ]),
    [],
  );
});

test("a list exception does not downgrade a nickname that already has two official cites", () => {
  const merged = normalizeNicknames([
    { name: "Sleepy Joe", by: "Donald Trump", sources: CITES },
    {
      name: "Sleepy Joe",
      by: "Donald Trump",
      list_exception: true,
      sources: [{ url: LIST_URL, publisher: "Wikipedia", title: "List of nicknames used by Donald Trump" }],
    },
    {
      name: "Slow Joe",
      by: "Donald Trump",
      list_exception: true,
      sources: [{ url: LIST_URL, publisher: "Wikipedia" }],
    },
  ]);
  const sleepy = merged.find((row) => row.name === "Sleepy Joe");
  const slow = merged.find((row) => row.name === "Slow Joe");
  assert.equal(sleepy.list_exception, undefined);
  assert.equal(sleepy.sources.length, 2);
  assert.ok(sleepy.sources.every((source) => !source.url.includes("wikipedia")));
  assert.equal(slow.list_exception, true);
  assert.equal(slow.sources[0].url, LIST_URL);
});

test("detail page shows a cited Trump nickname and hides the line when empty", async () => {
  setMemory({ people: [], operations: [], source_posts: [] });
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: [
      "https://www.example.com/news/casey-vale-held",
      "https://www.example.net/world/casey-vale-arrest",
    ],
    role: "Anchor",
    nicknames: NICK,
  });
  const person = await getPerson("casey-vale");
  assert.equal(person.nicknames[0].name, "Sleepy Joe");
  assert.equal(person.nicknames[0].by, "Donald Trump");
  const header = personHeader(person);
  assert.match(header, /Trump nickname · Sleepy Joe/);
  const html = personDetail(person);
  assert.match(html, /data-kind="nickname"/);
  assert.match(html, /reuters.com\/world\/us\/sleepy-joe/);
  assert.match(html, /Same thing is happening with Sleepy Joe/);
  assert.doesNotMatch(personHeader({ name: "Casey Vale", nicknames: [] }), /Trump nickname/);

  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "resignations",
    cite_urls: [
      "https://www.example.com/news/casey-vale-quit",
      "https://www.example.net/world/casey-vale-resigned",
    ],
  });
  const again = await getPerson("casey-vale");
  assert.equal(again.nicknames[0].name, "Sleepy Joe");
});

test("nickname update leaves the exit card alone and creates a card when the person is missing", async () => {
  setMemory({
    people: [
      {
        id: "joe-biden",
        category: "government_stepdowns",
        name: "Joe Biden",
        role: "President",
        event_date: "2021-01-20",
        death_date: null,
        country_of_origin: "United States",
        photo: "/media/people/joe-biden.jpg",
        events: [{ kind: "government_stepdowns", event_date: "2021-01-20", sources: [] }],
        sources: [],
        tags: ["official"],
        career: [],
        nicknames: [],
      },
    ],
    operations: [],
    source_posts: [],
  });
  const updated = await ensurePersonNicknames({ subject: "Joe Biden", nicknames: NICK });
  assert.equal(updated.action, "updated");
  assert.equal(updated.person.category, "government_stepdowns");
  assert.equal(String(updated.person.event_date).slice(0, 10), "2021-01-20");
  assert.equal(updated.person.photo, "/media/people/joe-biden.jpg");
  assert.equal(updated.person.country_of_origin, "United States");
  assert.equal(updated.person.nicknames[0].name, "Sleepy Joe");

  await assert.rejects(
    () => ensurePersonNicknames({ subject: "Gavin Newsom", nicknames: [{ name: "Newscum", by: "Donald Trump", sources: [] }] }),
    /two official/,
  );
  assert.equal(await getPerson("gavin-newsom"), null);

  const cited = {
    subject: "Gavin Newsom",
    role: "Governor of California",
    nicknames: [
      {
        name: "Newscum",
        by: "Donald Trump",
        sources: [
          { url: "https://www.reuters.com/world/us/newscum", publisher: "Reuters", date: "2026-03-16" },
          { url: "https://apnews.com/article/newscum", publisher: "Associated Press", date: "2025-06-09" },
        ],
      },
    ],
  };
  await assert.rejects(
    () => ensurePersonNicknames({ ...cited, mediaDir: LOCK_MEDIA_DIR }),
    (err) => err.code === "missing_portrait",
  );
  assert.equal(await getPerson("gavin-newsom"), null);

  const created = await ensurePersonNicknames({
    ...cited,
    photo: LOCK_PORTRAIT,
    photo_credit: "Test portrait",
    mediaDir: LOCK_MEDIA_DIR,
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.id, "gavin-newsom");
  assert.equal(created.person.category, "nickname");
  assert.equal(created.person.country_of_origin, "");
  assert.equal(created.person.event_date, null);
  assert.equal(nicknameCatalogDate(created.person), "2025-06-09");
  assert.equal(created.person.photo, "/media/people/gavin-newsom.jpg");
  assert.deepEqual(created.person.events, []);
  const list = peopleList([created.person]);
  assert.match(list, /datetime="2025-06-09"/);
  assert.match(list, />2025</);
  assert.doesNotMatch(list, /Undated/);
  const kept = peopleList([
    { ...updated.person, name: "Joe Biden" },
    created.person,
  ]);
  assert.match(kept, /datetime="2021-01-20"/);
  assert.doesNotMatch(kept, /datetime="2019-06-11"/);
  assert.match(personDetail(created.person), /Trump nickname · Newscum/);
  assert.match(personDetail(created.person), /data-kind="nickname"/);
});

test("an existing card keeps its cites when a list-exception nickname is added", async () => {
  setMemory({
    people: [
      {
        id: "joe-biden",
        category: "government_stepdowns",
        name: "Joe Biden",
        role: "President",
        event_date: "2021-01-20",
        death_date: null,
        country_of_origin: "United States",
        photo: "/media/people/joe-biden.jpg",
        events: [{ kind: "government_stepdowns", event_date: "2021-01-20", sources: [] }],
        sources: [],
        tags: ["official"],
        career: [],
        nicknames: NICK,
      },
    ],
    operations: [],
    source_posts: [],
  });
  const updated = await ensurePersonNicknames({
    subject: "Joe Biden",
    nicknames: [
      {
        name: "Slow Joe",
        by: "Donald Trump",
        list_exception: true,
        sources: [{ url: LIST_URL, publisher: "Wikipedia", title: "List of nicknames used by Donald Trump" }],
      },
    ],
  });
  assert.equal(updated.action, "updated");
  assert.equal(updated.person.category, "government_stepdowns");
  assert.equal(updated.person.photo, "/media/people/joe-biden.jpg");
  const sleepy = updated.person.nicknames.find((row) => row.name === "Sleepy Joe");
  const slow = updated.person.nicknames.find((row) => row.name === "Slow Joe");
  assert.equal(sleepy.sources.length, 2);
  assert.equal(sleepy.list_exception, undefined);
  assert.equal(slow.list_exception, true);
  const html = personDetail(updated.person);
  assert.match(html, /Trump nicknames · Sleepy Joe, Slow Joe/);
  const rows = html.match(/<article class="[^"]*\bevent-tag-row\b[^"]*"[\s\S]*?<\/article>/g) || [];
  const slowRow = rows.find((row) => row.includes("Slow Joe"));
  assert.ok(slowRow);
  assert.match(slowRow, /Trump nickname/);
  assert.match(slowRow, /class="event-date">—</);
  assert.doesNotMatch(slowRow, /event-snippet/);
  assert.match(html, /wikipedia.org\/wiki\/List_of_nicknames_used_by_Donald_Trump/);
});

const TRUMP_X = "https://x.com/realDonaldTrump/status/2111516431141540160";
const FOX_LIVE = "https://www.foxnews.com/live-news/sleepy-joe";

test("a kept nickname stores the namer's post and an accepted news cite after the official sources", () => {
  const kept = normalizeNicknames([
    {
      name: "Sleepy Joe",
      by: "Donald Trump",
      sources: [
        {
          url: CITES[0].url,
          publisher: "Reuters",
          date: "2019-06-11",
          title: "Sleepy Joe Biden",
          snippet: "Sleepy Joe",
        },
        {
          url: TRUMP_X,
          publisher: "Donald Trump",
          title: "Post",
          snippet: "Sleepy Joe Biden",
          date: "2018-01-02",
        },
        {
          url: CITES[1].url,
          publisher: "The New York Times",
          date: "2019-06-11",
          snippet: "Same thing is happening with Sleepy Joe.",
        },
        {
          url: FOX_LIVE,
          publisher: "Fox News",
          title: "Live blog",
          snippet: "Live coverage",
          date: "2020-03-04",
        },
      ],
    },
  ]);
  assert.equal(kept.length, 1);
  assert.deepEqual(
    kept[0].sources.map((source) => source.url),
    [CITES[0].url, CITES[1].url, TRUMP_X, FOX_LIVE],
  );
  assert.equal(kept[0].sources[0].supporting, undefined);
  assert.equal(kept[0].sources[1].supporting, undefined);
  assert.equal(kept[0].sources[2].supporting, true);
  assert.equal(kept[0].sources[3].supporting, true);
  assert.equal(kept[0].sources[2].publisher, "Donald Trump");
  assert.equal(kept[0].sources[2].title, "Post");
  assert.equal(kept[0].sources[2].snippet, "Sleepy Joe Biden");
  assert.equal(kept[0].sources[2].date, "2018-01-02");
  assert.equal(kept[0].sources[3].publisher, "Fox News");
  assert.equal(kept[0].sources[3].snippet, "Live coverage");
  assert.equal(kept[0].list_exception, undefined);
});

test("one official cite plus the namer's post and a news cite is still dropped", () => {
  assert.deepEqual(
    normalizeNicknames([
      {
        name: "Sleepy Joe",
        by: "Donald Trump",
        sources: [CITES[0], { url: TRUMP_X, date: "2018-01-02" }, { url: FOX_LIVE, date: "2020-03-04" }],
      },
    ]),
    [],
  );
});

test("another account's X status is not a supporting nickname cite", () => {
  const kept = normalizeNicknames([
    {
      name: "Sleepy Joe",
      by: "Donald Trump",
      sources: [...CITES, { url: "https://x.com/someoneElse/status/1", publisher: "Someone Else" }],
    },
  ]);
  assert.equal(kept.length, 1);
  assert.deepEqual(
    kept[0].sources.map((source) => source.url),
    CITES.map((source) => source.url),
  );
  assert.ok(kept[0].sources.every((source) => source.supporting !== true));
});

test("a list exception row does not gain supporting sources", () => {
  assert.deepEqual(
    normalizeNicknames([
      {
        name: "Slow Joe",
        by: "Donald Trump",
        list_exception: true,
        sources: [
          { url: LIST_URL, publisher: "Wikipedia", title: "List of nicknames used by Donald Trump" },
          { url: TRUMP_X, publisher: "Donald Trump", snippet: "post", date: "2024-01-01" },
          { url: FOX_LIVE, publisher: "Fox News", snippet: "live", date: "2024-02-02" },
        ],
      },
    ]),
    [
      {
        name: "Slow Joe",
        by: "Donald Trump",
        list_exception: true,
        sources: [{ url: LIST_URL, publisher: "Wikipedia", title: "List of nicknames used by Donald Trump" }],
      },
    ],
  );
});

test("merge keeps supporting cites from both sides", () => {
  const prior = [
    {
      name: "Sleepy Joe",
      by: "Donald Trump",
      sources: [
        ...CITES,
        { url: TRUMP_X, publisher: "Donald Trump", snippet: "From the prior post", date: "2018-01-02" },
      ],
    },
  ];
  const incoming = [
    {
      name: "Sleepy Joe",
      by: "Donald Trump",
      sources: [
        ...CITES,
        { url: TRUMP_X, publisher: "Duplicate" },
        { url: FOX_LIVE, publisher: "Fox News", date: "2020-03-04", snippet: "Live blog" },
      ],
    },
  ];
  const merged = mergeNicknames(incoming, prior);
  assert.equal(merged.length, 1);
  assert.deepEqual(
    merged[0].sources.map((source) => source.url),
    [CITES[0].url, CITES[1].url, TRUMP_X, FOX_LIVE],
  );
  assert.equal(merged[0].sources[2].supporting, true);
  assert.equal(merged[0].sources[2].snippet, "From the prior post");
  assert.equal(merged[0].sources[2].publisher, "Donald Trump");
  assert.equal(merged[0].sources[3].supporting, true);
  assert.equal(merged[0].sources[3].publisher, "Fox News");
  assert.equal(merged[0].sources[0].supporting, undefined);
  assert.equal(merged[0].list_exception, undefined);
});

test("nicknameJson keeps supporting through a round trip", () => {
  const input = [
    {
      name: "Sleepy Joe",
      by: "Donald Trump",
      sources: [
        ...CITES,
        { url: TRUMP_X, title: "Post", publisher: "Donald Trump", snippet: "Sleepy Joe", date: "2018-01-02" },
        { url: FOX_LIVE, publisher: "Fox News", date: "2020-03-04" },
      ],
    },
  ];
  const once = nicknameJson(input);
  assert.equal(nicknameJson(JSON.parse(once)), once);
  const row = JSON.parse(once)[0];
  assert.equal(row.sources[2].supporting, true);
  assert.equal(row.sources[2].url, TRUMP_X);
  assert.equal(row.sources[3].supporting, true);
  assert.equal(row.sources[3].url, FOX_LIVE);
  assert.equal(Object.hasOwn(row.sources[0], "supporting"), false);
  assert.equal(Object.hasOwn(row.sources[1], "supporting"), false);
});

test("trumpNicknameReportDate ignores supporting sources", () => {
  assert.equal(
    trumpNicknameReportDate([
      {
        name: "Sleepy Joe",
        by: "Donald Trump",
        sources: [
          { url: CITES[0].url, date: "2019-06-11" },
          { url: CITES[1].url, date: "2019-06-12" },
          { url: TRUMP_X, date: "2010-01-01" },
          { url: FOX_LIVE, date: "2024-08-08" },
        ],
      },
    ]),
    "2019-06-11",
  );
  assert.equal(
    trumpNicknameReportDate([
      {
        name: "Sleepy Joe",
        by: "Donald Trump",
        sources: [{ url: CITES[0].url }, { url: CITES[1].url }, { url: FOX_LIVE, date: "2011-02-02" }],
      },
    ]),
    null,
  );
});

test("a kept nickname stores at most three supporting cites", () => {
  const third = "https://www.thedailybeast.com/sleepy-joe";
  const fourth = "https://www.newsweek.com/sleepy-joe";
  const kept = normalizeNicknames([
    {
      name: "Sleepy Joe",
      by: "Donald Trump",
      sources: [
        ...CITES,
        { url: TRUMP_X },
        { url: FOX_LIVE },
        { url: third },
        { url: fourth },
      ],
    },
  ]);
  assert.deepEqual(
    kept[0].sources.map((source) => source.url),
    [CITES[0].url, CITES[1].url, TRUMP_X, FOX_LIVE, third],
  );
  assert.equal(kept[0].sources.filter((source) => source.supporting === true).length, 3);
});

test("the namer status allowlist is https status paths for that account", () => {
  const base = [{ url: "https://www.reuters.com/world/us/a" }, { url: "https://www.nytimes.com/a" }];
  const kept = (url) =>
    normalizeNicknames([{ name: "Sleepy Joe", by: "Donald Trump", sources: [...base, { url }] }]);
  for (const url of [
    "https://twitter.com/RealDonaldTrump/status/99",
    "https://www.x.com/realdonaldtrump/status/100",
    "https://truthsocial.com/@realDonaldTrump/555",
    "https://www.truthsocial.com/@REALDONALDTRUMP/556/",
  ]) {
    const row = kept(url);
    assert.equal(row[0].sources[2].url, url);
    assert.equal(row[0].sources[2].supporting, true);
  }
  for (const url of [
    "http://x.com/realDonaldTrump/status/1",
    "https://x.com/realDonaldTrump",
    "https://x.com/realDonaldTrump/status/1/photo/2",
    "https://mobile.twitter.com/realDonaldTrump/status/1",
    "https://truthsocial.com/@realDonaldTrump",
    "https://truthsocial.com/realDonaldTrump/1",
  ]) {
    assert.equal(kept(url)[0].sources.length, 2, url);
  }
});
