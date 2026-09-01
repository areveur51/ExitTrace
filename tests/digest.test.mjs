import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { queueAddRequest } from "../app/lib/add-request.mjs";
import { IMPORT_CATEGORY_IDS, mapImportCategory } from "../app/lib/categories.mjs";
import {
  OFFICIAL_RSS_FEEDS,
  asAddNameLead,
  assertOfficialFeedList,
  classifyDigestText,
  digestItemCiteUrls,
  digestItemsToLeads,
  extractLeadName,
  formatJsonlRows,
  isDigestItemCite,
  leadsToImportRows,
  livePersonHit,
  parseRssItems,
  postedAtFromRss,
  seedRssDigest,
  selectDigestFeeds,
  hostedDigestVendorRefsIn,
} from "../app/lib/digest.mjs";
import { importSourcePostsText } from "../app/lib/import-posts.mjs";
import {
  isOfficialCiteUrl,
  isOfficialNewsHandle,
  isQDropUrl,
  isWikipediaUrl,
} from "../app/lib/official.mjs";
import { CITE_FLOOR, PromoteError, validatePromoteInput } from "../app/lib/promote.mjs";
import {
  countPeople,
  getMemory,
  listAddRequests,
  listSourcePosts,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "tests", "fixtures", "digest");

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function fixtureXml(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8");
}

function testFeeds() {
  return [
    {
      handle: "apnews",
      name: "AP News",
      url: "https://rss.apnews.com/test-current",
      slice: "current",
      gov: false,
    },
    {
      handle: "reuters",
      name: "Reuters",
      url: "https://www.reuters.com/rss/test-current",
      slice: "current",
      gov: false,
    },
    {
      handle: "bbcnews",
      name: "BBC News",
      url: "https://feeds.bbci.co.uk/news/test-historical.xml",
      slice: "historical",
      gov: false,
    },
  ];
}

function xmlByUrl() {
  return {
    "https://rss.apnews.com/test-current": fixtureXml("ap-current.xml"),
    "https://www.reuters.com/rss/test-current": fixtureXml("reuters-current.xml"),
    "https://feeds.bbci.co.uk/news/test-historical.xml": fixtureXml("bbc-historical.xml"),
  };
}

test("official feed list is ours and stays on the cite allowlist", () => {
  assert.equal(assertOfficialFeedList(OFFICIAL_RSS_FEEDS), true);
  assert.ok(selectDigestFeeds("current").length >= 4);
  assert.equal(selectDigestFeeds("historical").length, 3);
  assert.ok(
    selectDigestFeeds("historical").every((f) =>
      decodeURIComponent(f.url).includes("after:2017-01-01"),
    ),
  );
  const sources = fs.readFileSync(path.join(ROOT, "app", "lib", "digest.mjs"), "utf8");
  assert.equal(hostedDigestVendorRefsIn("https://example.com/rss"), false);
  assert.doesNotMatch(sources, /worldmonitor/i);
  assert.doesNotMatch(sources, /WORLD_MONITOR/);
  assert.doesNotMatch(sources, /5434/);
  const ctl = fs.readFileSync(path.join(ROOT, "exittracectl.sh"), "utf8");
  assert.match(ctl, /digest/);
  assert.doesNotMatch(ctl, /5434/);
  for (const feed of OFFICIAL_RSS_FEEDS) {
    assert.ok(!hostedDigestVendorRefsIn(feed.url));
    if (!feed.gov) {
      assert.equal(isOfficialNewsHandle(feed.handle), true);
    }
  }
  assert.throws(
    () =>
      assertOfficialFeedList([
        {
          handle: "blog",
          name: "Random Blog",
          url: "https://random-blog.example/rss",
          slice: "current",
          gov: false,
        },
      ]),
    /allowlist|official/,
  );
});

test("digest item is never a cite; Wikipedia and Q drops are not cites", () => {
  const item = {
    source_url: "https://apnews.com/article/casey-vale-arrested-2024",
    lead_name: "Casey Vale",
    title: "Casey Vale arrested after public-role inquiry",
  };
  assert.deepEqual(digestItemCiteUrls(item), []);
  assert.equal(isDigestItemCite(item), false);
  const lead = asAddNameLead(item);
  assert.deepEqual(lead.cite_urls, []);
  assert.equal(lead.subject, "Casey Vale");
  assert.equal(isWikipediaUrl("https://en.wikipedia.org/wiki/Resignation"), true);
  assert.equal(isOfficialCiteUrl("https://en.wikipedia.org/wiki/Resignation"), false);
  assert.equal(isQDropUrl("https://qalerts.app/posts/1234"), true);
  assert.equal(isOfficialCiteUrl("https://qalerts.app/posts/1234"), false);
  assert.equal(isOfficialCiteUrl("https://8kun.top/q/res/123.html"), false);
  assert.throws(
    () =>
      validatePromoteInput({
        source_url: item.source_url,
        subject: "Casey Vale",
        event_date: "2024-06-15",
        category: "arrests",
        cite_urls: digestItemCiteUrls(item),
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
  assert.throws(
    () =>
      validatePromoteInput({
        source_url: item.source_url,
        subject: "Casey Vale",
        event_date: "2024-06-15",
        category: "arrests",
        cite_urls: [
          item.source_url,
          "https://en.wikipedia.org/wiki/Casey_Vale",
        ],
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
  assert.equal(CITE_FLOOR, 2);
});

test("closed catalog: indictment stays promote/add-process; no invented kinds", () => {
  assert.deepEqual(classifyDigestText("Jordan Hale indicted on fraud counts"), {
    import_category: null,
    indictment: true,
    keep: "promote",
  });
  assert.equal(mapImportCategory("indictment_civilian"), null);
  assert.equal(mapImportCategory("death_celebrity"), null);
  assert.equal(mapImportCategory("corona_comms"), null);
  assert.deepEqual(IMPORT_CATEGORY_IDS, [
    "firings",
    "resignations",
    "government_stepdowns",
    "arrests",
    "death_unspecified",
  ]);
  assert.equal(classifyDigestText("Riley Chen resigns as COO").import_category, "resignations");
  assert.equal(classifyDigestText("Casey Vale arrested").import_category, "arrests");
  assert.equal(classifyDigestText("Public figure dies aged 81").import_category, "death_unspecified");
  assert.equal(extractLeadName("Casey Vale arrested after public-role inquiry"), "Casey Vale");
  assert.equal(extractLeadName("Public figure dies aged 81"), "");
});

test("digest parks official leads, skips blogs/Q/wiki, and does not overwrite gold", async () => {
  const seed = goldSeed();
  setMemory(seed);
  const comey = getMemory().people.find((r) => r.id === "james-comey");
  const comeySources = JSON.stringify(comey.sources);
  const comeyDate = comey.event_date;
  const comeyPhoto = comey.photo;
  const comeyWorth = comey.net_worth_usd;

  const first = await seedRssDigest({
    people: getMemory().people,
    feeds: testFeeds(),
    xmlByUrl: xmlByUrl(),
    importPosts: true,
    queueLeads: true,
  });

  assert.equal(await countPeople(), 72);
  const after = getMemory().people.find((r) => r.id === "james-comey");
  assert.equal(after.name, "James Comey");
  assert.equal(after.event_date, comeyDate);
  assert.equal(after.category, "firings");
  assert.equal(JSON.stringify(after.sources), comeySources);
  assert.equal(after.photo, comeyPhoto);
  assert.equal(after.net_worth_usd, comeyWorth);

  const parked = await listSourcePosts({ standalone: true });
  const urls = parked.map((r) => r.canonical_url || r.source_url);
  assert.ok(urls.includes("https://apnews.com/article/casey-vale-arrested-2024"));
  assert.ok(urls.includes("https://reuters.com/world/riley-chen-resigns-2024-04-02"));
  assert.ok(urls.includes("https://bbc.com/news/world-us-canada-example-obit"));
  assert.ok(!urls.includes("https://random-blog.example/riley-chen"));
  assert.ok(!urls.includes("https://en.wikipedia.org/wiki/Resignation"));
  assert.ok(!urls.includes("https://qalerts.app/posts/1234"));
  assert.ok(!urls.some((u) => u.includes("jordan-hale-indicted")));
  assert.ok(!parked.some((r) => String(r.category).startsWith("indictment_")));
  assert.ok(!parked.some((r) => r.category === "death_celebrity"));

  const arrest = parked.find((r) => r.source_url.includes("casey-vale"));
  assert.equal(arrest.category, "arrests");
  assert.equal(arrest.posted_at, "2024-03-01");
  assert.equal(arrest.event_date, undefined);
  assert.notEqual(arrest.posted_at, "2024-06-15");

  const vale = first.leads.find((l) => l.lead_name === "Casey Vale");
  assert.equal(vale.event_date, "2024-06-15");
  assert.notEqual(vale.event_date, vale.posted_at);
  assert.deepEqual(digestItemCiteUrls(vale), []);

  const pending = await listAddRequests({ status: "pending" });
  assert.ok(pending.some((r) => r.subject === "Casey Vale" && r.cite_urls.length === 0));
  assert.ok(pending.some((r) => r.subject === "Riley Chen" && r.cite_urls.length === 0));
  assert.ok(pending.some((r) => r.subject === "Jordan Hale" && r.category === ""));
  assert.ok(!pending.some((r) => r.subject === "James Comey"));
  assert.ok(pending.every((r) => !r.cite_urls.length));

  const annotated = first.imported.annotated;
  assert.ok(annotated >= 1);

  const second = await seedRssDigest({
    people: getMemory().people,
    feeds: testFeeds(),
    xmlByUrl: xmlByUrl(),
    importPosts: true,
    queueLeads: true,
  });
  assert.equal(second.imported.inserted, 0);
  assert.ok(second.imported.updated >= 3);
  const pendingAgain = await listAddRequests({ status: "pending" });
  assert.equal(
    pendingAgain.filter((r) => r.subject === "Casey Vale").length,
    1,
  );
  assert.equal(await countPeople(), 72);
});

test("URL dedup and live identity skip (slug or normalized name)", async () => {
  const items = parseRssItems(fixtureXml("ap-current.xml"));
  const people = [
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "arrests",
      event_date: "2024-06-15",
      sources: [],
    },
  ];
  const mapped = digestItemsToLeads(items, {
    people,
    feed: { handle: "apnews", name: "AP News" },
  });
  assert.ok(mapped.skipped.some((s) => s.skip === "live_person" && s.name === "Casey Vale"));
  assert.ok(!mapped.leads.some((l) => l.lead_name === "Casey Vale"));
  assert.equal(livePersonHit(people, { name: "Casey Vale" })?.id, "casey-vale");
  assert.equal(
    livePersonHit(people, {
      name: "Casey Vale",
      event_date: "1999-01-01",
      category: "firings",
    })?.id,
    "casey-vale",
  );

  const rows = leadsToImportRows([
    {
      source_url: "https://apnews.com/article/casey-vale-arrested-2024",
      text: "Casey Vale arrested",
      poster_handle: "@apnews",
      poster_name: "AP News",
      posted_at: "2024-03-01",
      media_urls: [],
      category: "arrests",
    },
    {
      source_url: "https://apnews.com/article/jordan-hale-indicted",
      text: "Jordan Hale indicted",
      category: null,
      indictment: true,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "arrests");
  assert.doesNotMatch(formatJsonlRows(rows), /indictment/);
});

test("random blog RSS items are not parked", () => {
  const items = parseRssItems(fixtureXml("blog.xml"));
  const mapped = digestItemsToLeads(items, {
    people: [],
    feed: { handle: "blog", name: "Random Blog" },
  });
  assert.equal(mapped.leads.length, 0);
  assert.ok(mapped.skipped.some((s) => s.skip === "publisher"));
});

test("Q drops may be named leads but never import cites", async () => {
  setMemory(goldSeed());
  const qLead = asAddNameLead({
    lead_name: "Q Source",
    source_url: "https://qalerts.app/posts/1234",
    event_date: "",
  });
  assert.deepEqual(qLead.cite_urls, []);
  assert.equal(isOfficialCiteUrl(qLead.hint_url), false);
  const queued = await queueAddRequest(qLead);
  assert.equal(queued.request.cite_urls.length, 0);
  assert.equal(postedAtFromRss("Fri, 01 Mar 2024 12:00:00 GMT"), "2024-03-01");
});

test("import-posts still URL-dedups digest JSONL", async () => {
  setMemory(goldSeed());
  const { leads } = digestItemsToLeads(parseRssItems(fixtureXml("reuters-current.xml")), {
    people: getMemory().people,
    feed: { handle: "reuters", name: "Reuters" },
  });
  const text = formatJsonlRows(leadsToImportRows(leads));
  const first = await importSourcePostsText(text);
  const second = await importSourcePostsText(text);
  assert.ok(first.inserted >= 1);
  assert.equal(second.inserted, 0);
  assert.ok(second.updated >= 1);
});
