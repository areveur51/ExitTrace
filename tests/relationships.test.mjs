/** Relationship lines. Fixtures only. Does not open Postgres. */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { personDetail, personRow } from "../app/lib/html.mjs";
import {
  RELATIONSHIP_LABELS,
  RelationshipError,
  prepareRelationship,
  relationshipView,
} from "../app/lib/relationships.mjs";

const FOX =
  "https://www.foxnews.com/politics/trump-asks-kimberly-guilfoyle-resign-greece-ambassador-white-house-confirms";
const CNN_FACTS = "https://www.cnn.com/politics/gavin-newsom-fast-facts";
const CNN_RESIGN = "https://www.cnn.com/2026/10/13/politics/kimberly-guilfoyle-resign";
const WIKI = "https://en.wikipedia.org/wiki/Gavin_Newsom";
const X_POST = "https://x.com/EricLDaugh/status/2110007117574787337";

const CNN = { publisher: "CNN", url: CNN_FACTS, date: "2026-10-05", title: "", snippet: "" };
const FOX_CITE = { publisher: "Fox News", url: FOX, date: "2026-10-13", title: "", snippet: "" };

function input(overrides = {}) {
  return {
    left_id: "kimberly-guilfoyle",
    left_name: "Kimberly Guilfoyle",
    left_calls_right: "Ex-husband",
    right_id: "gavin-newsom",
    right_name: "Gavin Newsom",
    right_calls_left: "Ex-wife",
    kind: "former_spouse",
    start_year: 2001,
    end_year: 2006,
    sources: [CNN, FOX_CITE],
    ...overrides,
  };
}

function throwsCode(overrides, code) {
  assert.throws(
    () => prepareRelationship(input(overrides)),
    (err) => err instanceof RelationshipError && err.code === code,
  );
}

function edge(overrides = {}) {
  return {
    ...prepareRelationship(input()),
    person_a_name: "Gavin Newsom",
    person_b_name: "Kimberly Guilfoyle",
    ...overrides,
  };
}

function guilfoyle(connection) {
  return {
    id: "kimberly-guilfoyle",
    name: "Kimberly Guilfoyle",
    category: "resignations",
    role: "U.S. Ambassador to Greece",
    event_date: "2026-10-13",
    photo: "",
    career: [
      {
        title: "Television host",
        organization: "Fox News",
        start_year: 2006,
        end_year: 2018,
      },
    ],
    events: [
      {
        kind: "resignations",
        event_date: "2026-10-13",
        position: "U.S. Ambassador to Greece",
        organization: "U.S. Department of State",
        comments: "The White House asked her to resign.",
        sources: [
          { publisher: "Fox News", url: FOX, date: "2026-10-13", title: "", snippet: "" },
          { publisher: "CNN", url: CNN_RESIGN, date: "2026-10-13", title: "", snippet: "" },
        ],
      },
    ],
    relationships: connection ? [connection] : [],
  };
}

function newsom(connection) {
  return {
    id: "gavin-newsom",
    name: "Gavin Newsom",
    category: "nickname",
    role: "Governor of California",
    event_date: null,
    photo: "",
    nicknames: [
      {
        name: "Newscum",
        by: "Donald Trump",
        list_exception: true,
        sources: [
          {
            publisher: "Wikipedia",
            url: "https://en.wikipedia.org/wiki/List_of_nicknames_used_by_Donald_Trump",
          },
        ],
      },
    ],
    events: [],
    relationships: connection ? [connection] : [],
  };
}

function sourceNumberFor(html, urlPart) {
  const re = /<li id="source-(\d+)"[^>]*>[\s\S]*?<\/li>/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].includes(urlPart)) return match[1];
  }
  return "";
}

function groupHtml(html, label) {
  const re = /<section class="source-group">([\s\S]*?)<\/section>/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[1].includes(`>${label}<`)) return match[1];
  }
  return "";
}

test("prepareRelationship sorts the pair and keeps each card's label", () => {
  const row = prepareRelationship(input());
  assert.equal(row.id, "gavin-newsom--kimberly-guilfoyle--former-spouse");
  assert.equal(row.person_a, "gavin-newsom");
  assert.equal(row.person_b, "kimberly-guilfoyle");
  assert.equal(row.a_calls_b, "Ex-wife");
  assert.equal(row.b_calls_a, "Ex-husband");
  assert.equal(row.start_year, 2001);
  assert.equal(row.end_year, 2006);
  assert.equal(row.sources.length, 2);
  assert.equal(relationshipView(row, "gavin-newsom"), null);
  const named = edge();
  assert.deepEqual(relationshipView(named, "kimberly-guilfoyle"), {
    otherId: "gavin-newsom",
    otherName: "Gavin Newsom",
    label: "Ex-husband",
    kind: "former_spouse",
    note: "",
    years: "2001–2006",
    sources: row.sources,
  });
  assert.equal(relationshipView(named, "gavin-newsom").label, "Ex-wife");
  assert.equal(relationshipView(named, "gavin-newsom").otherName, "Kimberly Guilfoyle");
});

test("a parent and child keep Son and Father on the sorted pair", () => {
  const senate =
    "https://www.grassley.senate.gov/download/fd-1023-obtained-by-senator-grassley_-biden";
  const cnn = "https://www.cnn.com/2023/07/20/politics/chuck-grassley-fbi-document";
  const row = prepareRelationship({
    left_id: "hunter-biden",
    left_name: "Hunter Biden",
    left_calls_right: "Father",
    right_id: "joe-biden",
    right_name: "Joe Biden",
    right_calls_left: "Son",
    kind: "parent_child",
    sources: [
      { publisher: "U.S. Senate", url: senate, date: "2020-06-30", title: "", snippet: "" },
      { publisher: "CNN", url: cnn, date: "2023-07-20", title: "", snippet: "" },
    ],
  });
  assert.equal(row.id, "hunter-biden--joe-biden--parent-child");
  assert.equal(row.person_a, "hunter-biden");
  assert.equal(row.person_b, "joe-biden");
  assert.equal(row.kind, "parent_child");
  assert.equal(row.a_calls_b, "Father");
  assert.equal(row.b_calls_a, "Son");
  assert.equal(row.start_year, null);
  assert.equal(row.end_year, null);
  const named = { ...row, person_a_name: "Hunter Biden", person_b_name: "Joe Biden" };
  assert.deepEqual(relationshipView(named, "hunter-biden"), {
    otherId: "joe-biden",
    otherName: "Joe Biden",
    label: "Father",
    kind: "parent_child",
    note: "",
    years: "",
    sources: row.sources,
  });
  assert.equal(relationshipView(named, "joe-biden").label, "Son");
  assert.equal(relationshipView(named, "joe-biden").otherName, "Hunter Biden");
});

test("a relationship cite must be two official news or government URLs", () => {
  throwsCode({ sources: [CNN] }, "relationship_cite_floor");
  throwsCode({ sources: [] }, "relationship_cite_floor");
  throwsCode({ sources: [CNN, { ...CNN }] }, "relationship_cite_floor");
  throwsCode({ sources: [{ publisher: "Wikipedia", url: WIKI, date: "2018-07-20" }] }, "relationship_cite");
  throwsCode({ sources: [CNN, FOX_CITE, { publisher: "Wikipedia", url: WIKI }] }, "relationship_cite");
  throwsCode({ sources: [CNN, FOX_CITE, { publisher: "Supporting post", url: X_POST }] }, "relationship_cite");
  throwsCode({ left_id: "gavin-newsom", left_name: "Gavin Newsom" }, "relationship_self");
  throwsCode({ end_year: 2000 }, "relationship_year_order");
  throwsCode({ start_year: 999 }, "relationship_year");
  throwsCode({ end_year: 2101 }, "relationship_year");
  throwsCode({ kind: "spouse" }, "relationship_kind");
  throwsCode({ left_calls_right: "Husband" }, "relationship_label");
  throwsCode({ left_name: "" }, "relationship_person");
  throwsCode({ right_id: "" }, "relationship_person");
  const bounds = prepareRelationship(input({ start_year: 1000, end_year: 2100 }));
  assert.equal(bounds.start_year, 1000);
  assert.equal(bounds.end_year, 2100);
});

test("both cards show the connection under the header and keep the event rail", () => {
  const connection = edge();
  const hers = personDetail(guilfoyle(connection));
  const his = personDetail(newsom(connection));
  const relAt = hers.indexOf('class="person-relationships"');
  const careerAt = hers.indexOf('class="career-history"');
  const railAt = hers.indexOf('class="event-timeline"');
  assert.ok(relAt >= 0 && relAt < careerAt && careerAt < railAt);
  assert.match(hers, /Ex-husband/);
  assert.match(hers, /href="\/people\/gavin-newsom"/);
  assert.match(hers, /2001–2006/);
  assert.match(
    hers,
    /<span class="relationship-who"><a href="\/people\/gavin-newsom">Gavin Newsom<\/a><span class="event-facts">2001–2006<\/span>/,
  );
  assert.match(hers, /Oct 13, 2026/);
  assert.match(hers, /Resignation/);
  assert.equal((hers.match(/<circle /g) || []).length, 1);
  assert.doesNotMatch(hers, /data-kind="former_spouse"/);
  const line = hers.match(/<p class="relationship-line">[\s\S]*?<\/p>/)[0];
  assert.doesNotMatch(line, /event-source-refs/);
  const foxN = sourceNumberFor(hers, "foxnews.com/politics/trump-asks");
  const factsN = sourceNumberFor(hers, "gavin-newsom-fast-facts");
  assert.ok(foxN && factsN && foxN !== factsN);
  assert.match(line, new RegExp(`href="#source-${foxN}"`));
  assert.match(line, new RegExp(`href="#source-${factsN}"`));
  const foxEntries = [...hers.matchAll(/<li id="source-\d+"[^>]*>[\s\S]*?<\/li>/g)].filter((item) =>
    item[0].includes("foxnews.com/politics/trump-asks"),
  );
  assert.equal(foxEntries.length, 1);
  const herGroup = groupHtml(hers, "Relationship · Gavin Newsom");
  assert.match(herGroup, /gavin-newsom-fast-facts/);
  assert.doesNotMatch(herGroup, /foxnews\.com/);
  assert.match(his, /Ex-wife/);
  assert.match(his, /href="\/people\/kimberly-guilfoyle"/);
  assert.match(his, /2001–2006/);
  assert.match(his, /Newscum/);
  assert.ok(his.indexOf('class="person-relationships"') < his.indexOf('class="event-timeline"'));
  assert.equal((his.indexOf("<circle ") >= 0 ? his.match(/<circle /g).length : 0), 1);
  assert.doesNotMatch(his, /data-kind="former_spouse"/);
  const hisGroup = groupHtml(his, "Relationship · Kimberly Guilfoyle");
  assert.match(hisGroup, /gavin-newsom-fast-facts/);
  assert.match(hisGroup, /foxnews\.com\/politics\/trump-asks/);
  assert.ok(his.indexOf(">Trump nickname<") < his.indexOf(hisGroup));
});

test("a list card and a missing other person omit the connection", () => {
  const connection = edge();
  const card = personRow(guilfoyle(connection));
  assert.doesNotMatch(card, /Ex-husband|Ex-wife|person-relationships|relationship-line/);
  const missing = personDetail(guilfoyle(edge({ person_a_name: "" })));
  assert.doesNotMatch(missing, /person-relationships|Ex-husband|relationship-line/);
  assert.match(missing, /Oct 13, 2026/);
  assert.match(missing, /class="event-timeline"/);
  assert.equal(relationshipView(edge({ person_b_name: "" }), "gavin-newsom"), null);
  assert.equal(relationshipView(connection, "someone-else"), null);
});

const DEADLINE = "https://deadline.com/2026/10/kevin-bleyer-dead-1237206488/";
const WRAP = "https://www.thewrap.com/media-platforms/tv/kevin-bleyer-dead/";
const WROTE =
  "Wrote speeches for him, including his addresses to the White House Correspondents' Dinner.";
const FOR_HIM =
  "Speechwriter for him, including his addresses to the White House Correspondents' Dinner.";

function professionalEdge() {
  return {
    ...prepareRelationship({
      left_id: "barack-obama",
      left_name: "Barack Obama",
      left_calls_right: "Speechwriter",
      left_note: WROTE,
      right_id: "kevin-bleyer",
      right_name: "Kevin Bleyer",
      right_calls_left: "Principal",
      right_note: FOR_HIM,
      kind: "professional",
      sources: [
        { publisher: "Deadline", url: DEADLINE, date: "2026-10-27", title: "", snippet: "" },
        { publisher: "The Wrap", url: WRAP, date: "2026-10-27", title: "", snippet: "" },
      ],
    }),
    person_a_name: "Barack Obama",
    person_b_name: "Kevin Bleyer",
  };
}

function obama(rows) {
  return {
    id: "barack-obama",
    name: "Barack Obama",
    category: "government_stepdowns",
    role: "44th President of the United States",
    event_date: "2017-01-20",
    photo: "/media/people/barack-obama.jpg",
    events: [
      {
        kind: "government_stepdowns",
        event_date: "2017-01-20",
        position: "44th President of the United States",
        organization: "Executive Office of the President",
        comments: "Left office.",
        sources: [
          { publisher: "The White House", url: "https://www.whitehouse.gov/about-the-white-house/presidents/barack-obama/", date: "2017-01-20", title: "", snippet: "" },
          { publisher: "CNN", url: CNN_FACTS, date: "2017-01-20", title: "", snippet: "" },
        ],
      },
    ],
    relationships: rows,
  };
}

function bleyer(connection) {
  return {
    id: "kevin-bleyer",
    name: "Kevin Bleyer",
    category: "death_celebrity",
    role: "Television writer",
    event_date: "2026-10-25",
    death_date: "2026-10-25",
    photo: "",
    events: [
      {
        kind: "death_celebrity",
        event_date: "2026-10-25",
        position: "Television writer",
        organization: "The Daily Show",
        comments: "Died October 25.",
        sources: [
          { publisher: "Deadline", url: DEADLINE, date: "2026-10-27", title: "", snippet: "" },
        ],
      },
    ],
    relationships: connection ? [connection] : [],
  };
}

test("a professional line flips Speechwriter and Principal and leaves the years blank", () => {
  const row = professionalEdge();
  assert.equal(row.id, "barack-obama--kevin-bleyer--professional");
  assert.equal(row.person_a, "barack-obama");
  assert.equal(row.person_b, "kevin-bleyer");
  assert.equal(row.a_calls_b, "Speechwriter");
  assert.equal(row.b_calls_a, "Principal");
  assert.equal(row.a_note, WROTE);
  assert.equal(row.b_note, FOR_HIM);
  assert.equal(row.start_year, null);
  assert.equal(row.end_year, null);
  const obamaLine = relationshipView(row, "barack-obama");
  const bleyerLine = relationshipView(row, "kevin-bleyer");
  assert.equal(obamaLine.label, "Speechwriter");
  assert.equal(obamaLine.note, WROTE);
  assert.equal(obamaLine.kind, "professional");
  assert.equal(obamaLine.years, "");
  assert.equal(bleyerLine.label, "Principal");
  assert.equal(bleyerLine.note, FOR_HIM);
  assert.equal(bleyerLine.years, "");
  const capped = prepareRelationship(input({ left_note: "x".repeat(240) }));
  assert.equal(capped.b_note.length, 240);
  throwsCode({ left_note: "x".repeat(241) }, "relationship_note");
  throwsCode({ left_note: "Confirmed today." }, "relationship_note");
});

test("Family sits above Professional, and a death card keeps one rail circle", () => {
  const connection = professionalEdge();
  const family = {
    ...prepareRelationship({
      left_id: "ada-example",
      left_name: "Ada Example",
      left_calls_right: "Father",
      right_id: "barack-obama",
      right_name: "Barack Obama",
      right_calls_left: "Son",
      kind: "parent_child",
      sources: [CNN, FOX_CITE],
    }),
    person_a_name: "Ada Example",
    person_b_name: "Barack Obama",
  };
  const both = personDetail(obama([family, connection]));
  assert.equal((both.match(/<h3 class="career-h">Relationships<\/h3>/g) || []).length, 1);
  assert.equal((both.match(/class="relationship-row"/g) || []).length, 2);
  assert.match(both, /<p class="event-oneline">Wrote speeches for him/);
  const familyAt = both.indexOf(">Family<");
  const professionalAt = both.indexOf(">Professional<");
  const adaAt = both.indexOf("/people/ada-example");
  const kevinAt = both.indexOf("/people/kevin-bleyer");
  assert.ok(familyAt >= 0 && familyAt < adaAt && adaAt < professionalAt && professionalAt < kevinAt);
  assert.match(both, /<h3 class="event-h">Son<\/h3>/);
  assert.match(both, /<h3 class="event-h">Speechwriter<\/h3>/);
  assert.match(both, /Wrote speeches for him/);
  assert.doesNotMatch(both, /data-kind="professional"|data-kind="parent_child"/);

  const his = personDetail(obama([connection]));
  assert.match(his, /<h3 class="event-h">Speechwriter<\/h3>/);
  assert.match(his, /href="\/people\/kevin-bleyer"/);
  assert.match(his, /Wrote speeches for him, including his addresses to the White House Correspondents' Dinner\./);
  assert.doesNotMatch(his, /Speechwriter for him/);
  const relAt = his.indexOf('class="person-relationships"');
  assert.ok(relAt >= 0 && relAt < his.indexOf('class="event-timeline"'));

  const hers = personDetail(bleyer(connection));
  assert.match(hers, /<h3 class="event-h">Principal<\/h3>/);
  assert.match(hers, /href="\/people\/barack-obama"/);
  assert.match(hers, /Speechwriter for him, including his addresses to the White House Correspondents' Dinner\./);
  assert.doesNotMatch(hers, /Wrote speeches for him/);
  const railAt = hers.indexOf('class="event-timeline"');
  const circleAt = hers.indexOf("<circle ");
  assert.ok(hers.indexOf('class="person-relationships"') < railAt && circleAt > railAt);
  assert.equal((hers.match(/<circle /g) || []).length, 1);
  const line = hers.match(/<p class="relationship-line">[\s\S]*?<\/p>/)[0];
  const deadlineN = sourceNumberFor(hers, "deadline.com/2026/10/kevin-bleyer");
  const wrapN = sourceNumberFor(hers, "thewrap.com/media-platforms/tv/kevin-bleyer");
  assert.ok(deadlineN && wrapN && deadlineN !== wrapN);
  assert.match(line, new RegExp(`href="#source-${deadlineN}"`));
  assert.match(line, new RegExp(`href="#source-${wrapN}"`));
  assert.doesNotMatch(line, /event-source-refs/);
  const relGroup = groupHtml(hers, "Relationship · Barack Obama");
  assert.match(relGroup, /thewrap.com/);
  assert.doesNotMatch(relGroup, /deadline.com/);
  const deadlineEntries = [...hers.matchAll(/<li id="source-\d+"[^>]*>[\s\S]*?<\/li>/g)].filter((item) =>
    item[0].includes("deadline.com/2026/10/kevin-bleyer"),
  );
  assert.equal(deadlineEntries.length, 1);
});

test("Personal chef is a closed professional label and flips to Principal", () => {
  const row = prepareRelationship({
    left_id: "barack-obama",
    left_name: "Barack Obama",
    left_calls_right: "Personal chef",
    left_note: "Personal chef to the family after serving as a White House sous chef.",
    right_id: "tafari-campbell",
    right_name: "Tafari Campbell",
    right_calls_left: "Principal",
    right_note: "Personal chef to him after serving as a White House sous chef.",
    kind: "professional",
    sources: [CNN, FOX_CITE],
  });
  assert.equal(row.a_calls_b, "Personal chef");
  assert.equal(row.b_calls_a, "Principal");
  assert.equal(row.start_year, null);
  assert.throws(
    () =>
      prepareRelationship({
        left_id: "barack-obama",
        left_name: "Barack Obama",
        left_calls_right: "Cook",
        right_id: "tafari-campbell",
        right_name: "Tafari Campbell",
        right_calls_left: "Principal",
        kind: "professional",
        sources: [CNN, FOX_CITE],
      }),
    (err) => err instanceof RelationshipError && err.code === "relationship_label",
  );
});

test("person_relationships stays out of the lab publication SQL", () => {
  const sql = fs.readFileSync(new URL("../scripts/bootstrap-db.sql", import.meta.url), "utf8");
  const at = sql.indexOf("person_relationships is excluded from exittrace_lab_pub");
  assert.ok(at > 0);
  const tail = sql.slice(at);
  assert.match(tail, /CREATE TABLE IF NOT EXISTS person_relationships/);
  assert.match(tail, /parent_child/);
  assert.match(tail, /'Son'/);
  assert.match(tail, /'Father'/);
  assert.match(tail, /'Personal chef'/);
  for (const label of ["Half-sister", "Half-brother", "Judge", "Litigant", "Cousin", "Daughter", "Mother", "Sister"]) {
    assert.ok(RELATIONSHIP_LABELS.includes(label), label);
    assert.match(tail, new RegExp(`'${label}'`));
  }
  assert.doesNotMatch(tail, /ALTER PUBLICATION/i);
  assert.doesNotMatch(sql, /ADD TABLE person_relationships/i);
});
