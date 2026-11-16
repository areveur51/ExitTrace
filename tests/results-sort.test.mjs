import assert from "node:assert/strict";
import { test } from "node:test";
import {
  peopleList,
  resultsSortControl,
  resultsSortHeading,
  sortListedPeople,
} from "../app/lib/html.mjs";
import {
  DEFAULT_RESULTS_SORT,
  NAME_SORT_OTHER,
  OCCUPATION_SORT_NONE,
  PORTRAIT_SORT_HAS,
  PORTRAIT_SORT_MISSING,
  RESULTS_SORTS,
  RESULTS_SORT_LABELS,
  RESULTS_SORT_STORAGE_KEY,
  comparePersonDirectoryNames,
  normalizeResultsSort,
  parseCookieResultsSort,
  parseResultsSort,
  personLastName,
  resolveResultsSort,
  resultsSortHref,
} from "../app/lib/results-sort.mjs";
import { handle } from "../app/server.mjs";
import { loadSeedFile, setMemory } from "../app/lib/store.mjs";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function requestPage(pathname, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: pathname,
      headers: { host: "127.0.0.1", cookie: cookie || "" },
    };
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

function samplePeople() {
  return [
    {
      id: "zeta",
      name: "Zeta Ward",
      category: "firing",
      event_date: "2026-02-01",
      photo: "/media/people/zeta.jpg",
      role: "Director",
      events: [],
    },
    {
      id: "ada",
      name: "Ada Lovelace",
      category: "firing",
      event_date: "2024-06-01",
      photo: "",
      role: "Analyst",
      events: [],
    },
    {
      id: "mia",
      name: "Mia Chen",
      category: "firing",
      event_date: "2025-03-01",
      photo: "/media/people/mia.jpg",
      role: "Actor",
      events: [],
    },
    {
      id: "empty-face",
      name: "No Face",
      category: "firing",
      event_date: "2023-01-01",
      photo: "/empty-portrait.jpg",
      role: "",
      events: [],
    },
  ];
}

function headingOrder(html) {
  return [...html.matchAll(/<h2 class="tui-group-h">([^<]*)<\/h2>/g)].map((m) => m[1]);
}

function titleOrder(html) {
  return [...html.matchAll(/<div class="tui-title">([^<]*)<\/div>/g)].map((m) => m[1]);
}

test("sort ids, labels, and parsers", () => {
  assert.deepEqual(RESULTS_SORTS, ["year", "name", "occupation", "portrait"]);
  assert.equal(DEFAULT_RESULTS_SORT, "year");
  assert.equal(RESULTS_SORT_STORAGE_KEY, "exittrace-results-sort");
  assert.equal(RESULTS_SORT_LABELS.year, "Year");
  assert.equal(RESULTS_SORT_LABELS.portrait, "Portrait");
  assert.equal(normalizeResultsSort("NAME"), "name");
  assert.equal(normalizeResultsSort("nope"), "year");
  assert.equal(parseResultsSort(new URLSearchParams("sort=occupation")), "occupation");
  assert.equal(parseResultsSort(new URLSearchParams("")), "year");
  assert.equal(parseResultsSort(new URLSearchParams("sort=")), "year");
  assert.equal(parseCookieResultsSort("exittrace-results-sort=portrait"), "portrait");
  assert.equal(
    parseCookieResultsSort("exittrace-page-size=34; exittrace-results-sort=name"),
    "name",
  );
  assert.equal(parseCookieResultsSort(""), "year");
  assert.equal(
    resolveResultsSort(new URLSearchParams("sort=name"), "exittrace-results-sort=portrait"),
    "name",
  );
  assert.equal(
    resolveResultsSort(new URLSearchParams(""), "exittrace-results-sort=portrait"),
    "portrait",
  );
});

test("resultsSortHref keeps year off the URL and preserves other query", () => {
  assert.equal(resultsSortHref("/firings", "year"), "/firings");
  assert.equal(resultsSortHref("/firings", "name"), "/firings?sort=name");
  assert.equal(resultsSortHref("/firings?tags=civilian", "name"), "/firings?tags=civilian&sort=name");
  assert.equal(resultsSortHref("/firings?sort=occupation", "year"), "/firings");
  assert.equal(resultsSortHref("/search?q=comey", "portrait"), "/search?q=comey&sort=portrait");
});

test("sort dropdown lists year, name, occupation, and portrait", () => {
  const html = resultsSortControl();
  assert.match(html, /data-results-sort-select/);
  assert.match(html, /<option value="year" selected>Year</);
  assert.match(html, />Name</);
  assert.match(html, />Occupation</);
  assert.match(html, />Portrait</);
  const named = resultsSortControl("name");
  assert.match(named, /<option value="name" selected>Name</);
  assert.match(named, /<option value="year">Year</);
});

test("personLastName takes the last token and drops Jr./Sr./II", () => {
  assert.equal(personLastName("Ada Lovelace"), "Lovelace");
  assert.equal(personLastName("Ahmed bin Dagher"), "Dagher");
  assert.equal(personLastName("James R. Clapper Jr."), "Clapper");
  assert.equal(personLastName("John Smith III"), "Smith");
  assert.equal(personLastName("Elizabeth II"), "Elizabeth");
  assert.equal(personLastName("Madonna"), "Madonna");
  assert.equal(personLastName("7-Eleven"), "7-Eleven");
  assert.equal(personLastName(""), "");
  assert.ok(comparePersonDirectoryNames("Mia Chen", "Ada Lovelace") < 0);
  assert.ok(comparePersonDirectoryNames("Ada Lovelace", "Alan Lowe") < 0);
  assert.ok(comparePersonDirectoryNames("John Smith Jr.", "John Smythe") < 0);
  assert.ok(comparePersonDirectoryNames("Ada Smith", "John Smith") < 0);
});

test("peopleList year keeps newest-year headings; other sorts regroup", () => {
  const rows = samplePeople();
  const year = peopleList(rows);
  assert.deepEqual(headingOrder(year), ["2026", "2025", "2024", "2023"]);
  assert.deepEqual(titleOrder(year), ["Zeta Ward", "Mia Chen", "Ada Lovelace", "No Face"]);

  const named = peopleList(rows, { sort: "name" });
  assert.deepEqual(headingOrder(named), ["C", "F", "L", "W"]);
  assert.deepEqual(titleOrder(named), ["Mia Chen", "No Face", "Ada Lovelace", "Zeta Ward"]);
  assert.doesNotMatch(named, /<h2 class="tui-group-h">2026<\/h2>/);

  const occupation = peopleList(rows, { sort: "occupation" });
  assert.deepEqual(headingOrder(occupation), ["Actor", "Analyst", "Director", OCCUPATION_SORT_NONE]);
  assert.deepEqual(titleOrder(occupation), ["Mia Chen", "Ada Lovelace", "Zeta Ward", "No Face"]);

  const portrait = peopleList(rows, { sort: "portrait" });
  assert.deepEqual(headingOrder(portrait), [PORTRAIT_SORT_HAS, PORTRAIT_SORT_MISSING]);
  assert.deepEqual(titleOrder(portrait), ["Mia Chen", "Zeta Ward", "No Face", "Ada Lovelace"]);
  assert.equal(resultsSortHeading({ type: "person", row: rows[3] }, "portrait"), PORTRAIT_SORT_MISSING);
  assert.equal(resultsSortHeading({ type: "person", row: rows[0] }, "name"), "W");
  assert.equal(resultsSortHeading({ type: "person", row: { name: "Ahmed bin Dagher" } }, "name"), "D");
  assert.equal(resultsSortHeading({ type: "person", row: { name: "7-Eleven" } }, "name"), NAME_SORT_OTHER);
});

test("sortListedPeople reorders the full set before paging", () => {
  const rows = samplePeople();
  assert.deepEqual(
    sortListedPeople(rows, "name").map((row) => row.id),
    ["mia", "empty-face", "ada", "zeta"],
  );
  assert.deepEqual(
    sortListedPeople(rows, "portrait").map((row) => row.id),
    ["mia", "zeta", "empty-face", "ada"],
  );
});

test("firings honors ?sort= and the results-sort cookie", async () => {
  setMemory(goldSeed());
  const year = await requestPage("/firings");
  assert.equal(year.status, 200);
  assert.match(year.body, /data-results-sort-select/);
  assert.match(year.body, /<option value="year" selected>Year</);
  assert.match(year.body, /<h2 class="tui-group-h">\d{4}<\/h2>/);
  assert.match(year.body, /data-results-sort="year"/);

  const named = await requestPage("/firings?sort=name");
  assert.equal(named.status, 200);
  assert.match(named.body, /<option value="name" selected>Name</);
  assert.match(named.body, /<h2 class="tui-group-h">[A-Z#]<\/h2>/);
  assert.doesNotMatch(named.body, /<h2 class="tui-group-h">\d{4}<\/h2>/);
  if (/Page 1 of [2-9]/.test(named.body) || /Page 1 of \d{2,}/.test(named.body)) {
    assert.match(named.body, /href="\/firings\?sort=name&amp;page=2"/);
  }
  const names = titleOrder(named.body);
  assert.ok(names.length > 1);
  const sorted = names.slice().sort(comparePersonDirectoryNames);
  assert.deepEqual(names, sorted);
  assert.equal(resultsSortHeading({ type: "person", row: { name: names[0] } }, "name").length, 1);

  const portrait = await requestPage("/firings", {
    cookie: "exittrace-results-sort=portrait",
  });
  assert.equal(portrait.status, 200);
  assert.match(portrait.body, /<option value="portrait" selected>Portrait</);
  assert.match(portrait.body, new RegExp(`<h2 class="tui-group-h">${PORTRAIT_SORT_HAS}</h2>`));
});

test("app.js reloads on sort change and styles.css has the sort control", () => {
  const js = fs.readFileSync(path.join(ROOT, "app/public/app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "app/public/styles.css"), "utf8");
  assert.match(js, /data-results-sort-select/);
  assert.match(js, /exittrace-results-sort/);
  assert.match(js, /searchParams\.set\("sort"/);
  assert.match(js, /applyResultsSort/);
  assert.match(css, /\.results-sort-select/);
  assert.match(css, /html\[data-results-view="cards"\] \.results-controls-row--view \{[\s\S]*minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});
