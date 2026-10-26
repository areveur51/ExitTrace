import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { handle } from "../app/server.mjs";
import {
  cachedCatalogRead,
  countPeople,
  listPeople,
  resetCatalogCacheForTests,
  setMemory,
  setPoolForTests,
  tagMembership,
} from "../app/lib/store.mjs";
import { MENU_ATTRIBUTE_TAGS, MENU_ATTRIBUTE_TAG_IDS, tagShortLabel } from "../app/lib/tags.mjs";
import {
  TAG_SEARCH_MAX_RAW,
  TAG_SEARCH_MAX_TAGS,
  countTagMatches,
  memberIdSet,
  membershipMasks,
  parseTagSearch,
  tagSearchHref,
} from "../app/lib/tag-search.mjs";
import { createRateLimiter, isExemptPath } from "../app/lib/rate-limit.mjs";
import { inlineJson, tagMenuItem } from "../app/lib/html.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_JS = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");

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
          body: Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || "")))).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

// Fictional people only.
const person = (id, name, tags, date) => ({ id, name, category: "notable", event_date: date, tags, events: [] });
const PEOPLE = [
  person("alma-able", "Alma Able", ["save_act", "save_america_act"], "2025-04-10"),
  person("bo-baker", "Bo Baker", ["save_act"], "2025-04-09"),
  person("cy-able", "Cy Able", ["save_america_act", "fraud"], "2025-04-08"),
  person("di-able", "Di Able", [], "2025-04-07"),
  person("ed-cole", "Ed Cole", ["official", "fraud"], "2025-04-06"),
];
const ids = (body) => [...body.matchAll(/href="\/people\/([a-z0-9-]+)"/g)].map((m) => m[1]);
const uniq = (a) => [...new Set(a)].sort();

function loadClientCore() {
  const noop = () => {};
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    documentElement: { getAttribute: () => null, toggleAttribute: noop },
  };
  const ctx = vm.createContext({ document, window: {}, URLSearchParams, console });
  vm.runInContext(`${APP_JS}\n;globalThis.__tf = ET_TAG_SEARCH;`, ctx);
  return ctx.__tf;
}

/** The tag-search block of app.js: from the ET_TAG_SEARCH helpers to its DOMContentLoaded hook. */
function tagSearchClientSource() {
  const start = APP_JS.indexOf("const ET_TAG_SEARCH");
  const end = APP_JS.indexOf('document.addEventListener("DOMContentLoaded", bindTagSearch)');
  assert.ok(start > 0 && end > start, "tag search block found in app.js");
  return APP_JS.slice(start, end);
}

test("tags param: only known MENU_ATTRIBUTE_TAGS ids, deduped, menu order, capped", () => {
  assert.equal(TAG_SEARCH_MAX_TAGS, MENU_ATTRIBUTE_TAGS.length);
  let r = parseTagSearch("tags=save_america_act,SAVE-ACT,save_act,official,civilian,nope,%3Cscript%3E,../x&match=ANY");
  assert.deepEqual(r.tags, ["save_act", "save_america_act"]);
  assert.equal(r.match, "any");
  assert.equal(r.ignored, 5, "identity tags, unknown ids and junk are dropped");
  // No-JS checkboxes repeat the param; same result as the comma list.
  assert.deepEqual(parseTagSearch("tags=save_america_act&tags=save_act").tags, ["save_act", "save_america_act"]);
  assert.equal(parseTagSearch("tags=save_act").match, "all", "All is the default");
  assert.equal(parseTagSearch("tags=save_act&match=both").match, "all");
  // Raw length cap: an oversized value is not parsed at all.
  r = parseTagSearch(`tags=${"save_act,".repeat(Math.ceil(TAG_SEARCH_MAX_RAW / 9) + 1)}`);
  assert.deepEqual(r.tags, []);
  assert.equal(r.capped, true);
  // Token cap: at most 32 tokens are read.
  r = parseTagSearch(`tags=${Array(40).fill("x").join(",")},fraud`);
  assert.deepEqual(r.tags, []);
  assert.equal(r.capped, true);
  // Every id selected once is the max.
  assert.equal(parseTagSearch(`tags=${MENU_ATTRIBUTE_TAG_IDS.join(",")}`).tags.length, MENU_ATTRIBUTE_TAGS.length);
  assert.equal(
    tagSearchHref("/search", { q: "a b", tags: ["save_act", "bogus"], match: "any" }),
    "/search?q=a+b&tags=save_act&match=any",
  );
  assert.equal(tagSearchHref("/search", { q: "a b" }), "/search?q=a+b", "no match param without tags");
});

test("tags param is escaped and never echoed raw", async () => {
  setMemory({ people: PEOPLE });
  const page = await requestPage(
    "/search?tags=save_act,%3Cscript%3Ealert(1)%3C/script%3E,%22onmouseover%3D&q=%3Cimg%20src%3Dx%3E",
  );
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /<script>alert/);
  assert.doesNotMatch(page.body, /<img src=x>/);
  assert.match(page.body, /value="&lt;img src=x&gt;"/);
  assert.match(page.body, /Ignored 2 unknown tags\./);
  // The inline payload cannot close its script element.
  const payload = page.body.match(/<script type="application\/json" data-tf-data>([\s\S]*?)<\/script>/);
  assert.ok(payload);
  assert.doesNotMatch(payload[1], /</);
});

test("hostile tag, match and q values: no reflection, escaped in HTML and inline JSON", async () => {
  setMemory({ people: PEOPLE });
  const hostileQ = `"'><script>alert('q')</script>\u2028\u2029é漢🙂\u202e&amp;`;
  const hostileTags = [`"><script>alert(1)</script>`, `save_act'onload='x`, "ſave_act", "save_act\u2028", "\u202eevil", "pwned&lt;"];
  const hostileMatch = `any"><script>alert(2)</script>`;
  const qs = new URLSearchParams();
  qs.set("q", hostileQ);
  qs.set("tags", ["fraud", ...hostileTags].join(","));
  qs.set("match", hostileMatch);
  for (const path of [`/search?${qs}`, `/?${qs}`, `/search?${new URLSearchParams({ tags: qs.get("tags"), match: hostileMatch })}`]) {
    const page = await requestPage(path);
    assert.equal(page.status, 200, path);
    const body = page.body;
    assert.doesNotMatch(body, /<script>alert/, path);
    assert.doesNotMatch(body, /alert\(1\)|alert\(2\)|onload=|pwned|evil|ſave/, `${path}: unknown tags and match are not echoed`);
    assert.doesNotMatch(body, /any&quot;|any"&gt;|any%22/, "match is normalized, never reflected");
    assert.match(body, /name="match" value="all" checked/, "a hostile match falls back to All");
    // Only known ids survive: fraud, plus save_act from "save_act\u2028" (trim strips U+2028 like any space).
    assert.deepEqual([...body.matchAll(/data-tf-chip="([^"]*)"/g)].map((m) => m[1]), ["save_act", "fraud"].sort(
      (a, b) => MENU_ATTRIBUTE_TAG_IDS.indexOf(a) - MENU_ATTRIBUTE_TAG_IDS.indexOf(b),
    ));
    if (path.startsWith("/search")) assert.match(body, /Ignored 5 unknown tags\./);
    // Every data-tf-* attribute value is entity-safe (no raw quotes or angle brackets inside).
    for (const m of body.matchAll(/data-tf-[a-z-]+="([^"]*)"/g)) assert.doesNotMatch(m[1], /[<>']/);
    const payload = body.match(/<script type="application\/json" data-tf-data>([\s\S]*?)<\/script>/)[1];
    assert.doesNotMatch(payload, /[<>&\u2028\u2029]/);
    assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ["ids", "masks"]);
    assert.doesNotMatch(payload, /script|alert|evil/);
    if (path.startsWith("/search?q=")) {
      // q is the one value that is shown back, and only entity-escaped.
      // Attributes are double-quoted, so " < > & are entity-escaped and ' is inert.
      assert.match(body, /name="q" value="&quot;'&gt;&lt;script&gt;alert\('q'\)&lt;\/script&gt;\u2028\u2029é漢🙂\u202e&amp;amp;"/);
      assert.match(body, /é漢🙂/);
      assert.doesNotMatch(body, /&amp;amp;amp;/);
    }
  }
});

test("inline JSON escapes <, >, & and U+2028/U+2029 and round-trips", () => {
  const value = { s: "</script><!-- & \u2028 \u2029 > é🙂", n: [1, 2] };
  const out = inlineJson(value);
  assert.doesNotMatch(out, /[<>&\u2028\u2029]/);
  assert.match(out, /\\u003c\/script\\u003e\\u003c!-- \\u0026 \\u2028 \\u2029 \\u003e é🙂/);
  assert.deepEqual(JSON.parse(out), value);
  assert.equal(inlineJson(undefined), "null");
});

test("a tagMembership failure degrades home and /search to the filter without counts", async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  setPoolForTests({
    query: (sql) =>
      String(sql).includes("UNION ALL")
        ? Promise.reject(new Error("membership boom"))
        : Promise.resolve({ rows: [{ n: 0 }] }),
  });
  resetCatalogCacheForTests();
  try {
    for (const path of ["/", "/?tags=fraud&match=any", "/search?tags=fraud", "/search?q=Able&tags=fraud"]) {
      const page = await requestPage(path);
      assert.equal(page.status, 200, path);
      assert.match(page.body, /data-tag-filter/, path);
      assert.doesNotMatch(page.body, /class="tf-opt-n"/, `${path}: no per-tag numbers`);
      assert.doesNotMatch(page.body, /tf-menu-foot/);
      assert.match(page.body, /<p class="tf-count" data-tf-count[^>]* hidden>/, `${path}: count line hidden`);
      const payload = JSON.parse(page.body.match(/data-tf-data>([\s\S]*?)<\/script>/)[1]);
      assert.equal(payload.masks, null);
    }
  } finally {
    console.error = origError;
    setPoolForTests(null);
    resetCatalogCacheForTests();
  }
  assert.ok(errors.some((e) => e.includes("[tag-search] membership unavailable: membership boom")));
});

test("All needs every tag, Any needs at least one (memory store and SQL)", async () => {
  setMemory({ people: PEOPLE });
  const all = await requestPage("/search?tags=save_act,save_america_act&match=all");
  assert.equal(all.status, 200);
  assert.deepEqual(uniq(ids(all.body)), ["alma-able"]);
  const any = await requestPage("/search?tags=save_act,save_america_act&match=any");
  assert.deepEqual(uniq(ids(any.body)), ["alma-able", "bo-baker", "cy-able"]);
  const dflt = await requestPage("/search?tags=save_act,save_america_act");
  assert.deepEqual(uniq(ids(dflt.body)), ["alma-able"], "no match param means All");
  assert.equal(await countPeople({ tags: ["save_act", "save_america_act"], tagMatch: "all" }), 1);
  assert.equal(await countPeople({ tags: ["save_act", "save_america_act"] }), 3, "default stays OR");
  // Postgres: All ANDs one single-tag clause per tag; Any keeps the one OR clause.
  const seen = [];
  setPoolForTests({ query: (sql, params) => (seen.push({ sql, params }), Promise.resolve({ rows: [{ n: 0 }] })) });
  try {
    await countPeople({ tags: ["save_act", "save_america_act"], tagMatch: "all" });
    await countPeople({ tags: ["save_act", "save_america_act"] });
  } finally {
    setPoolForTests(null);
  }
  assert.equal((seen[0].sql.match(/jsonb_array_elements_text/g) || []).length, 2);
  assert.deepEqual(seen[0].params, [["save_act"], ["save_america_act"]]);
  assert.equal((seen[1].sql.match(/jsonb_array_elements_text/g) || []).length, 1);
  assert.deepEqual(seen[1].params, [["save_act", "save_america_act"]]);
});

test("keyword plus tags runs the keyword within the tag set; keyword only is unchanged", async () => {
  setMemory({ people: PEOPLE });
  const kw = await requestPage("/search?q=Able");
  assert.deepEqual(uniq(ids(kw.body)), ["alma-able", "cy-able", "di-able"]);
  const inSet = await requestPage("/search?q=Able&tags=save_america_act&match=all");
  assert.deepEqual(uniq(ids(inSet.body)), ["alma-able", "cy-able"]);
  const inAny = await requestPage("/search?q=Able&tags=save_act,fraud&match=any");
  assert.deepEqual(uniq(ids(inAny.body)), ["alma-able", "cy-able"]);
  const none = await requestPage("/search?q=Baker&tags=fraud");
  assert.deepEqual(ids(none.body), []);
  assert.match(none.body, /No seeded rows match that query/);
  // Keyword-only URLs and pager stay keyword-only.
  assert.doesNotMatch(kw.body, /match=all/);
});

test("no-JS: a plain GET form with checkboxes, radios and a submit button", async () => {
  setMemory({ people: PEOPLE });
  const home = await requestPage("/");
  assert.equal(home.status, 200);
  const form = home.body.match(/<form class="tui-search tf-form" action="\/search" method="get" role="search">([\s\S]*?)<\/form>/);
  assert.ok(form, "tag filter sits inside the home search form");
  const inner = form[1];
  assert.match(inner, /<input type="search" name="q"/);
  assert.match(inner, /<details class="tf-add-wrap" data-tf-add>\s*<summary class="tf-add">\+ Add tag/);
  const boxes = [...inner.matchAll(/<input type="checkbox" name="tags" value="([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(boxes, MENU_ATTRIBUTE_TAG_IDS, "all 17 tags, in menu order");
  assert.match(inner, /<input type="radio" name="match" value="all" checked>/);
  assert.match(inner, /<input type="radio" name="match" value="any">/);
  assert.match(inner, /<button type="submit" class="tf-go">/);
  // Labels are the Tags menu's short labels.
  for (const tag of MENU_ATTRIBUTE_TAGS) {
    assert.equal(tagShortLabel(tag), tagMenuItem(tag).label);
    assert.ok(inner.includes(`<span class="tf-opt-t">${tagShortLabel(tag).replace(/&/g, "&amp;")}</span>`), tag.id);
  }
  // What the browser submits without JS: repeated tags, match, empty q.
  const sub = await requestPage("/search?q=&tags=save_act&tags=save_america_act&match=any");
  assert.equal(sub.status, 200);
  assert.deepEqual(uniq(ids(sub.body)), ["alma-able", "bo-baker", "cy-able"]);
  // Chip remove and Clear are plain links.
  assert.match(sub.body, /<a class="tf-chip-x" href="\/search\?tags=save_america_act&amp;match=any" data-tf-remove="save_act"/);
  assert.match(sub.body, /<a class="tf-clear" href="\/search" data-tf-clear>Clear<\/a>/);
});

test("URL state: /search and home read tags and match back into the form", async () => {
  setMemory({ people: PEOPLE });
  const page = await requestPage("/search?tags=save_america_act,save_act&match=any");
  assert.match(page.body, /value="save_act" checked/);
  assert.match(page.body, /value="save_america_act" checked/);
  assert.doesNotMatch(page.body, /value="fraud" checked/);
  assert.match(page.body, /<input type="radio" name="match" value="any" checked>/);
  assert.match(page.body, /data-tf-applied="\/search\?tags=save_act,save_america_act&amp;match=any"/);
  assert.match(page.body, /<strong data-tf-n>3<\/strong> <span data-tf-noun>people match<\/span>/);
  const home = await requestPage("/?tags=fraud&match=any");
  assert.match(home.body, /value="fraud" checked/);
  assert.match(home.body, /data-tf-base="\/"/);
  assert.doesNotMatch(home.body, /href="\/people\/ed-cole"/, "home never lists results");
  // Client helpers parse and write the same canonical URL as the server, and count the same.
  const core = loadClientCore();
  const parsed = core.parse("?tags=save_america_act,SAVE-ACT,nope&match=any&q=x", MENU_ATTRIBUTE_TAG_IDS);
  assert.deepEqual([...parsed.tags], ["save_act", "save_america_act"]);
  assert.equal(parsed.match, "any");
  for (const st of [
    { q: "", tags: ["save_act"], match: "all" },
    { q: "a b", tags: ["fraud", "save_act"], match: "any" },
    { q: "x", tags: [], match: "any" },
  ]) {
    const server = tagSearchHref("/search", { ...st, tags: parseTagSearch(`tags=${st.tags.join(",")}`).tags });
    assert.equal(core.href("/search", { ...st, tags: core.parse(`?tags=${st.tags.join(",")}`, MENU_ATTRIBUTE_TAG_IDS).tags }, MENU_ATTRIBUTE_TAG_IDS), server);
  }
  const m = await tagMembership();
  for (const [tags, match] of [[["save_act", "save_america_act"], "all"], [["save_act", "save_america_act"], "any"], [["fraud"], "all"]]) {
    assert.equal(core.count({ ids: m.ids, masks: m.masks }, tags, match), countTagMatches(m.masks, tags, match));
    assert.equal(countTagMatches(m.masks, tags, match), await countPeople({ tags, tagMatch: match }));
  }
});

test("chip UI makes no limited requests: no network calls, counts are inline, only submit navigates", async () => {
  const src = tagSearchClientSource();
  for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /EventSource/, /WebSocket/, /\bimport\s*\(/, /new Image/, /\.submit\s*\(/, /location\.href\s*=/, /location\.replace/, /location\.reload/]) {
    assert.doesNotMatch(src, banned, `tag search client must not use ${banned}`);
  }
  // Exactly one navigation, and it is the form submit handler.
  assert.equal((src.match(/location\.assign\(/g) || []).length, 1);
  assert.match(src, /form\.addEventListener\("submit", \(e\) => \{\s*e\.preventDefault\(\);[\s\S]*?window\.location\.assign\(ET_TAG_SEARCH\.href\("\/search"/);
  // Chip picks only touch history (no request).
  assert.match(src, /history\.pushState\(/);
  // Counts ship inline with the page; there is no counts endpoint.
  setMemory({ people: PEOPLE });
  const home = await requestPage("/");
  assert.match(home.body, /<script type="application\/json" data-tf-data>\{"ids":\[/);
  assert.doesNotMatch(home.body, /\/api\/tag/);
  // The limiter is unchanged: /search is still the only metered search path, and nothing new is exempt.
  assert.equal(isExemptPath("/search", "GET"), false);
  assert.equal(isExemptPath("/", "GET"), false);
  const prev = process.env.ET_RL_SEARCH;
  process.env.ET_RL_SEARCH = "12";
  try {
    const lim = createRateLimiter();
    const req = { method: "GET", headers: {}, socket: { remoteAddress: "203.0.113.9" } };
    for (let i = 0; i < 40; i++) assert.equal(lim.check(req, "/").allowed, true, "home loads do not use the search bucket");
    for (let i = 0; i < 12; i++) assert.equal(lim.check(req, "/search").allowed, true);
    assert.equal(lim.check(req, "/search").allowed, false, "13th /search in the window is limited");
  } finally {
    if (prev === undefined) delete process.env.ET_RL_SEARCH;
    else process.env.ET_RL_SEARCH = prev;
  }
});

test("dropdown counts equal /tags/<slug> membership for all 17 tags", async () => {
  setMemory({ people: PEOPLE });
  const m = await tagMembership();
  assert.deepEqual(m.ids, MENU_ATTRIBUTE_TAG_IDS);
  const home = await requestPage("/");
  for (const tag of MENU_ATTRIBUTE_TAGS) {
    const page = await requestPage(tag.path);
    const listed = uniq(ids(page.body.slice(0, page.body.indexOf('<footer class="keymap"'))));
    assert.equal(m.counts[tag.id], listed.length, `${tag.id} count equals /tags list`);
    assert.equal(m.counts[tag.id], (await listPeople({ tags: [tag.id] })).length);
    assert.equal(countTagMatches(m.masks, [tag.id], "all"), m.counts[tag.id]);
    const opt = new RegExp(`value="${tag.id}"><span class="tf-box" aria-hidden="true"></span><span class="tf-opt-t">[^<]*</span><span class="tf-opt-n">${m.counts[tag.id]}</span>`);
    assert.match(home.body, opt, `${tag.id} home count`);
  }
  assert.equal(m.counts.save_act, 2);
  assert.equal(m.counts.fraud, 2);
  assert.deepEqual(membershipMasks({ save_act: ["a", "a", "b"] }).reduce((n, [, c]) => n + c, 0), 2);
  // Postgres: one read, one UNION ALL part per tag, each with the exact WHERE countPeople uses for that tag.
  const seen = [];
  setPoolForTests({ query: (sql, params) => (seen.push({ sql, params }), Promise.resolve({ rows: [{ n: 0 }] })) });
  try {
    await tagMembership();
    const parts = seen[0].sql.split(" UNION ALL ");
    assert.equal(parts.length, MENU_ATTRIBUTE_TAGS.length);
    for (const [i, id] of MENU_ATTRIBUTE_TAG_IDS.entries()) {
      seen.length = 1;
      await countPeople({ tags: [id] });
      const where = seen[1].sql.replace(/^SELECT COUNT\(\*\)::int AS n FROM people/, "").replace(/\$1\b/g, `$${i + 1}`);
      assert.equal(parts[i], `SELECT ${i}::int AS i, id FROM people${where}`);
      assert.deepEqual(seen[0].params[i], [id]);
    }
  } finally {
    setPoolForTests(null);
    resetCatalogCacheForTests();
  }
});

test("client ET_TAG_SEARCH parse/href/count agree with the server on the same fixture cases", async () => {
  setMemory({ people: PEOPLE });
  const core = loadClientCore();
  const m = await tagMembership();
  const data = JSON.parse(JSON.stringify({ ids: m.ids, masks: m.masks }));
  const cases = [
    "tags=save_act",
    "tags=save_america_act,save_act&match=any",
    "tags=SAVE-ACT,save_act,official,nope,%3Cscript%3E&match=ANY",
    "tags=save_act&tags=fraud&match=all",
    "tags=fraud&match=bogus",
    "q=Able&tags=fraud,save_america_act&match=any",
    `tags=${MENU_ATTRIBUTE_TAG_IDS.join(",")}&match=any`,
    `tags=${Array(40).fill("x").join(",")},fraud`,
    `tags=${"save_act,".repeat(Math.ceil(TAG_SEARCH_MAX_RAW / 9) + 1)}`,
    "match=any",
    "",
  ];
  for (const qs of cases) {
    const server = parseTagSearch(qs);
    const client = core.parse(`?${qs}`, MENU_ATTRIBUTE_TAG_IDS);
    assert.deepEqual([...client.tags], server.tags, `tags for ${qs.slice(0, 60)}`);
    assert.equal(client.match, server.match, `match for ${qs.slice(0, 60)}`);
    const q = new URLSearchParams(qs).get("q") || "";
    assert.equal(
      core.href("/search", { q, tags: client.tags, match: client.match }, MENU_ATTRIBUTE_TAG_IDS),
      tagSearchHref("/search", { q, tags: server.tags, match: server.match }),
      `href for ${qs.slice(0, 60)}`,
    );
    assert.equal(core.count(data, client.tags, client.match), countTagMatches(m.masks, server.tags, server.match), `count for ${qs.slice(0, 60)}`);
    if (server.tags.length) {
      assert.equal(countTagMatches(m.masks, server.tags, server.match), await countPeople({ tags: server.tags, tagMatch: server.match }));
    }
  }
});

test("cachedCatalogRead: N concurrent calls after a drop make 1 loader call; an epoch bump discards a stale in-flight result", async () => {
  const fake = { query: () => Promise.resolve({ rows: [] }) };
  setPoolForTests(fake);
  resetCatalogCacheForTests(); // dropCatalogCache
  try {
    let calls = 0;
    const loader = () => new Promise((resolve) => setTimeout(() => resolve(++calls), 5));
    const got = await Promise.all(Array.from({ length: 8 }, () => cachedCatalogRead("t-dedupe", loader)));
    assert.equal(calls, 1);
    assert.deepEqual(got, Array(8).fill(1));
    assert.equal(await cachedCatalogRead("t-dedupe", loader), 1, "fresh value is cached");
    assert.equal(calls, 1);

    // Stale in-flight: a drop (catalog write) while the loader runs.
    const releases = [];
    const slow = () => new Promise((resolve) => { const v = `v${releases.length + 1}`; releases.push(() => resolve(v)); });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    resetCatalogCacheForTests();
    const first = cachedCatalogRead("t-stale", slow);
    await tick();
    assert.equal(releases.length, 1);
    resetCatalogCacheForTests(); // epoch bump while v1 is in flight
    const second = cachedCatalogRead("t-stale", slow); // new epoch: not deduped onto the stale read
    await tick();
    assert.equal(releases.length, 2);
    releases[1]();
    assert.equal(await second, "v2");
    releases[0](); // the stale read lands late
    assert.equal(await first, "v1");
    await tick();
    assert.equal(await cachedCatalogRead("t-stale", slow), "v2", "stale v1 did not replace the cache");
    // And a stale read that lands into an empty slot is not cached either.
    resetCatalogCacheForTests();
    const third = cachedCatalogRead("t-stale", slow);
    await tick();
    resetCatalogCacheForTests();
    releases[2]();
    assert.equal(await third, "v3");
    await tick();
    const fourth = cachedCatalogRead("t-stale", slow);
    await tick();
    assert.equal(releases.length, 4, "discarded v3 forced a fresh load");
    releases[3]();
    assert.equal(await fourth, "v4");

    // tagMembership and counts both go through the helper: concurrent misses share one query.
    const seen = [];
    setPoolForTests({ query: (sql) => (seen.push(sql), new Promise((r) => setTimeout(() => r({ rows: [] }), 5))) });
    resetCatalogCacheForTests();
    await Promise.all(Array.from({ length: 6 }, () => tagMembership()));
    assert.equal(seen.filter((sql) => sql.includes("UNION ALL")).length, 1);
  } finally {
    setPoolForTests(null);
    resetCatalogCacheForTests();
  }
});

test("keyword + tags builds the tag set from tagMembership Sets, not a second listPeople", async () => {
  setMemory({ people: PEOPLE });
  const m = await tagMembership();
  for (const [tags, match] of [[["save_act", "save_america_act"], "all"], [["save_act", "fraud"], "any"], [["fraud"], "all"]]) {
    const fromSets = [...memberIdSet(m, tags, match)].sort();
    const fromList = (await listPeople({ tags, tagMatch: match })).map((r) => r.id).sort();
    assert.deepEqual(fromSets, fromList);
  }
  assert.equal(memberIdSet({ counts: {} }, ["fraud"]), null);
  // The Sets never reach the page.
  const page = await requestPage("/search?q=Able&tags=save_act&match=all");
  const payload = page.body.match(/<script type="application\/json" data-tf-data>([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ["ids", "masks"]);
  assert.doesNotMatch(payload, /alma-able|members/);
  // Postgres: the keyword path issues no tag-filtered people list query.
  const seen = [];
  setPoolForTests({ query: (sql) => (seen.push(String(sql)), Promise.resolve({ rows: [] })) });
  resetCatalogCacheForTests();
  try {
    const res = await requestPage("/search?q=Able&tags=save_act,fraud&match=any");
    assert.equal(res.status, 200);
  } finally {
    setPoolForTests(null);
  }
  assert.equal(seen.filter((sql) => /^SELECT \* FROM people WHERE/.test(sql.trim())).length, 0);
  assert.equal(seen.filter((sql) => sql.includes("UNION ALL")).length, 1);
});

test("home and /search share one search input", async () => {
  setMemory({ people: PEOPLE });
  const home = await requestPage("/");
  const search = await requestPage("/search?q=Able&tags=fraud");
  const strip = (h) => h.match(/<label class="tui-search-label">[\s\S]*?<\/label>/)[0].replace(/ value="[^"]*"/, "");
  assert.equal(strip(home.body), strip(search.body));
  assert.match(search.body, /<input type="search" name="q" value="Able"/);
});
