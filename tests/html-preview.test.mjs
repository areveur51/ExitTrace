import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { formatDate } from "../app/lib/categories.mjs";
import { dogListRow, personRow, searchBody } from "../app/lib/html.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function celebrity(overrides = {}) {
  return {
    id: "mary-tyler-moore",
    category: "death_celebrity",
    name: "Mary Tyler Moore",
    role: "Actor",
    event_date: "2017-01-25",
    death_date: "2017-01-25",
    photo: "/media/people/mary-tyler-moore.jpg",
    net_worth_usd: null,
    ...overrides,
  };
}

function firing(overrides = {}) {
  return {
    id: "james-comey",
    category: "firings",
    name: "James Comey",
    role: "FBI Director",
    event_date: "2017-05-09",
    death_date: null,
    photo: "/media/people/james-comey.jpg",
    net_worth_usd: null,
    ...overrides,
  };
}

function dog(overrides = {}) {
  return {
    id: "dod-k9-2020",
    posted_at: "2020-03-13",
    handle: "@DeptofDefense",
    account_name: "Department of Defense",
    text: "Stored official dog-comm snapshot.",
    still: "/media/dog-comms/dod-k9-2020.jpg",
    ...overrides,
  };
}

test("dog list and search thumbs use the same portrait/thumb size markup as people", () => {
  const person = personRow(firing());
  const dogRow = dogListRow(dog());
  const search = searchBody(
    [
      { type: "person", row: firing() },
      { type: "dog", row: dog() },
    ],
    "Defense",
  );

  assert.match(person, /class="portrait thumb"/);
  assert.match(person, /width="48" height="64"/);
  assert.match(dogRow, /class="still thumb"/);
  assert.match(dogRow, /width="48" height="64"/);
  assert.match(search, /class="still thumb"/);
  assert.match(search, /class="portrait thumb"/);
  assert.equal((search.match(/width="48" height="64"/g) || []).length, 2);
});

test("CSS keeps list still.thumb at portrait size on all viewports including 720px", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  assert.match(css, /\.still:not\(\.thumb\)/);
  assert.match(css, /img\.still\.thumb/);
  assert.match(css, /width:\s*min\(100%,\s*320px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);

  const stillPreview = css.match(/\.still:not\(\.thumb\)\s*\{[^}]+\}/);
  assert.ok(stillPreview, "snapshot stills stay a large preview");
  assert.match(stillPreview[0], /320px/);

  const thumbRule = css.match(/img\.still\.thumb\s*\{[^}]+\}/);
  assert.ok(thumbRule, "list stills have an explicit thumb rule");
  assert.match(thumbRule[0], /width:\s*40px/);
  assert.match(thumbRule[0], /height:\s*52px/);
  assert.doesNotMatch(thumbRule[0], /320px/);

  const mobile = css.split("@media (max-width: 720px)")[1] || "";
  assert.match(mobile, /img\.still\.thumb/);
  assert.match(mobile, /width:\s*40px/);
  assert.match(mobile, /height:\s*52px/);
  assert.doesNotMatch(mobile, /\.still\s*\{[^}]*320px/);
});

test("death list and search previews print one death date and never 'died <date>'", () => {
  const same = personRow(celebrity(), { showDeath: true });
  const mismatch = personRow(
    celebrity({ event_date: "2017-01-24", death_date: "2017-01-25" }),
    { showDeath: true },
  );
  const search = searchBody([{ type: "person", row: celebrity() }], "Moore");

  const died = formatDate("2017-01-25");
  assert.match(same, new RegExp(`<time datetime="2017-01-25">${died}</time>`));
  assert.doesNotMatch(same, /died /);
  assert.equal(same.split(died).length - 1, 1);

  assert.match(mismatch, new RegExp(`<time datetime="2017-01-25">${died}</time>`));
  assert.doesNotMatch(mismatch, /2017-01-24/);
  assert.doesNotMatch(mismatch, /died /);

  assert.match(search, /Mary Tyler Moore/);
  assert.doesNotMatch(search, /died /);
  assert.equal(search.split(died).length - 1, 1);
  assert.match(search, /Celebrities/);
});

test("non-death list previews keep date · category and do not add a died suffix", () => {
  const row = personRow(firing(), { showDeath: false });
  const fired = formatDate("2017-05-09");
  assert.match(row, new RegExp(`<time datetime="2017-05-09">${fired}</time>`));
  assert.match(row, /Firings/);
  assert.doesNotMatch(row, /died /);
});

test("identified people use officials-style person-card markup", () => {
  const official = personRow(
    {
      id: "liu-xiaobo",
      category: "death_official",
      name: "Liu Xiaobo",
      event_date: "2017-07-13",
      death_date: "2017-07-13",
      photo: "/media/people/liu.jpg",
      net_worth_usd: null,
    },
    { showDeath: true },
  );
  const firingRow = personRow(firing());
  const died = formatDate("2017-07-13");
  const fired = formatDate("2017-05-09");

  for (const row of [official, firingRow]) {
    assert.match(row, /class="tui-row person-card"/);
    assert.match(row, /class="portrait thumb"/);
    assert.doesNotMatch(row, /source-card/);
    assert.doesNotMatch(row, /died /);
  }
  assert.match(official, new RegExp(`<div class="tui-title">Liu Xiaobo</div>`));
  assert.match(official, new RegExp(`<time datetime="2017-07-13">${died}</time> · Officials · —`));
  assert.match(firingRow, new RegExp(`<time datetime="2017-05-09">${fired}</time> · Firings · —`));
});

test("search keeps people cards and groups posted hits under Unsorted", () => {
  const html = searchBody(
    [
      { type: "person", row: firing() },
      {
        type: "source",
        row: {
          id: "sp-arrest",
          category: "arrests",
          poster_handle: "@example_desk",
          posted_at: "2024-03-01",
        },
      },
    ],
    "example",
  );
  assert.match(html, /class="tui-row person-card/);
  assert.match(html, /James Comey/);
  assert.match(html, /unsorted-group/);
  assert.match(html, /<h2 class="tui-group-h">Unsorted<\/h2>/);
  assert.match(html, /source-card/);
  assert.match(html, /posted · poster @example_desk/);
  assert.doesNotMatch(html, /<div class="tui-title">@example_desk/);
  const personIdx = html.indexOf("person-card");
  const groupIdx = html.indexOf("Unsorted");
  const sourceIdx = html.indexOf("source-card");
  assert.ok(personIdx < groupIdx && groupIdx < sourceIdx);
});
