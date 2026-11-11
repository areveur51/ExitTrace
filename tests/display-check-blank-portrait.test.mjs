/**
 * The post-write display check must accept a blank-portrait person detail
 * page. Those pages render the name and a person-detail article, not
 * href="/people/<id>" or /media/people/<id>.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DisplayError,
  checkPersonDisplayed,
  fetchCatalogHtml,
  hasPersonOnDetail,
  hasPersonOnList,
} from "../app/lib/display-check.mjs";
import { esc, layout, peopleList, personDetail } from "../app/lib/html.mjs";
import { personSlug } from "../app/lib/promote.mjs";
import {
  applyIdentifiedPerson,
  portraitRequiredFor,
  setMemory,
} from "../app/lib/store.mjs";
import { withNewPersonLock } from "./new-person-lock.mjs";

const CITES = [
  "https://www.example.com/news/tom-obrien-held",
  "https://www.example.net/world/tom-obrien-report",
];

const EMPTY_MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), "et-display-blank-"));
fs.mkdirSync(path.join(EMPTY_MEDIA, "people"), { recursive: true });

const APOSTROPHE_NAME = "Tom O'Brien";

function detailPage(row) {
  return layout({
    title: row.name,
    path: "/people/" + row.id,
    heading: row.name,
    query: row.name,
    categoryId: row.category,
    crumbLabel: row.name,
    countLabel: "detail",
    body: personDetail(row),
  });
}

test("death_celebrity stays portrait-optional; esc leaves apostrophes in the name", () => {
  assert.equal(portraitRequiredFor("death_celebrity"), false);
  const html = detailPage({
    id: "tom-o-brien",
    name: APOSTROPHE_NAME,
    category: "death_celebrity",
    photo: "",
    photo_credit: "",
  });
  assert.equal(html.includes(APOSTROPHE_NAME), true);
  assert.equal(html.includes("Tom O&apos;Brien"), false);
  assert.equal(html.includes("Tom O&#39;Brien"), false);
});

test("a rendered blank-portrait detail page for an apostrophe name passes", () => {
  const person = {
    id: "tom-o-brien",
    name: APOSTROPHE_NAME,
    category: "death_celebrity",
    photo: "",
  };
  const html = detailPage(person);
  assert.equal(html.includes("/media/people/" + person.id), false);
  assert.equal(html.includes('href="/people/' + person.id + '"'), false);
  assert.equal(html.includes(person.id), false);
  assert.equal(hasPersonOnDetail(html, person), true);
});

test("a page lacking the person fails", () => {
  const person = { id: "tom-o-brien", name: APOSTROPHE_NAME, category: "death_celebrity" };
  assert.equal(hasPersonOnDetail("", person), false);
  assert.equal(hasPersonOnDetail("<article class=\"detail person-detail\"></article>", person), false);
  assert.equal(
    hasPersonOnDetail(
      detailPage({
        id: "casey-vale",
        name: "Casey Vale",
        category: "death_celebrity",
        photo: "",
      }),
      person,
    ),
    false,
  );
  assert.equal(
    hasPersonOnDetail('<img src="/media/people/tom-o-brien.jpg" alt="">', person),
    false,
  );
});

test("a page with a portrait still passes", () => {
  const person = {
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    photo: "/media/people/casey-vale.jpg",
    photo_credit: "Test portrait",
  };
  assert.equal(hasPersonOnDetail(detailPage(person), person), true);
});

test("after a blank-portrait death_celebrity insert, the live display check passes", async () => {
  setMemory({ people: [] });
  const created = await applyIdentifiedPerson(
    withNewPersonLock({
      subject: APOSTROPHE_NAME,
      event_date: "2024-06-15",
      category: "death_celebrity",
      cite_urls: CITES,
      photo: "",
      photo_credit: "Should not be stored",
      mediaDir: EMPTY_MEDIA,
    }),
  );
  assert.equal(created.action, "created");
  assert.equal(created.person.photo, "");
  assert.equal(created.person.name, APOSTROPHE_NAME);
  assert.equal(created.person.id, personSlug(APOSTROPHE_NAME));

  const shown = await checkPersonDisplayed(created.person);
  assert.equal(shown.detail, "/people/" + created.person.id);
  assert.match(shown.list, /^\/deaths\/celebrities/);

  const detail = await fetchCatalogHtml(shown.detail);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.includes("/media/people/" + created.person.id), false);
  assert.equal(hasPersonOnDetail(detail.body, created.person), true);
});

test("checkPersonDisplayed rejects a person who is not on the page", async () => {
  setMemory({ people: [] });
  await assert.rejects(
    () => checkPersonDisplayed({ id: "tom-o-brien", name: APOSTROPHE_NAME, category: "notable" }),
    (err) => err instanceof DisplayError && err.code === "detail_missing",
  );
});

const AMP_NAME = "Reed & Vale";
const QUOTE_NAME = "John \x22Jack\x22 Vale";

function listPage(rows) {
  return peopleList(rows);
}

test("real personDetail/layout output keeps Tom O\x27Brien literal in the h1", () => {
  const person = {
    id: "tom-o-brien",
    name: APOSTROPHE_NAME,
    category: "death_celebrity",
    photo: "",
  };
  const html = detailPage(person);
  const h1At = html.indexOf("<h1");
  assert.ok(h1At >= 0);
  const h1Snippet = html.slice(h1At, html.indexOf("</h1>", h1At) + 5);
  assert.equal(h1Snippet, "<h1 class=\x22vh\x22>Tom O\x27Brien</h1>");
  assert.equal(html.includes("Tom O\x27Brien"), true);
  assert.equal(html.includes("Tom O&apos;Brien"), false);
  assert.equal(html.includes("Tom O&#39;Brien"), false);
  assert.equal(hasPersonOnDetail(html, person), true);
});

test("hasPersonOnDetail and hasPersonOnList use esc() for &, quotes, and apostrophes", () => {
  const people = [
    { id: "tom-o-brien", name: APOSTROPHE_NAME, category: "death_celebrity", photo: "", event_date: "2024-06-15" },
    { id: "reed-vale", name: AMP_NAME, category: "death_celebrity", photo: "", event_date: "2024-06-16" },
    { id: "john-jack-vale", name: QUOTE_NAME, category: "death_celebrity", photo: "", event_date: "2024-06-17" },
  ];
  for (const person of people) {
    const detail = detailPage(person);
    const list = listPage([person]);
    assert.equal(hasPersonOnDetail(detail, person), true, person.name + " detail");
    assert.equal(hasPersonOnList(list, person), true, person.name + " list");
    const encoded = esc(person.name);
    assert.equal(detail.includes(encoded), true);
    assert.equal(list.includes(encoded), true);
    assert.equal(list.includes("href=\x22/people/" + person.id + "\x22"), true);
  }
  const ampDetail = detailPage(people[1]);
  assert.equal(ampDetail.includes("Reed & Vale"), false);
  assert.equal(ampDetail.includes("Reed &amp; Vale"), true);
  const quoteDetail = detailPage(people[2]);
  assert.equal(quoteDetail.includes(QUOTE_NAME), false);
  assert.equal(quoteDetail.includes("John &quot;Jack&quot; Vale"), true);
});

test("a live list page for names with &, quotes, and apostrophes passes the display check", async () => {
  setMemory({ people: [] });
  const subjects = [
    { subject: APOSTROPHE_NAME, event_date: "2024-06-15", cite_urls: CITES },
    {
      subject: AMP_NAME,
      event_date: "2024-06-16",
      cite_urls: [
        "https://www.example.com/news/reed-vale-held",
        "https://www.example.net/world/reed-vale-report",
      ],
    },
    {
      subject: QUOTE_NAME,
      event_date: "2024-06-17",
      cite_urls: [
        "https://www.example.com/news/john-jack-vale-held",
        "https://www.example.net/world/john-jack-vale-report",
      ],
    },
  ];
  const created = [];
  for (const input of subjects) {
    const row = await applyIdentifiedPerson(
      withNewPersonLock({
        subject: input.subject,
        event_date: input.event_date,
        category: "death_celebrity",
        cite_urls: input.cite_urls,
        photo: "",
        photo_credit: "Should not be stored",
        mediaDir: EMPTY_MEDIA,
      }),
    );
    assert.equal(row.action, "created");
    assert.equal(row.person.name, input.subject);
    created.push(row.person);
  }
  for (const person of created) {
    const shown = await checkPersonDisplayed(person);
    assert.equal(shown.detail, "/people/" + person.id);
    assert.match(shown.list, /^\/deaths\/celebrities/);
    const list = await fetchCatalogHtml(shown.list);
    assert.equal(list.status, 200);
    assert.equal(hasPersonOnList(list.body, person), true, person.name);
    const detail = await fetchCatalogHtml(shown.detail);
    assert.equal(detail.status, 200);
    assert.equal(hasPersonOnDetail(detail.body, person), true, person.name);
  }
});
