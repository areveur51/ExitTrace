import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "url";
import path from "path";
import {
  collapseDuplicatePeople,
  findGoldMatch,
  personEvents,
  PromoteError,
  shouldMergePeople,
} from "../app/lib/promote.mjs";
import { personDetail, personRow } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
  countPeople,
  getPerson,
  listPeople,
  loadSeedFile,
  mergeGoldPeople,
  setMemory,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];
const MORE = [
  "https://www.example.com/news/casey-vale-quit",
  "https://www.example.net/world/casey-vale-resigned",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
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

test("seed people lift into one event each and stay unique", () => {
  const seed = goldSeed();
  assert.equal(seed.people.length, 72);
  const ids = new Set(seed.people.map((r) => r.id));
  assert.equal(ids.size, 72);
  for (const row of seed.people) {
    const events = personEvents(row);
    assert.equal(events.length, 1, row.id);
    assert.equal(events[0].kind, row.category);
    assert.equal(events[0].event_date, row.event_date);
    assert.ok(events[0].sources.length >= 2, row.id);
  }
});

test("new KEEP kind annotates the existing person — no second row", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
    role: "Public official",
  });
  assert.equal(created.action, "created");
  assert.equal(await countPeople(), 73);

  const tagged = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-07-01",
    category: "resignations",
    cite_urls: MORE,
  });
  assert.equal(tagged.action, "annotated");
  assert.equal(tagged.added_event, true);
  assert.equal(tagged.person.id, "casey-vale");
  assert.equal(await countPeople(), 73);

  const person = await getPerson("casey-vale");
  assert.equal(person.name, "Casey Vale");
  assert.equal(person.events.length, 2);
  assert.ok(person.events.some((ev) => ev.kind === "arrests" && ev.event_date === "2024-06-15"));
  assert.ok(person.events.some((ev) => ev.kind === "resignations" && ev.event_date === "2024-07-01"));
  assert.equal((await listPeople()).filter((r) => /casey vale/i.test(r.name)).length, 1);
});

test("list pages filter by tag; parent unions stay unions", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  });
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: MORE,
  });
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-09-10",
    category: "death_official",
    cite_urls: [
      "https://www.example.com/news/casey-vale-died",
      "https://www.example.net/world/casey-vale-obit",
    ],
  });

  const arrests = await listPeople("arrests");
  const indictments = await listPeople("indictment_civilian");
  const deaths = await listPeople(["death_celebrity", "death_official", "death_ceo"]);
  assert.ok(arrests.some((r) => r.id === "casey-vale" && r.category === "arrests"));
  assert.ok(indictments.some((r) => r.id === "casey-vale" && r.category === "indictment_civilian"));
  assert.ok(deaths.some((r) => r.id === "casey-vale" && r.category === "death_official"));
  assert.equal(arrests.filter((r) => r.id === "casey-vale").length, 1);
  assert.ok(!indictments.some((r) => r.id === "casey-vale" && r.category === "arrests"));

  const arrestPage = await requestPage("/arrests");
  const indictmentPage = await requestPage("/indictments/civilians");
  const indictmentIndex = await requestPage("/indictments");
  const deathOfficials = await requestPage("/deaths/officials");
  const deathIndex = await requestPage("/deaths");
  const celebs = await requestPage("/deaths/celebrities");
  for (const res of [arrestPage, indictmentPage, indictmentIndex, deathOfficials, deathIndex]) {
    assert.equal(res.status, 200);
    assert.match(res.body, /href="\/people\/casey-vale"/);
    assert.match(res.body, /Casey Vale/);
  }
  assert.doesNotMatch(celebs.body, /href="\/people\/casey-vale"/);
  assert.match(arrestPage.body, / · Arrests · /);
  assert.match(indictmentPage.body, / · Civilians · /);
});

test("each new event is fail-closed; gold event fields stay put", async () => {
  setMemory(goldSeed());
  const comey = await getPerson("james-comey");
  const before = {
    name: comey.name,
    event_date: comey.event_date,
    category: comey.category,
    photo: comey.photo,
    sources: comey.sources,
    net_worth_usd: comey.net_worth_usd,
    net_worth_note: comey.net_worth_note,
  };

  await assert.rejects(
    () =>
      applyIdentifiedPerson({
        subject: "James Comey",
        event_date: "2017-06-01",
        category: "resignations",
        cite_urls: ["https://www.example.com/news/only-one"],
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
  await assert.rejects(
    () =>
      applyIdentifiedPerson({
        subject: "James Comey",
        event_date: "2017-06-01T12:00:00Z",
        category: "resignations",
        cite_urls: CITES,
      }),
    (err) => err instanceof PromoteError && err.code === "missing_event_date",
  );
  await assert.rejects(
    () =>
      applyIdentifiedPerson({
        subject: "James Comey",
        event_date: "2017-06-01",
        category: "resignations",
        cite_urls: [
          "https://en.wikipedia.org/wiki/James_Comey",
          "https://www.example.com/news/comey-quit",
        ],
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );

  const afterFail = await getPerson("james-comey");
  assert.equal(afterFail.events.length, 1);
  assert.equal(afterFail.name, before.name);
  assert.equal(afterFail.event_date, before.event_date);
  assert.deepEqual(afterFail.sources, before.sources);
  assert.equal(await countPeople(), 72);

  const tagged = await applyIdentifiedPerson({
    subject: "James Comey",
    event_date: "2017-06-01",
    category: "resignations",
    cite_urls: CITES,
    photo: "/media/people/imposter.jpg",
    net_worth_usd: "1",
    net_worth_source: "https://www.forbes.com/profile/should-not-win/",
  });
  assert.equal(tagged.action, "annotated");
  assert.equal(await countPeople(), 72);
  const after = await getPerson("james-comey");
  assert.equal(after.name, "James Comey");
  assert.equal(after.photo, before.photo);
  assert.equal(after.net_worth_usd, before.net_worth_usd);
  assert.equal(after.net_worth_note, before.net_worth_note);
  const firing = after.events.find((ev) => ev.kind === "firings");
  assert.equal(firing.event_date, before.event_date);
  assert.deepEqual(firing.sources.slice(0, before.sources.length), before.sources);
  const resignation = after.events.find((ev) => ev.kind === "resignations");
  assert.equal(resignation.event_date, "2017-06-01");
  assert.equal(resignation.sources.length, 2);
});

test("second firing on the same person annotates; does not add a second firing event", async () => {
  setMemory(goldSeed());
  const extra = "https://www.example.com/n/comey-extra";
  const result = await applyIdentifiedPerson({
    subject: "James Comey",
    event_date: "2017-05-20",
    category: "firings",
    cite_urls: ["https://www.nytimes.com/2017/05/09/us/politics/james-comey-fired.html", extra],
  });
  assert.equal(result.action, "annotated");
  const after = await getPerson("james-comey");
  assert.equal(after.events.filter((ev) => ev.kind === "firings").length, 1);
  assert.equal(after.events.find((ev) => ev.kind === "firings").event_date, "2017-05-09");
  assert.ok(after.sources.some((s) => s.url === extra));
  assert.equal(await countPeople(), 72);
});

test("detail page lists every tagged event with its cites", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  });
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: MORE,
  });
  const person = await getPerson("casey-vale");
  const html = personDetail(person);
  assert.match(html, /Casey Vale/);
  assert.match(html, /Arrests/);
  assert.match(html, /Indictments — civilians/);
  assert.match(html, /datetime="2024-06-15"/);
  assert.match(html, /datetime="2024-08-01"/);
  assert.match(html, /casey-vale-held/);
  assert.match(html, /casey-vale-quit/);
  const card = personRow(person, {});
  assert.match(card, /href="\/people\/casey-vale"/);
  assert.doesNotMatch(card, /person-card[\s\S]*person-card/);

  const page = await requestPage("/people/casey-vale");
  assert.equal(page.status, 200);
  assert.match(page.body, /Arrests/);
  assert.match(page.body, /Indictments — civilians/);
});

test("migration collapses same-slug rows and keeps distinct same-name people apart", () => {
  const live = [
    {
      id: "casey-vale",
      name: "Casey Vale",
      role: "Public official",
      category: "arrests",
      event_date: "2024-06-15",
      sources: [{ url: CITES[0] }, { url: CITES[1] }],
    },
    {
      id: "casey-vale-2024-08-01",
      name: "Casey Vale",
      role: "Public official",
      category: "indictment_civilian",
      event_date: "2024-08-01",
      sources: [{ url: MORE[0] }, { url: MORE[1] }],
    },
    {
      id: "jordan-hale",
      name: "Jordan Hale",
      role: "FBI Director",
      category: "firings",
      event_date: "2018-01-01",
      sources: [{ url: CITES[0] }, { url: CITES[1] }],
    },
    {
      id: "jordan-hale-2020-01-01",
      name: "Jordan Hale",
      role: "CEO, Hale Logistics",
      category: "death_ceo",
      event_date: "2020-01-01",
      sources: [{ url: MORE[0] }, { url: MORE[1] }],
    },
  ];
  assert.equal(shouldMergePeople(live[0], live[1]), true);
  assert.equal(shouldMergePeople(live[2], live[3]), false);

  const collapsed = collapseDuplicatePeople(live);
  assert.equal(collapsed.length, 3);
  const vale = collapsed.find((r) => r.id === "casey-vale");
  assert.equal(vale.events.length, 2);
  assert.ok(vale.events.some((ev) => ev.kind === "arrests" && ev.event_date === "2024-06-15"));
  assert.ok(vale.events.some((ev) => ev.kind === "indictment_civilian" && ev.event_date === "2024-08-01"));
  assert.ok(vale.sources.some((s) => s.url === CITES[0]));
  assert.ok(vale.sources.some((s) => s.url === MORE[0]));
  assert.equal(collapsed.filter((r) => /jordan hale/i.test(r.name)).length, 2);

  const gold = goldSeed().people;
  const merged = mergeGoldPeople(gold, [...gold, ...live]);
  assert.ok(merged.some((r) => r.id === "casey-vale" && r.events.length >= 2));
  assert.equal(merged.filter((r) => r.id === "casey-vale").length, 1);
  assert.ok(!merged.some((r) => r.id === "casey-vale-2024-08-01"));
});

test("do not double-tag the same indictment as civilian and non-civilian", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
  });
  const again = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-10-01",
    category: "indictment_non_civilian",
    cite_urls: MORE,
  });
  assert.equal(again.action, "annotated");
  assert.equal(await countPeople(), 73);
  const person = await getPerson("casey-vale");
  const indictments = person.events.filter((ev) => ev.kind.startsWith("indictment_"));
  assert.equal(indictments.length, 1);
  assert.equal(indictments[0].kind, "indictment_civilian");
  assert.equal(indictments[0].event_date, "2024-08-01");
  assert.ok(indictments[0].sources.some((s) => s.url === MORE[0]));
});

test("corona_comms skip-as-dup: tag lands on the existing card, never a second card", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  });
  assert.equal(created.action, "created");
  assert.equal(await countPeople(), 73);

  const tagged = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-07-20",
    category: "corona_comms",
    cite_urls: MORE,
  });
  assert.equal(tagged.action, "annotated");
  assert.equal(tagged.added_event, true);
  assert.equal(tagged.person.id, "casey-vale");
  assert.equal(await countPeople(), 73);

  const again = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "corona_comms",
    cite_urls: [
      "https://www.example.com/news/casey-vale-corona-extra",
      "https://www.example.net/world/casey-vale-corona-note",
    ],
  });
  assert.equal(again.action, "annotated");
  assert.equal(again.added_event, false);
  assert.equal(await countPeople(), 73);

  const person = await getPerson("casey-vale");
  assert.equal(person.events.filter((ev) => ev.kind === "corona_comms").length, 1);
  const corona = person.events.find((ev) => ev.kind === "corona_comms");
  assert.equal(corona.event_date, "2024-07-20");
  assert.ok(corona.sources.length >= 2);
  assert.ok(person.events.some((ev) => ev.kind === "arrests" && ev.event_date === "2024-06-15"));
  assert.equal((await listPeople()).filter((r) => /casey vale/i.test(r.name)).length, 1);
  assert.equal((await listPeople("corona_comms")).filter((r) => r.id === "casey-vale").length, 1);
  assert.equal((await listPeople("arrests")).filter((r) => r.id === "casey-vale").length, 1);

  const list = await requestPage("/corona-comms");
  assert.equal(list.status, 200);
  assert.match(list.body, /href="\/people\/casey-vale"/);
  assert.match(list.body, /Casey Vale/);
  assert.match(list.body, / · Corona · /);
  assert.equal((list.body.match(/href="\/people\/casey-vale"/g) || []).length, 1);
  assert.doesNotMatch(list.body, /source-card/);
  assert.match(list.body, /aria-label="Breadcrumb"/);
  assert.match(list.body, /aria-current="page">Corona</);
  assert.match(list.body, /data-page-size="17"/);
  assert.match(list.body, /data-page-size-set="17"/);
  assert.match(list.body, /data-page-size-set="34"/);
  assert.match(list.body, /data-page-size-set="51"/);
  assert.doesNotMatch(list.body, /href="\/corona-comms\//);
  assert.doesNotMatch(list.body, /href="\/corona-comms\/civilians"/);

  const detail = await requestPage("/people/casey-vale");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /Arrests/);
  assert.match(detail.body, /Corona Comms/);
  assert.match(detail.body, /datetime="2024-06-15"/);
  assert.match(detail.body, /datetime="2024-07-20"/);
  assert.equal((detail.body.match(/class="tui-row person-card/g) || []).length, 0);

  await assert.rejects(
    () =>
      applyIdentifiedPerson({
        subject: "Casey Vale",
        event_date: "2024-09-01",
        category: "corona_comms",
        cite_urls: ["https://www.example.com/news/only-one"],
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
});

test("findGoldMatch is identity only — slug or name, not name+date+category", () => {
  const people = goldSeed().people;
  assert.equal(findGoldMatch(people, { subject: "James Comey" })?.id, "james-comey");
  assert.equal(findGoldMatch(people, { subject: "Nobody Here" }), null);
  const vale = {
    id: "casey-vale",
    name: "Casey Vale",
    role: "Public official",
    category: "arrests",
    event_date: "2024-06-15",
    sources: [],
  };
  assert.equal(findGoldMatch([vale], { subject: "Casey Vale", category: "firings" })?.id, "casey-vale");
  assert.equal(
    findGoldMatch([vale], {
      subject: "Casey Vale",
      event_date: "1999-01-01",
      category: "resignations",
    })?.id,
    "casey-vale",
  );
});
