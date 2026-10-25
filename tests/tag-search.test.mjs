import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { handle } from "../app/server.mjs";
import { countPeople, listPeople, setMemory, setPoolForTests, tagMembership } from "../app/lib/store.mjs";
import { ATTRIBUTE_TAGS, ATTRIBUTE_TAG_IDS, tagShortLabel } from "../app/lib/tags.mjs";
import {
  TAG_SEARCH_MAX_RAW,
  TAG_SEARCH_MAX_TAGS,
  countTagMatches,
  membershipMasks,
  parseTagSearch,
  tagSearchHref,
} from "../app/lib/tag-search.mjs";
import { createRateLimiter, isExemptPath } from "../app/lib/rate-limit.mjs";
import { tagMenuItem } from "../app/lib/html.mjs";

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

test("tags param: only known ATTRIBUTE_TAGS ids, deduped, menu order, capped", () => {
  assert.equal(TAG_SEARCH_MAX_TAGS, ATTRIBUTE_TAGS.length);
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
  assert.equal(parseTagSearch(`tags=${ATTRIBUTE_TAG_IDS.join(",")}`).tags.length, ATTRIBUTE_TAGS.length);
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
  assert.deepEqual(boxes, ATTRIBUTE_TAG_IDS, "all 17 tags, in menu order");
  assert.match(inner, /<input type="radio" name="match" value="all" checked>/);
  assert.match(inner, /<input type="radio" name="match" value="any">/);
  assert.match(inner, /<button type="submit" class="tf-go">/);
  // Labels are the Tags menu's short labels.
  for (const tag of ATTRIBUTE_TAGS) {
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
  const parsed = core.parse("?tags=save_america_act,SAVE-ACT,nope&match=any&q=x", ATTRIBUTE_TAG_IDS);
  assert.deepEqual([...parsed.tags], ["save_act", "save_america_act"]);
  assert.equal(parsed.match, "any");
  for (const st of [
    { q: "", tags: ["save_act"], match: "all" },
    { q: "a b", tags: ["fraud", "save_act"], match: "any" },
    { q: "x", tags: [], match: "any" },
  ]) {
    const server = tagSearchHref("/search", { ...st, tags: parseTagSearch(`tags=${st.tags.join(",")}`).tags });
    assert.equal(core.href("/search", { ...st, tags: core.parse(`?tags=${st.tags.join(",")}`, ATTRIBUTE_TAG_IDS).tags }, ATTRIBUTE_TAG_IDS), server);
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
  assert.deepEqual(m.ids, ATTRIBUTE_TAG_IDS);
  const home = await requestPage("/");
  for (const tag of ATTRIBUTE_TAGS) {
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
    assert.equal(parts.length, ATTRIBUTE_TAGS.length);
    for (const [i, id] of ATTRIBUTE_TAG_IDS.entries()) {
      seen.length = 1;
      await countPeople({ tags: [id] });
      const where = seen[1].sql.replace(/^SELECT COUNT\(\*\)::int AS n FROM people/, "").replace(/\$1\b/g, `$${i + 1}`);
      assert.equal(parts[i], `SELECT ${i}::int AS i, id FROM people${where}`);
      assert.deepEqual(seen[0].params[i], [id]);
    }
  } finally {
    setPoolForTests(null);
  }
});
