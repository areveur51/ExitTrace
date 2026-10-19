/**
 * Celebrity deaths may be stored with a blank portrait.
 * Every other promote kind still requires one.
 * The blank is the neutral placeholder, and a later approved still fills it.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PROMOTE_CATEGORY_IDS, categoryById } from "../app/lib/categories.mjs";
import { peopleList, personDetail, personRow, searchBody } from "../app/lib/html.mjs";
import { isStoredPeoplePortrait } from "../app/lib/portrait.mjs";
import { PromoteError, personSlug } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
  getPerson,
  portraitRequiredFor,
  PORTRAIT_OPTIONAL_KINDS,
  setMemory,
} from "../app/lib/store.mjs";
import { LOCK_MEDIA_DIR, withNewPersonLock } from "./new-person-lock.mjs";

const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];

const EMPTY_MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), "et-death-celeb-blank-"));
fs.mkdirSync(path.join(EMPTY_MEDIA, "people"), { recursive: true });

function blankInput(subject, category) {
  return withNewPersonLock({
    subject,
    event_date: "2024-06-15",
    category,
    cite_urls: CITES,
    photo: "",
    photo_credit: "Should not be stored",
    mediaDir: EMPTY_MEDIA,
  });
}

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

function imgTags(html) {
  return html.match(/<img\b[^>]*>/gi) || [];
}

/** List rows and the person card: a real placeholder src, never a broken img. */
function assertNeutralPlaceholder(html, label) {
  const tags = imgTags(html);
  assert.ok(tags.length >= 1, `${label}: expected a portrait image`);
  for (const tag of tags) {
    const src = tag.match(/\ssrc="([^"]*)"/);
    assert.ok(src, `${label}: img missing src: ${tag}`);
    assert.ok(src[1].trim(), `${label}: empty img src: ${tag}`);
  }
  assert.match(html, /class="[^"]*\bempty-portrait\b/, label);
  assert.match(html, /src="\/empty-portrait\.jpg/, label);
  assert.doesNotMatch(html, /disclaimer/i, label);
  assert.doesNotMatch(html, /no portrait|portrait unavailable|image unavailable/i, label);
}

test("death_celebrity without a portrait promotes with an empty photo", async () => {
  setMemory({ people: [] });
  const created = await applyIdentifiedPerson(blankInput("Avery Quinn", "death_celebrity"));
  assert.equal(created.action, "created");
  assert.equal(created.person.photo, "");
  assert.equal(created.person.photo_credit, "");
  assert.equal(created.person.category, "death_celebrity");

  const stored = await getPerson(personSlug("Avery Quinn"));
  assert.ok(stored);
  assert.equal(stored.photo, "");
  assert.equal(stored.photo_credit, "");
  assert.equal(isStoredPeoplePortrait(stored.photo), false);

  const kept = await applyIdentifiedPerson(
    withNewPersonLock({
      subject: "Blake Rowan",
      event_date: "2024-06-15",
      category: "death_celebrity",
      cite_urls: CITES,
    }),
  );
  assert.equal(kept.action, "created");
  assert.equal(isStoredPeoplePortrait(kept.person.photo), true);
  assert.match(kept.person.photo, /^\/media\/people\/blake-rowan\./);
  assert.equal(kept.person.photo_credit, "Test portrait");
});

test("every other promote kind without a portrait still throws missing_portrait", async () => {
  assert.deepEqual([...PORTRAIT_OPTIONAL_KINDS], ["death_celebrity"]);
  assert.equal(portraitRequiredFor("death_celebrity"), false);
  const required = PROMOTE_CATEGORY_IDS.filter((id) => !PORTRAIT_OPTIONAL_KINDS.has(id));
  assert.deepEqual(
    required,
    PROMOTE_CATEGORY_IDS.filter((id) => id !== "death_celebrity"),
  );
  assert.equal(required.length, PROMOTE_CATEGORY_IDS.length - 1);
  assert.ok(required.every((id) => portraitRequiredFor(id)));

  for (const kind of required) {
    setMemory({ people: [] });
    const subject = `No Portrait ${kind}`;
    await assert.rejects(
      () => applyIdentifiedPerson(blankInput(subject, kind)),
      (err) => {
        assert.equal(err instanceof PromoteError, true, kind);
        assert.equal(err.code, "missing_portrait", `${kind}: ${err.code} ${err.message}`);
        return true;
      },
    );
    assert.equal(await getPerson(personSlug(subject)), null, kind);
  }
});

test("death_celebrity list and card render the neutral placeholder", async () => {
  setMemory({ people: [] });
  const created = await applyIdentifiedPerson(blankInput("Avery Quinn", "death_celebrity"));
  const row = await getPerson(created.person.id);
  assert.equal(row.photo, "");

  const rowHtml = personRow(row);
  const listHtml = peopleList([row]);
  const searchHtml = searchBody([{ type: "person", row }], row.name);
  const cardHtml = personDetail(row);
  for (const [label, html] of [
    ["person row", rowHtml],
    ["people list", listHtml],
    ["search list", searchHtml],
    ["person card", cardHtml],
  ]) {
    assertNeutralPlaceholder(html, label);
  }

  const listPath = categoryById("death_celebrity").path;
  const listPage = await requestPage(listPath);
  assert.equal(listPage.status, 200);
  const cards = listPage.body.match(/<a class="tui-row person-card[\s\S]*?<\/a>/g) || [];
  assert.equal(cards.length, 1);
  assert.match(cards[0], /Avery Quinn/);
  assertNeutralPlaceholder(cards[0], "celebrities list page");

  const detailPage = await requestPage(`/people/${row.id}`);
  assert.equal(detailPage.status, 200);
  const article = detailPage.body.match(/<article class="detail person-detail"[\s\S]*<\/article>/);
  assert.ok(article, "person detail article");
  assert.match(article[0], /Avery Quinn/);
  assertNeutralPlaceholder(article[0], "person detail page");
});

test("an empty-photo death_celebrity is filled when an approved portrait is supplied later", async () => {
  setMemory({ people: [] });
  const created = await applyIdentifiedPerson(blankInput("Morgan Hale", "death_celebrity"));
  assert.equal(created.action, "created");
  assert.equal(created.person.photo, "");
  assert.equal(created.person.photo_credit, "");

  const filled = await applyIdentifiedPerson({
    subject: "Morgan Hale",
    event_date: "2024-07-01",
    category: "death_celebrity",
    cite_urls: CITES,
    photo: withNewPersonLock({}).photo,
    photo_credit: "Wikimedia Commons",
    mediaDir: LOCK_MEDIA_DIR,
  });
  assert.equal(filled.action, "annotated");
  assert.equal(isStoredPeoplePortrait(filled.person.photo), true);
  assert.match(filled.person.photo, /^\/media\/people\/morgan-hale\./);
  assert.equal(filled.person.photo_credit, "Wikimedia Commons");
  assert.doesNotMatch(filled.person.photo, /empty-portrait/);

  const stored = await getPerson("morgan-hale");
  assert.equal(stored.photo, filled.person.photo);
  assert.equal(stored.photo_credit, "Wikimedia Commons");

  const again = await applyIdentifiedPerson({
    subject: "Morgan Hale",
    event_date: "2024-08-01",
    category: "resignations",
    cite_urls: CITES,
    photo: withNewPersonLock({}).photo,
    photo_credit: "Should not replace",
    mediaDir: LOCK_MEDIA_DIR,
  });
  assert.equal(again.action, "annotated");
  assert.equal(again.person.photo, stored.photo);
  assert.equal(again.person.photo_credit, "Wikimedia Commons");
});
