import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { categoryById, categoryByPath, PROMOTE_CATEGORY_IDS } from "../app/lib/categories.mjs";
import { rankDimension } from "../app/lib/dashboard.mjs";
import { listPathForPerson } from "../app/lib/display-check.mjs";
import { peopleList, personDetail } from "../app/lib/html.mjs";
import { mergeCites } from "../app/lib/promote.mjs";
import { personMenuDate } from "../app/lib/menu-date.mjs";
import {
  attachPersonEvent,
  eventSeq,
  eventsOfKind,
  isRepeatableKind,
  projectPerson,
} from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { personHeadcount } from "../app/lib/event-attrs.mjs";
import {
  appendPersonSources,
  counts,
  countPeople,
  getPerson,
  listPeople,
  loadFileStore,
  maxEventHeadcountByKind,
  savePerson,
  setMemory,
  syncPersonEvents,
  tagMembership,
  writeFileStore,
} from "../app/lib/store.mjs";

const AP = (slug, date) => ({
  url: `https://apnews.com/article/${slug}`,
  publisher: "AP",
  title: slug,
  date,
});
const TRUTH = {
  url: "https://truthsocial.com/@realDonaldTrump/posts/example-feb",
  publisher: "Truth Social",
  title: "Complete and total endorsement",
  date: "2026-02-12",
};
const XPOST = {
  url: "https://x.com/realDonaldTrump/status/1985000000000000001",
  publisher: "X",
  title: "Later endorsement",
  date: "2026-11-02",
};
const FEB = "Truth Social endorsement.";
const NOV = "X post endorsement.";

function firingOnly() {
  return projectPerson({
    id: "zero-endorse",
    name: "Zero Endorse",
    category: "firings",
    event_date: "2017-05-09",
    events: [
      {
        kind: "firings",
        event_date: "2017-05-09",
        comments: "Removed.",
        sources: [AP("fired", "2017-05-09")],
      },
    ],
  });
}

function oneEndorsement() {
  return projectPerson({
    id: "one-endorse",
    name: "One Endorse",
    category: "firings",
    event_date: "2017-05-09",
    tags: ["endorsements"],
    events: [
      {
        kind: "firings",
        event_date: "2017-05-09",
        comments: "Removed.",
        sources: [AP("fired", "2017-05-09")],
      },
      {
        kind: "endorsement",
        event_date: "2026-02-12",
        comments: FEB,
        sources: [TRUTH],
      },
    ],
  });
}

function withEndorsements(person, rows) {
  let next = person;
  for (const row of rows) next = attachPersonEvent(next, row).person;
  return next;
}

function severalEndorsements() {
  const prev = process.env.ET_MULTI_EVENT_WRITES;
  process.env.ET_MULTI_EVENT_WRITES = "on";
  try {
    return withEndorsements(firingOnly(), [
      { kind: "endorsement", event_date: "2026-02-12", comments: FEB, sources: [TRUTH] },
      { kind: "endorsement", event_date: "2026-11-02", comments: NOV, sources: [XPOST] },
    ]);
  } finally {
    if (prev === undefined) delete process.env.ET_MULTI_EVENT_WRITES;
    else process.env.ET_MULTI_EVENT_WRITES = prev;
  }
}

function endorsementSections(html) {
  return [
    ...html.matchAll(
      /<section class="detail-endorsement detail-supporting" data-kind="endorsement" data-section="person-event">([\s\S]*?)<\/section>/g,
    ),
  ].map((match) => match[0]);
}

function sourceGroups(html) {
  return [...html.matchAll(/<section class="source-group">([\s\S]*?)<\/section>/g)].map((match) => match[1]);
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader() {},
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      },
    };
    handle({ method: "GET", url: pathname, headers: { host: "127.0.0.1" } }, res).catch(reject);
  });
}

function fakeClient({ pkHasSeq = true } = {}) {
  const calls = [];
  const keyCols = pkHasSeq ? ["person_id", "kind", "seq"] : ["person_id", "kind"];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (/FROM pg_constraint c .*JOIN pg_attribute/.test(text)) {
        return { rows: keyCols.map((attname) => ({ attname })) };
      }
      if (/person_events_seq_notable_only/.test(text)) return { rows: [] };
      return { rows: [] };
    },
  };
}

async function withWrites(value, fn) {
  const prev = process.env.ET_MULTI_EVENT_WRITES;
  if (value === undefined) delete process.env.ET_MULTI_EVENT_WRITES;
  else process.env.ET_MULTI_EVENT_WRITES = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ET_MULTI_EVENT_WRITES;
    else process.env.ET_MULTI_EVENT_WRITES = prev;
  }
}

test("zero endorsements: no Endorsement entry, and the tag does not appear from nowhere", () => {
  const person = firingOnly();
  assert.equal(eventsOfKind(person.events, "endorsement").length, 0);
  assert.equal(person.tags.includes("endorsements"), false);
  assert.equal(personMenuDate(person, { tag: "endorsements" }), "");
  const html = personDetail(person);
  assert.equal(endorsementSections(html).length, 0);
  assert.doesNotMatch(html, /data-kind="endorsement"/);
  assert.equal(person.category, "firings");
  assert.equal(person.event_date, "2017-05-09");
});

test("one endorsement still renders as one entry and matches a seq 0 row", () => {
  const plain = oneEndorsement();
  const explicit = projectPerson({
    id: "one-endorse",
    name: "One Endorse",
    category: "firings",
    event_date: "2017-05-09",
    tags: ["endorsements"],
    events: [
      {
        kind: "firings",
        event_date: "2017-05-09",
        comments: "Removed.",
        sources: [AP("fired", "2017-05-09")],
      },
      {
        kind: "endorsement",
        seq: 0,
        event_date: "2026-02-12",
        comments: FEB,
        sources: [TRUTH],
      },
    ],
  });
  assert.equal(personDetail(plain), personDetail(explicit));
  assert.equal(eventsOfKind(plain.events, "endorsement")[0].seq, 0);
  assert.equal(plain.category, "firings");
  assert.equal(plain.event_date, "2017-05-09", "an endorsement does not replace the card date");
  assert.deepEqual(plain.tags.filter((id) => id === "endorsements"), ["endorsements"]);
  const html = personDetail(plain);
  const sections = endorsementSections(html);
  assert.equal(sections.length, 1);
  assert.match(sections[0], /datetime="2026-02-12"/);
  assert.match(sections[0], /Truth Social endorsement/);
  assert.match(sections[0], /href="#source-2"/);
  assert.match(html, /truthsocial\.com\/@realDonaldTrump\/posts\/example-feb/);
  assert.equal((html.match(/<h3 class="event-h">Endorsement<\/h3>/g) || []).length, 1);
  const groups = sourceGroups(html).filter((group) => group.includes("Endorsement"));
  assert.equal(groups.length, 1);
  assert.match(groups[0], /Feb 12, 2026 · Endorsement/);
  assert.equal(personMenuDate(plain, { tag: "endorsements" }), "2026-02-12");
});

test("several endorsements are separate dated entries, oldest first, each with its own cites", async () => {
  const prevWrites = process.env.ET_MULTI_EVENT_WRITES;
  process.env.ET_MULTI_EVENT_WRITES = "on";
  try {
  const person = { ...severalEndorsements(), id: "multi-endorse", name: "Multi Endorse", tags: ["endorsements"] };
  const endorsements = eventsOfKind(person.events, "endorsement");
  assert.deepEqual(endorsements.map((ev) => [ev.event_date, ev.seq]), [
    ["2026-11-02", 1],
    ["2026-02-12", 0],
  ]);
  assert.equal(person.category, "firings");
  assert.equal(person.event_date, "2017-05-09");
  assert.equal(personHeadcount(person), 1);
  assert.equal(maxEventHeadcountByKind(person.events).get("endorsement"), 1);
  assert.equal(maxEventHeadcountByKind(person.events).get("firings"), 1);
  assert.deepEqual(person.tags.filter((id) => id === "endorsements"), ["endorsements"]);
  assert.equal(personMenuDate(person, { tag: "endorsements" }), "2026-11-02");

  const html = personDetail(person);
  const sections = endorsementSections(html);
  assert.equal(sections.length, 2);
  assert.match(sections[0], /datetime="2026-02-12"/);
  assert.match(sections[0], /Truth Social endorsement/);
  assert.match(sections[0], /href="#source-2"/);
  assert.doesNotMatch(sections[0], /href="#source-3"/);
  assert.doesNotMatch(sections[0], /X post endorsement/);
  assert.match(sections[1], /datetime="2026-11-02"/);
  assert.match(sections[1], /X post endorsement/);
  assert.match(sections[1], /href="#source-3"/);
  assert.doesNotMatch(sections[1], /href="#source-2"/);
  assert.match(html, /truthsocial\.com\/@realDonaldTrump\/posts\/example-feb/);
  assert.match(html, /x\.com\/realDonaldTrump\/status\/1985000000000000001/);
  assert.ok(html.indexOf('data-kind="firings"') < html.indexOf(sections[0]));
  assert.ok(html.indexOf(sections[0]) < html.indexOf(sections[1]));
  const groups = sourceGroups(html);
  const feb = groups.filter((group) => group.includes("Feb 12, 2026 · Endorsement"));
  const nov = groups.filter((group) => group.includes("Nov 2, 2026 · Endorsement"));
  assert.equal(feb.length, 1);
  assert.equal(nov.length, 1);
  assert.match(feb[0], /truthsocial\.com/);
  assert.doesNotMatch(feb[0], /x\.com/);
  assert.match(nov[0], /x\.com\/realDonaldTrump/);
  assert.doesNotMatch(nov[0], /truthsocial\.com/);

  const again = attachPersonEvent(person, {
    kind: "endorsement",
    event_date: "2026-02-12",
    sources: [TRUTH, AP("feb-extra", "2026-02-12")],
  });
  assert.equal(again.existed, true, "the same date plus an overlapping cite folds");
  assert.equal(eventsOfKind(again.person.events, "endorsement").length, 2);
  assert.ok(eventsOfKind(again.person.events, "endorsement").find((ev) => ev.seq === 0).sources.some((source) => source.url.includes("feb-extra")));

  const sameDay = attachPersonEvent(person, {
    kind: "endorsement",
    event_date: "2026-02-12",
    comments: "A second post that same day.",
    sources: [AP("same-day", "2026-02-12")],
  });
  assert.equal(sameDay.existed, false);
  const same = eventsOfKind(sameDay.person.events, "endorsement").filter((ev) => ev.event_date === "2026-02-12");
  assert.deepEqual(same.map((ev) => ev.seq), [0, 2]);
  const sameHtml = personDetail(sameDay.person);
  const sameSections = endorsementSections(sameHtml);
  assert.match(sameSections[0], /Truth Social endorsement/);
  assert.match(sameSections[1], /A second post that same day/);
  assert.match(sameSections[2], /datetime="2026-11-02"/);
  const sameHeads = [...sameHtml.matchAll(/<h4 class="source-group-h">([^<]+)<\/h4>/g)].map((match) => match[1]);
  assert.deepEqual(
    sameHeads.filter((heading) => heading.includes("Endorsement")),
    ["Feb 12, 2026 · Endorsement", "Feb 12, 2026 · Endorsement (2)", "Nov 2, 2026 · Endorsement"],
  );

  setMemory({ people: [person] });
  await withWrites("on", async () => {
    await savePerson(person);
  });
  const loaded = await getPerson("multi-endorse");
  assert.deepEqual(eventsOfKind(loaded.events, "endorsement").map((ev) => ev.seq), [1, 0]);
  assert.equal(loaded.events.filter((ev) => ev.kind === "firings").length, 1);
  assert.equal("seq" in loaded.events.find((ev) => ev.kind === "firings"), false);

  await withWrites("on", async () => {
    const client = fakeClient();
    await syncPersonEvents(client, loaded);
    const inserts = client.calls.filter((call) => /INSERT INTO person_events/.test(call.text));
    const byKey = Object.fromEntries(inserts.map((call) => [`${call.params[1]}:${call.params[2]}`, call.params]));
    assert.deepEqual(Object.keys(byKey).sort(), ["endorsement:0", "endorsement:1", "firings:0"]);
    assert.equal(byKey["endorsement:0"][3], "2026-02-12");
    assert.match(byKey["endorsement:0"][4], /truthsocial\.com/);
    assert.equal(byKey["endorsement:0"][10], FEB);
    assert.equal(byKey["endorsement:1"][3], "2026-11-02");
    assert.match(byKey["endorsement:1"][4], /x\.com\/realDonaldTrump/);
    assert.equal(byKey["endorsement:1"][10], NOV);
    assert.doesNotMatch(byKey["endorsement:0"][4], /x\.com/);
    assert.doesNotMatch(byKey["endorsement:1"][4], /truthsocial/);
  });

  const extra = AP("nov-extra", "2026-11-02");
  const appended = await appendPersonSources("multi-endorse", [extra], "endorsement");
  const after = appended.person.events.filter((ev) => ev.kind === "endorsement");
  assert.equal(after.length, 2);
  assert.ok(after.find((ev) => ev.seq === 1).sources.some((source) => source.url === extra.url));
  assert.equal(after.find((ev) => ev.seq === 0).sources.some((source) => source.url === extra.url), false);
  } finally {
    if (prevWrites === undefined) delete process.env.ET_MULTI_EVENT_WRITES;
    else process.env.ET_MULTI_EVENT_WRITES = prevWrites;
  }
});

test("the endorsements tag and its list count people, not endorsement rows", async () => {
  const none = firingOnly();
  const taggedOnly = projectPerson({
    ...none,
    id: "tag-only",
    name: "Tag Only",
    tags: ["endorsements"],
  });
  const one = oneEndorsement();
  const several = {
    ...severalEndorsements(),
    id: "multi-endorse",
    name: "Multi Endorse",
    tags: ["endorsements"],
  };
  const untagged = { ...severalEndorsements(), id: "untagged-endorse", name: "Untagged Endorse", tags: [] };
  assert.equal(untagged.tags.includes("endorsements"), false, "the event kind does not imply the tag");
  setMemory({ people: [none, taggedOnly, one, several, untagged] });

  assert.equal(await countPeople({ tags: ["endorsements"] }), 3);
  const membership = await tagMembership();
  assert.equal(membership.counts.endorsements, 3);
  assert.equal(membership.members.endorsements.has("zero-endorse"), false);
  assert.equal(membership.members.endorsements.has("untagged-endorse"), false);
  assert.equal(membership.members.endorsements.has("multi-endorse"), true);

  const listed = await listPeople({ tags: ["endorsements"] });
  assert.deepEqual(listed.map((row) => row.id).sort(), ["multi-endorse", "one-endorse", "tag-only"]);
  assert.equal(personMenuDate(listed.find((row) => row.id === "multi-endorse"), { tag: "endorsements" }), "2026-11-02");
  assert.equal(personMenuDate(listed.find((row) => row.id === "one-endorse"), { tag: "endorsements" }), "2026-02-12");
  assert.equal(personMenuDate(listed.find((row) => row.id === "tag-only"), { tag: "endorsements" }), "");

  const page = await requestPage("/tags/endorsements");
  assert.equal(page.status, 200);
  assert.match(page.body, /stored endorsement from Donald Trump/);
  assert.equal((page.body.match(/href="\/people\/multi-endorse"/g) || []).length, 1);
  assert.equal((page.body.match(/href="\/people\/one-endorse"/g) || []).length, 1);
  assert.equal((page.body.match(/href="\/people\/tag-only"/g) || []).length, 1);
  assert.doesNotMatch(page.body, /href="\/people\/zero-endorse"/);
  assert.doesNotMatch(page.body, /href="\/people\/untagged-endorse"/);
  const multiCard = page.body.match(/<a class="tui-row person-card(?: is-selected)?" href="\/people\/multi-endorse">[\s\S]*?<\/a>/)?.[0] || "";
  assert.ok(multiCard);
  assert.match(multiCard, /datetime="2026-11-02"/);
  assert.doesNotMatch(multiCard, /2026-02-12/);
  assert.match(multiCard, /Firings/);
  const list = peopleList(listed, {
    listDate: (row) => personMenuDate(row, { tag: "endorsements" }),
  });
  assert.equal((list.match(/class="tui-title">Multi Endorse/g) || []).length, 1);
  assert.match(list, /datetime="2026-11-02"/);

  const detail = await requestPage("/people/multi-endorse");
  assert.equal(detail.status, 200);
  assert.equal(endorsementSections(detail.body).length, 2);
  const chips = detail.body.match(/<p class="person-tags">[\s\S]*?<\/p>/);
  assert.ok(chips);
  assert.equal((chips[0].match(/href="\/tags\/endorsements"/g) || []).length, 1);
  const absent = await requestPage("/people/zero-endorse");
  assert.equal(endorsementSections(absent.body).length, 0);
});

test("other event kinds stay as they are, and a switched-off save folds endorsements", async () => {
  assert.equal(isRepeatableKind("endorsement"), true);
  assert.equal(isRepeatableKind("firings"), false);
  assert.equal(isRepeatableKind("indictment_civilian"), false);
  assert.equal(isRepeatableKind("harassment_records"), false);
  assert.equal(isRepeatableKind("red_folder"), true);
  assert.equal(eventSeq({ kind: "endorsement", seq: 1 }), 1);
  assert.equal(eventSeq({ kind: "firings", seq: 4 }), 0);

  const base = firingOnly();
  const folded = attachPersonEvent(base, {
    kind: "firings",
    event_date: "2018-01-01",
    comments: "A later firing.",
    sources: [AP("fired-2", "2018-01-01")],
  });
  assert.equal(folded.existed, true);
  const firings = folded.person.events.filter((ev) => ev.kind === "firings");
  assert.equal(firings.length, 1);
  assert.equal(firings[0].event_date, "2017-05-09");
  assert.equal("seq" in firings[0], false);

  const indicted = attachPersonEvent(attachPersonEvent(base, {
    kind: "indictment_civilian",
    event_date: "2024-08-01",
    comments: "First indictment.",
    sources: [AP("indict-a", "2024-08-01")],
  }).person, {
    kind: "indictment_civilian",
    event_date: "2024-10-01",
    comments: "Second indictment.",
    sources: [AP("indict-b", "2024-10-01")],
  });
  assert.equal(indicted.existed, true);
  assert.equal(indicted.person.events.filter((ev) => ev.kind === "indictment_civilian").length, 1);
  assert.equal(indicted.person.events.find((ev) => ev.kind === "indictment_civilian").event_date, "2024-08-01");

  let red = attachPersonEvent(base, {
    kind: "red_folder",
    event_date: "2024-06-13",
    comments: "First folder.",
    sources: [AP("folder-a", "2024-06-13")],
  }).person;
  red = attachPersonEvent(red, {
    kind: "red_folder",
    event_date: "2025-12-17",
    comments: "Second folder.",
    sources: [AP("folder-b", "2025-12-17")],
  }).person;
  assert.deepEqual(eventsOfKind(red.events, "red_folder").map((ev) => [ev.event_date, ev.seq]), [
    ["2025-12-17", 1],
    ["2024-06-13", 0],
  ]);
  assert.equal(red.category, "firings");

  const two = severalEndorsements();
  await withWrites(undefined, async () => {
    const client = fakeClient();
    await syncPersonEvents(client, two);
    const writes = client.calls.filter((call) => /DELETE FROM person_events|INSERT INTO person_events/.test(call.text));
    assert.equal(writes.length > 0, true, "the folded save runs");
    const inserts = writes.filter((call) => /INSERT INTO person_events/.test(call.text));
    assert.deepEqual(inserts.map((call) => `${call.params[1]}:${call.params[2]}`).sort(), ["endorsement:0", "firings:0"]);
    const folded = inserts.find((call) => call.params[1] === "endorsement");
    assert.equal(folded.params[3], "2026-02-12", "the stored seq 0 date stays");
    assert.equal(folded.params[10], FEB, "the stored seq 0 comments stay");
    assert.match(folded.params[4], /truthsocial\.com/);
    assert.match(folded.params[4], /x\.com\/realDonaldTrump/);
    const example = attachPersonEvent(
      attachPersonEvent(firingOnly(), {
        kind: "endorsement",
        event_date: "2024-03-01",
        comments: "first",
        sources: [AP("first", "2024-03-01")],
      }).person,
      {
        kind: "endorsement",
        event_date: "2026-11-02",
        comments: "second",
        sources: [AP("second", "2026-11-02")],
      },
    ).person;
    const again = fakeClient();
    await syncPersonEvents(again, example);
    const kept = again.calls.find((call) => /INSERT INTO person_events/.test(call.text) && call.params[1] === "endorsement");
    assert.equal(kept.params[2], 0);
    assert.equal(kept.params[3], "2024-03-01");
    assert.equal(kept.params[10], "first");
    assert.match(kept.params[4], /first/);
    assert.match(kept.params[4], /second/);
    assert.doesNotMatch(kept.params[10], /second/);
  });
  const one = oneEndorsement();
  await withWrites(undefined, async () => {
    const client = fakeClient();
    await syncPersonEvents(client, one);
    const inserts = client.calls.filter((call) => /INSERT INTO person_events/.test(call.text));
    assert.deepEqual(inserts.map((call) => `${call.params[1]}:${call.params[2]}`).sort(), ["endorsement:0", "firings:0"]);
  });
});

test("a person with category endorsement renders and lists on /endorsement", async () => {
  const cat = categoryById("endorsement");
  assert.equal(cat.kind, "person");
  assert.equal(cat.title, "Endorsement");
  assert.equal(cat.nav, "Endorsement");
  assert.equal(cat.path, "/endorsement");
  assert.equal(categoryByPath("/endorsement").id, "endorsement");
  assert.equal(PROMOTE_CATEGORY_IDS.includes("endorsement"), true);
  assert.equal(listPathForPerson("endorsement"), "/endorsement");
  const person = projectPerson({
    id: "ada-endorse",
    name: "Ada Endorse",
    category: "endorsement",
    event_date: "2026-02-12",
    events: [
      {
        kind: "endorsement",
        event_date: "2026-02-12",
        comments: FEB,
        sources: [TRUTH],
      },
    ],
  });
  assert.equal(person.category, "endorsement");
  assert.equal(person.event_date, "2026-02-12");
  const detail = personDetail(person);
  assert.equal(endorsementSections(detail).length, 1);
  assert.match(detail, /Truth Social endorsement/);
  assert.doesNotMatch(detail, /class="event-tag-row"/);
  setMemory({ people: [person] });
  const listed = await listPeople("endorsement");
  assert.equal(listed.filter((row) => row.id === "ada-endorse").length, 1);
  assert.match(peopleList(listed), /Ada Endorse/);
  assert.match(peopleList(listed), /· Endorsement ·/);
  const page = await requestPage("/endorsement");
  assert.equal(page.status, 200);
  assert.equal((page.body.match(/href="\/people\/ada-endorse"/g) || []).length, 1);
  assert.match(page.body, /data-key="j"/);
  const card = await requestPage("/people/ada-endorse");
  assert.equal(card.status, 200);
  assert.match(card.body, /Truth Social endorsement/);
  const kept = projectPerson({
    id: "ada-firing",
    name: "Ada Firing",
    category: "firings",
    event_date: "2017-05-09",
    events: [
      { kind: "firings", event_date: "2017-05-09", comments: "Removed.", sources: [AP("fired", "2017-05-09")] },
      { kind: "endorsement", event_date: "2026-11-02", comments: NOV, sources: [XPOST] },
    ],
  });
  assert.equal(kept.category, "firings");
  assert.equal(kept.event_date, "2017-05-09");
});

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

test("flag-off attach keeps the stored endorsement byte for byte except merged cites", () => {
  const first = {
    kind: "endorsement",
    event_date: "2024-03-01",
    comments: "first",
    position: "Senator",
    organization: "Senate",
    sources: [AP("first", "2024-03-01")],
  };
  const base = projectPerson({
    id: "byte-fold",
    name: "Byte Fold",
    category: "firings",
    event_date: "2017-05-09",
    events: [
      { kind: "firings", event_date: "2017-05-09", comments: "Removed.", sources: [AP("fired", "2017-05-09")] },
      first,
    ],
  });
  const incoming = AP("second", "2026-11-02");
  const expected = projectPerson({
    ...base,
    events: base.events.map((ev) =>
      ev.kind === "endorsement" ? { ...ev, sources: mergeCites(ev.sources, [incoming]).sources } : ev,
    ),
  });
  const actual = attachPersonEvent(base, {
    kind: "endorsement",
    event_date: "2026-11-02",
    comments: "second",
    position: "Other",
    organization: "Other",
    sources: [incoming],
  });
  assert.equal(actual.existed, true);
  assert.equal(stableJson(actual.person.events), stableJson(expected.events));
  const ev = actual.person.events.find((row) => row.kind === "endorsement");
  assert.equal(ev.event_date, "2024-03-01");
  assert.equal(ev.comments, "first");
  assert.equal(ev.position, "Senator");
  assert.equal(ev.organization, "Senate");
});

test("a save after the switch turns off keeps the stored seq 0 endorsement", async () => {
  let built;
  await withWrites("on", async () => {
    built = attachPersonEvent(
      attachPersonEvent(firingOnly(), {
        kind: "endorsement",
        event_date: "2024-03-01",
        comments: "first",
        position: "Senator",
        sources: [AP("first", "2024-03-01")],
      }).person,
      {
        kind: "endorsement",
        event_date: "2026-11-02",
        comments: "second",
        sources: [AP("second", "2026-11-02")],
      },
    ).person;
    setMemory({ people: [built] });
    await savePerson(built);
    const on = await getPerson(built.id);
    assert.equal(on.events.filter((ev) => ev.kind === "endorsement").length, 2);
  });
  await withWrites(undefined, async () => {
    const current = await getPerson(built.id);
    await savePerson({ ...current, role: "Senator" });
    const off = await getPerson(built.id);
    const kept = off.events.filter((ev) => ev.kind === "endorsement");
    assert.equal(kept.length, 1);
    assert.equal(kept[0].event_date, "2024-03-01");
    assert.equal(kept[0].comments, "first");
    assert.equal(kept[0].position, "Senator");
    assert.equal(off.role, "Senator");
    assert.ok(kept[0].sources.some((source) => String(source.url).includes("/first")));
    assert.ok(kept[0].sources.some((source) => String(source.url).includes("/second")));

    const client = fakeClient();
    await syncPersonEvents(client, built);
    const row = client.calls.find((call) => /INSERT INTO person_events/.test(call.text) && call.params[1] === "endorsement");
    assert.equal(row.params[2], 0);
    assert.equal(row.params[3], "2024-03-01");
    assert.equal(row.params[10], "first");
    assert.match(row.params[4], /\/first/);
    assert.match(row.params[4], /\/second/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-fold-"));
    try {
      writeFileStore(dir, { people: [built] });
      const loaded = loadFileStore(dir);
      const fileEvents = loaded.people[0].events.filter((ev) => ev.kind === "endorsement");
      assert.equal(fileEvents.length, 1);
      assert.equal(fileEvents[0].event_date, "2024-03-01");
      assert.equal(fileEvents[0].comments, "first");
      assert.equal(fileEvents[0].position, "Senator");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("/endorsement and the dashboard count the card category, not every endorsement event", async () => {
  const card = projectPerson({
    id: "card-endorse",
    name: "Card Endorse",
    category: "endorsement",
    event_date: "2026-02-12",
    events: [{ kind: "endorsement", event_date: "2026-02-12", comments: FEB, sources: [TRUTH] }],
  });
  const extra = projectPerson({
    id: "extra-endorse",
    name: "Extra Endorse",
    category: "firings",
    event_date: "2017-05-09",
    events: [
      { kind: "firings", event_date: "2017-05-09", comments: "Removed.", sources: [AP("fired", "2017-05-09")] },
      { kind: "endorsement", event_date: "2026-11-02", comments: NOV, sources: [XPOST] },
    ],
  });
  setMemory({ people: [card, extra] });
  const listed = await listPeople("endorsement");
  assert.deepEqual(listed.map((row) => row.id), ["card-endorse"]);
  const page = await requestPage("/endorsement");
  assert.equal(page.status, 200);
  assert.match(page.body, /Card Endorse/);
  assert.doesNotMatch(page.body, /Extra Endorse/);
  const census = await counts();
  assert.equal(census.byCategory.endorsement, 1);
  const reason = rankDimension([card, extra], "reason");
  assert.equal(reason.find((row) => row.key === "endorsement")?.count, 1);
});

test("an endorsement escapes script text and does not link a javascript cite", () => {
  const row = projectPerson({
    id: "hostile-endorse",
    name: "Hostile Endorse",
    category: "firings",
    event_date: "2017-05-09",
    events: [
      {
        kind: "firings",
        event_date: "2017-05-09",
        comments: "Removed.",
        sources: [AP("fired", "2017-05-09")],
      },
      {
        kind: "endorsement",
        event_date: "2026-02-12",
        comments: "Endorsed <script>alert(1)</script>",
        sources: [
          {
            url: "javascript:alert(1)",
            publisher: "Desk",
            title: "bad",
            date: "2026-02-12",
          },
        ],
      },
    ],
  });
  const html = personDetail(row);
  assert.match(html, /Endorsed &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /javascript:alert\(1\)/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /href\s*=\s*["']?\s*javascript:/i);
  assert.equal((html.match(/<a\b[^>]*href="https:\/\/apnews\.com/g) || []).length > 0, true);
});
