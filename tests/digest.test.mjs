import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { queueAddRequest } from "../app/lib/add-request.mjs";
import { IMPORT_CATEGORY_IDS, mapImportCategory } from "../app/lib/categories.mjs";
import {
  DIGEST_FETCH_RETRIES,
  DIGEST_FETCH_RETRY_DELAY_MS,
  OFFICIAL_RSS_FEEDS,
  RETIRED_DIGEST_FEED_URLS,
  asAddNameLead,
  assertOfficialFeedList,
  classifyDigestText,
  digestItemCiteUrls,
  digestItemsToLeads,
  extractLeadName,
  fetchFeedXml,
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

test("retired official feeds stay off the digest list", () => {
  const urls = OFFICIAL_RSS_FEEDS.map((f) => f.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(RETIRED_DIGEST_FEED_URLS.length >= 2);
  for (const dead of RETIRED_DIGEST_FEED_URLS) {
    assert.ok(!urls.includes(dead), `retired feed re-added: ${dead}`);
  }
  assert.ok(!urls.some((u) => /rssfeeds\.usatoday\.com/i.test(u)));
  assert.ok(!urls.some((u) => /^https?:\/\/(www\.)?state\.gov\//i.test(u)));
  assert.ok(!urls.some((u) => /travel\.state\.gov/i.test(u)));
  const current = selectDigestFeeds("current");
  assert.ok(!current.some((f) => f.name === "Department of State"));
  assert.ok(current.filter((f) => f.gov).length >= 3);
});

test("France 24 stays on the official English RSS", () => {
  const current = selectDigestFeeds("current");
  const rows = current.filter((f) => f.handle === "france24");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "France 24");
  assert.equal(rows[0].gov, false);
  assert.equal(rows[0].slice, "current");
  assert.equal(rows[0].url, "https://www.france24.com/en/rss");
  const u = new URL(rows[0].url);
  assert.equal(u.host, "www.france24.com");
  assert.equal(u.pathname, "/en/rss");
  assert.equal(isOfficialNewsHandle("france24"), true);
  assert.equal(assertOfficialFeedList(rows), true);
  assert.equal(
    RETIRED_DIGEST_FEED_URLS.includes("https://www.france24.com/en/rss"),
    false,
  );
});

test("USA Today comes through Google News with the AP/Reuters shape", () => {
  const current = selectDigestFeeds("current");
  const usa = current.filter((f) => f.handle === "usatoday");
  assert.equal(usa.length, 1);
  const ap = current.find((f) => f.handle === "apnews");
  assert.deepEqual(Object.keys(usa[0]).sort(), Object.keys(ap).sort());
  assert.equal(usa[0].name, "USA Today");
  assert.equal(usa[0].gov, false);
  assert.equal(usa[0].slice, "current");
  const u = new URL(usa[0].url);
  assert.equal(u.host, "news.google.com");
  assert.equal(u.pathname, "/rss/search");
  assert.equal(u.searchParams.get("q"), "site:usatoday.com when:1d");
  assert.equal(
    usa[0].url,
    ap.url.replace(encodeURIComponent("site:apnews.com"), encodeURIComponent("site:usatoday.com")),
  );
  assert.equal(isOfficialNewsHandle("usatoday"), true);
  assert.equal(assertOfficialFeedList(usa), true);
});

const RSS_OK = '<?xml version="1.0"?><rss version="2.0"><channel><item><title>A</title><link>https://apnews.com/article/a</link></item></channel></rss>';

function scriptedFetch(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    if (typeof step === "number") return { ok: false, status: step, text: async () => "" };
    return { ok: true, status: 200, text: async () => step };
  };
  return { calls, fetchImpl };
}

function recordSleep() {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}

test("feed fetch retry is exactly one, after a 2-5s backoff", () => {
  assert.equal(DIGEST_FETCH_RETRIES, 1);
  assert.ok(DIGEST_FETCH_RETRY_DELAY_MS >= 2000 && DIGEST_FETCH_RETRY_DELAY_MS <= 5000);
});

test("feed fetch: first-try success does not retry or wait", async () => {
  const { calls, fetchImpl } = scriptedFetch([RSS_OK]);
  const { waits, sleep } = recordSleep();
  const got = await fetchFeedXml("https://example.test/rss", { fetchImpl, sleep });
  assert.equal(got.ok, true);
  assert.equal(got.attempts, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test("feed fetch: succeeds on the one retry (non-OK, not_rss, or throw first)", async () => {
  for (const firstStep of [503, "<html><body>busy</body></html>", new TypeError("fetch failed")]) {
    const { calls, fetchImpl } = scriptedFetch([firstStep, RSS_OK]);
    const { waits, sleep } = recordSleep();
    const got = await fetchFeedXml("https://example.test/rss", { fetchImpl, sleep });
    assert.equal(got.ok, true);
    assert.equal(got.error, "");
    assert.equal(got.attempts, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [DIGEST_FETCH_RETRY_DELAY_MS]);
    assert.equal(parseRssItems(got.xml).length, 1);
  }
});

test("feed fetch: still failing after the one retry is a fetch failure", async () => {
  for (const [step, error] of [[403, "403"], ["<html><body>home</body></html>", "not_rss"]]) {
    const { calls, fetchImpl } = scriptedFetch([step, step, RSS_OK]);
    const { waits, sleep } = recordSleep();
    const got = await fetchFeedXml("https://example.test/rss", { fetchImpl, sleep });
    assert.equal(got.ok, false);
    assert.equal(got.error, error);
    assert.equal(got.attempts, 2);
    assert.equal(calls.length, 2, "never more than one retry");
    assert.deepEqual(waits, [DIGEST_FETCH_RETRY_DELAY_MS]);
  }
  const boom = scriptedFetch([new TypeError("fetch failed"), new TypeError("fetch failed again"), RSS_OK]);
  const { sleep } = recordSleep();
  await assert.rejects(
    fetchFeedXml("https://example.test/rss", { fetchImpl: boom.fetchImpl, sleep }),
    /fetch failed again/,
  );
  assert.equal(boom.calls.length, 2);
});

test("seedRssDigest counts a feed as failed only after the retry", async () => {
  const feeds = testFeeds().filter((f) => f.slice === "current");
  const steps = {
    [feeds[0].url]: [503, fixtureXml("ap-current.xml")],
    [feeds[1].url]: [403, 403, fixtureXml("reuters-current.xml")],
  };
  const seen = {};
  const fetchImpl = async (url) => {
    seen[url] = (seen[url] || 0) + 1;
    const step = steps[url][seen[url] - 1];
    if (typeof step === "number") return { ok: false, status: step, text: async () => "" };
    return { ok: true, status: 200, text: async () => step };
  };
  const { waits, sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
  });
  assert.deepEqual(seen, { [feeds[0].url]: 2, [feeds[1].url]: 2 });
  assert.deepEqual(waits, [DIGEST_FETCH_RETRY_DELAY_MS, DIGEST_FETCH_RETRY_DELAY_MS]);
  const byName = Object.fromEntries(out.fetched.map((f) => [f.name, f]));
  assert.equal(byName["AP News"].ok, true);
  assert.equal(byName["AP News"].attempts, 2);
  assert.equal(byName.Reuters.ok, false);
  assert.equal(byName.Reuters.error, "403");
  assert.equal(byName.Reuters.attempts, 2);
  assert.equal(out.fetched.filter((f) => !f.ok).length, 1);
  assert.ok(out.skipped.some((s) => s.skip === "fetch" && s.url === feeds[1].url && s.error === "403"));
  assert.ok(out.leads.some((l) => l.lead_name === "Casey Vale"));
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
