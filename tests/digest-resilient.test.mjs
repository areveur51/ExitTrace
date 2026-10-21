import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import {
  DIGEST_FETCH_RETRY_DELAY_MS,
  DIGEST_NET_PROBE_FEEDS,
  DIGEST_NET_RETRY_DELAY_MS,
  OFFICIAL_RSS_FEEDS,
  digestFetchErrorCode,
  seedRssDigest,
} from "../app/lib/digest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "tests", "fixtures", "digest");

function fixtureXml(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8");
}

function netErr(code, message = "fetch failed") {
  const err = new TypeError(message);
  err.cause = { code, message: `connect ${code}` };
  return err;
}

function recordSleep() {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}

function feed(row) {
  return { slice: "current", gov: false, ...row };
}

function currentFeeds() {
  return [
    feed({
      handle: "washingtonpost",
      name: "Washington Post",
      url: "https://feeds.washingtonpost.com/rss/national",
    }),
    feed({
      handle: "apnews",
      name: "AP News",
      url: "https://rss.apnews.com/test-current",
    }),
  ];
}

function manyFeeds(n) {
  const current = OFFICIAL_RSS_FEEDS.filter((f) => f.slice === "current");
  assert.ok(current.length >= n, `need ${n} current official feeds`);
  return current.slice(0, n).map((f) => ({ ...f }));
}

function fetchByUrl(map) {
  const seen = {};
  const fetchImpl = async (url) => {
    seen[url] = (seen[url] || 0) + 1;
    const steps = map[url];
    if (!steps) throw new Error(`unexpected fetch ${url}`);
    const step = steps[Math.min(seen[url] - 1, steps.length - 1)];
    if (typeof step === "function") return step(url, seen[url]);
    if (step instanceof Error) throw step;
    if (typeof step === "number") return { ok: false, status: step, text: async () => "" };
    return { ok: true, status: 200, text: async () => step };
  };
  return { seen, fetchImpl };
}

test("digest: a feed 502 among others still processes other feeds", async () => {
  const feeds = currentFeeds();
  const apXml = fixtureXml("ap-current.xml");
  const { fetchImpl } = fetchByUrl({
    [feeds[0].url]: [502, 502],
    [feeds[1].url]: [apXml],
  });
  const { waits, sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
    netRetries: 2,
    netRetryDelayMs: DIGEST_NET_RETRY_DELAY_MS,
  });
  const byName = Object.fromEntries(out.fetched.map((f) => [f.name, f]));
  assert.equal(byName["Washington Post"].ok, false);
  assert.equal(byName["Washington Post"].error, "502");
  assert.equal(byName["AP News"].ok, true);
  assert.ok(out.leads.some((l) => l.lead_name === "Casey Vale"));
  assert.ok(out.skipped.some((s) => s.skip === "fetch" && s.error === "502"));
  assert.equal(out.net_retries_used, 0);
  assert.ok(!waits.includes(DIGEST_NET_RETRY_DELAY_MS));
});

test("digest: a thrown fetch for one feed does not crash the pass", async () => {
  const feeds = currentFeeds();
  const apXml = fixtureXml("ap-current.xml");
  const boom = netErr("ETIMEDOUT");
  const { fetchImpl } = fetchByUrl({
    [feeds[0].url]: [boom, boom],
    [feeds[1].url]: [apXml],
  });
  const { waits, sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
  });
  const byName = Object.fromEntries(out.fetched.map((f) => [f.name, f]));
  assert.equal(byName["Washington Post"].ok, false);
  assert.equal(byName["Washington Post"].error, "ETIMEDOUT");
  assert.equal(byName["AP News"].ok, true);
  assert.ok(out.leads.some((l) => l.lead_name === "Casey Vale"));
  assert.equal(out.net_retries_used, 0);
  assert.ok(!waits.includes(DIGEST_NET_RETRY_DELAY_MS));
  assert.equal(digestFetchErrorCode(boom), "ETIMEDOUT");
});

test("digest: all feeds network-down then up retries after netRetryDelayMs", async () => {
  const feeds = currentFeeds();
  const apXml = fixtureXml("ap-current.xml");
  const { seen, fetchImpl } = fetchByUrl({
    [feeds[0].url]: [
      netErr("ENETUNREACH"),
      netErr("ENETUNREACH"),
      apXml,
    ],
    [feeds[1].url]: [
      netErr("ENETUNREACH"),
      netErr("ENETUNREACH"),
      apXml,
    ],
  });
  const { waits, sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
    netRetries: 2,
    netRetryDelayMs: DIGEST_NET_RETRY_DELAY_MS,
  });
  assert.equal(out.net_retries_used, 1);
  assert.ok(waits.includes(DIGEST_NET_RETRY_DELAY_MS));
  assert.equal(out.fetched.every((f) => f.ok), true);
  assert.ok(out.leads.some((l) => l.lead_name === "Casey Vale"));
  assert.equal(seen[feeds[0].url], 3);
  assert.equal(seen[feeds[1].url], 3);
  assert.deepEqual(
    waits.filter((ms) => ms === DIGEST_NET_RETRY_DELAY_MS),
    [DIGEST_NET_RETRY_DELAY_MS],
  );
});

test("digest: network down on all passes gives up after netRetries", async () => {
  const feeds = currentFeeds();
  const { fetchImpl } = fetchByUrl({
    [feeds[0].url]: [netErr("ETIMEDOUT")],
    [feeds[1].url]: [netErr("ETIMEDOUT")],
  });
  const { waits, sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
    netRetries: 2,
    netRetryDelayMs: DIGEST_NET_RETRY_DELAY_MS,
  });
  assert.equal(out.net_retries_used, 2);
  assert.equal(out.fetched.length, 2);
  assert.ok(out.fetched.every((f) => !f.ok && f.error === "ETIMEDOUT"));
  assert.equal(out.leads.length, 0);
  assert.deepEqual(
    waits.filter((ms) => ms === DIGEST_NET_RETRY_DELAY_MS),
    [DIGEST_NET_RETRY_DELAY_MS, DIGEST_NET_RETRY_DELAY_MS],
  );
  assert.ok(waits.includes(DIGEST_FETCH_RETRY_DELAY_MS));
});

test("digest: a pure-HTTP all-fail does not trigger the long net wait", async () => {
  const feeds = currentFeeds();
  const { fetchImpl } = fetchByUrl({
    [feeds[0].url]: [502, 502],
    [feeds[1].url]: [502, 502],
  });
  const { waits, sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
    netRetries: 2,
    netRetryDelayMs: DIGEST_NET_RETRY_DELAY_MS,
  });
  assert.equal(out.net_retries_used, 0);
  assert.ok(out.fetched.every((f) => !f.ok && f.error === "502"));
  assert.equal(out.leads.length, 0);
  assert.ok(!waits.includes(DIGEST_NET_RETRY_DELAY_MS));
  assert.deepEqual(waits, [DIGEST_FETCH_RETRY_DELAY_MS, DIGEST_FETCH_RETRY_DELAY_MS]);
});

test("digest: Washington Post stays on the official RSS list", () => {
  const wapo = OFFICIAL_RSS_FEEDS.find((f) => f.handle === "washingtonpost");
  assert.ok(wapo);
  assert.equal(wapo.name, "Washington Post");
  assert.equal(wapo.url, "https://feeds.washingtonpost.com/rss/national");
});

test("digest: net down short-circuits the pass after netProbeFeeds network failures", async () => {
  const feeds = manyFeeds(6);
  const map = Object.fromEntries(feeds.map((f) => [f.url, [netErr("ETIMEDOUT")]]));
  const { seen, fetchImpl } = fetchByUrl(map);
  const { sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
    netRetries: 0,
    netProbeFeeds: DIGEST_NET_PROBE_FEEDS,
  });
  assert.equal(DIGEST_NET_PROBE_FEEDS, 3);
  assert.equal(out.fetched.length, 6);
  assert.ok(out.fetched.every((f) => !f.ok));
  for (let i = 0; i < 3; i++) {
    assert.equal(seen[feeds[i].url], 2);
    assert.equal(out.fetched[i].error, "ETIMEDOUT");
    assert.equal(out.fetched[i].attempts, 2);
  }
  for (let i = 3; i < 6; i++) {
    assert.equal(seen[feeds[i].url], undefined);
    assert.equal(out.fetched[i].error, "net_down");
    assert.equal(out.fetched[i].attempts, 0);
    assert.equal(out.fetched[i].ok, false);
  }
  assert.equal(Object.values(seen).reduce((a, b) => a + b, 0), 6);
});

test("digest: an HTTP 502 among the first feeds does not short-circuit", async () => {
  const feeds = manyFeeds(6);
  const map = Object.fromEntries(
    feeds.map((f, i) => [f.url, i === 0 ? [502, 502] : [netErr("ETIMEDOUT")]]),
  );
  const { seen, fetchImpl } = fetchByUrl(map);
  const { sleep } = recordSleep();
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
    netRetries: 0,
    netProbeFeeds: DIGEST_NET_PROBE_FEEDS,
  });
  for (const f of feeds) {
    assert.equal(seen[f.url], 2, `attempted ${f.name}`);
  }
  assert.equal(out.fetched.length, 6);
  assert.equal(out.fetched[0].error, "502");
  assert.ok(out.fetched.slice(1).every((f) => f.error === "ETIMEDOUT"));
  assert.ok(!out.fetched.some((f) => f.error === "net_down"));
});

test("digest: net-down-then-up with the probe retries and fetches every feed", async () => {
  const feeds = manyFeeds(6);
  const apXml = fixtureXml("ap-current.xml");
  let pass = 1;
  const seen = {};
  const fetchImpl = async (url) => {
    seen[url] = (seen[url] || 0) + 1;
    if (pass === 1) throw netErr("ENETUNREACH");
    return { ok: true, status: 200, text: async () => apXml };
  };
  const { waits, sleep: recSleep } = recordSleep();
  const sleep = async (ms) => {
    await recSleep(ms);
    if (ms === DIGEST_NET_RETRY_DELAY_MS) pass = 2;
  };
  const out = await seedRssDigest({
    people: [],
    feeds,
    fetchImpl,
    sleep,
    importPosts: false,
    queueLeads: false,
    netRetries: 2,
    netProbeFeeds: DIGEST_NET_PROBE_FEEDS,
    netRetryDelayMs: DIGEST_NET_RETRY_DELAY_MS,
  });
  assert.equal(out.net_retries_used, 1);
  assert.ok(waits.includes(DIGEST_NET_RETRY_DELAY_MS));
  assert.equal(out.fetched.length, 6);
  assert.ok(out.fetched.every((f) => f.ok));
  assert.equal(Object.keys(seen).length, 6);
  for (const f of feeds) {
    assert.ok(seen[f.url] >= 1, `second pass fetched ${f.name}`);
  }
  assert.equal(seen[feeds[0].url], 3);
  assert.equal(seen[feeds[1].url], 3);
  assert.equal(seen[feeds[2].url], 3);
  assert.equal(seen[feeds[3].url], 1);
  assert.equal(seen[feeds[4].url], 1);
  assert.equal(seen[feeds[5].url], 1);
});
