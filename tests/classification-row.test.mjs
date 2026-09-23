import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { peopleList, personRow, searchBody } from "../app/lib/html.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function person(overrides = {}) {
  return {
    id: "jordan-hale",
    category: "firings",
    name: "Jordan Hale",
    role: "Director",
    event_date: "2018-04-02",
    death_date: null,
    photo: "/media/people/jordan-hale.jpg",
    net_worth_usd: null,
    ...overrides,
  };
}

/** Drop slot contents and row-specific text so portrait and bare rows share one skeleton. */
function skeleton(html) {
  return html
    .replace(/<div class="row-media">[\s\S]*?<\/div>/, '<div class="row-media"></div>')
    .replace(/ is-selected/g, "")
    .replace(/href="[^"]*"/g, 'href=""')
    .replace(/<div class="tui-title">[\s\S]*?<\/div>/, '<div class="tui-title"></div>')
    .replace(/<div class="tui-meta">[\s\S]*?<\/div>/, '<div class="tui-meta"></div>');
}

function slotInner(html) {
  const match = html.match(/<div class="row-media">([\s\S]*?)<\/div>\s*<div class="tui-row-text">/);
  assert.ok(match, "leading media slot precedes the name/meta column");
  return match[1];
}

test("classification rows keep one leading media slot with and without a portrait", () => {
  const withPortrait = personRow(person());
  const bare = personRow(person({ photo: "" }));

  assert.equal(skeleton(withPortrait), skeleton(bare));
  assert.equal((withPortrait.match(/class="row-media"/g) || []).length, 1);
  assert.equal((bare.match(/class="row-media"/g) || []).length, 1);

  const portraitSlot = slotInner(withPortrait);
  const bareSlot = slotInner(bare);
  assert.match(portraitSlot, /<img class="portrait thumb"/);
  assert.match(portraitSlot, /width="40" height="52"/);
  assert.match(portraitSlot, /src="\/media\/thumbs\/people\/jordan-hale\.jpg\?p=3"/);
  assert.doesNotMatch(portraitSlot, /src="\/empty-portrait\.jpg/);
  assert.match(bareSlot, /class="portrait thumb empty-portrait"/);
  assert.match(bareSlot, /src="\/empty-portrait\.jpg/);
  assert.match(bareSlot, /width="40" height="52"/);
  assert.doesNotMatch(bareSlot, /class="initials thumb"/);
  assert.doesNotMatch(bare, /row-media-spacer/);

  const external = personRow(person({ photo: "https://upload.wikimedia.org/wikipedia/commons/x.jpg" }));
  assert.equal(skeleton(external), skeleton(bare));
  assert.match(slotInner(external), /src="\/empty-portrait\.jpg/);
  assert.doesNotMatch(external, /upload\.wikimedia\.org/);

  const emptyThumb = personRow(person({ photo: null, name: "" }));
  assert.match(slotInner(emptyThumb), /src="\/empty-portrait\.jpg/);
  assert.match(emptyThumb, /<div class="row-media">[\s\S]*<\/div>\s*<div class="tui-row-text">/);
});

test("category lists, dashboard slices, and search share that row", () => {
  const rows = [
    person({ id: "with-still", name: "With Still", photo: "/media/people/with-still.jpg" }),
    person({ id: "no-still", name: "No Still", photo: "" }),
  ];
  const list = peopleList(rows);
  const search = searchBody(
    rows.map((row) => ({ type: "person", row })),
    "Still",
  );

  for (const html of [list, search]) {
    const cards = html.match(/<a class="tui-row person-card[\s\S]*?<\/a>/g) || [];
    assert.equal(cards.length, 2);
    const inners = cards.map(slotInner);
    assert.equal(inners.filter((inner) => /src="\/media\/thumbs\//.test(inner)).length, 1);
    assert.equal(inners.filter((inner) => /src="\/empty-portrait\.jpg/.test(inner)).length, 1);
    assert.equal(inners.filter((inner) => /class="initials thumb"/.test(inner)).length, 0);
    assert.equal(new Set(cards.map(skeleton)).size, 1);
  }
});

test("classification row CSS reserves a fixed portrait column for every row", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  const rule = css.match(/\.tui-row\.person-card\s*\{([^}]+)\}/);
  assert.ok(rule, "person-card grid rule");
  assert.match(rule[1], /display:\s*grid/);
  assert.match(rule[1], /grid-template-columns:\s*40px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.tui-row\.person-card > \.row-media\s*\{[^}]*width:\s*40px/);
  assert.match(css, /\.tui-row\.person-card > \.row-media\s*\{[^}]*height:\s*52px/);
  assert.match(css, /\.row-media-spacer/);
  assert.doesNotMatch(css, /\.person-card:has\(/);
  assert.doesNotMatch(css, /\.tui-row:has\(img\)/);
});
