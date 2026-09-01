import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageAtDeath,
  ageFilterActive,
  ageFilterPath,
  matchesAgeFilter,
  parseAgeBound,
  parseAgeFilter,
} from "../app/lib/age.mjs";
import { personDetail, personRow } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { countPeople, listPeople, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function deathRow(partial) {
  return {
    id: partial.id,
    category: partial.category,
    name: partial.name,
    role: "Test",
    event_date: partial.event_date,
    death_date: partial.event_date,
    birth_date: partial.birth_date ?? null,
    photo: "",
    sources: [],
    summary: "",
    net_worth_usd: null,
    events: [
      {
        kind: partial.category,
        event_date: partial.event_date,
        sources: [],
      },
    ],
  };
}

test("age at death is whole completed years; missing birth_date is not guessed", () => {
  assert.equal(ageAtDeath("2000-01-01", "2020-01-01"), 20);
  assert.equal(ageAtDeath("1940-06-16", "2020-06-16"), 80);
  assert.equal(ageAtDeath("1940-06-16", "2020-06-15"), 79);
  assert.equal(ageAtDeath(null, "2020-01-01"), null);
  assert.equal(ageAtDeath("", "2020-01-01"), null);
  assert.equal(ageAtDeath("2000-01-01", null), null);
  assert.equal(ageAtDeath("2020-01-01", "2000-01-01"), null);
  assert.equal(ageAtDeath("not-a-date", "2020-01-01"), null);
});

test("age bounds and filter stay fail-closed", () => {
  assert.equal(parseAgeBound("40"), 40);
  assert.equal(parseAgeBound("0"), 0);
  assert.equal(parseAgeBound(""), null);
  assert.equal(parseAgeBound("nope"), null);
  assert.equal(parseAgeBound("-1"), null);
  assert.equal(ageFilterActive({}), false);
  assert.equal(ageFilterActive({ minAge: 40 }), true);
  assert.equal(ageFilterActive({ maxAge: 80 }), true);
  assert.deepEqual(parseAgeFilter(new URLSearchParams("min_age=50&max_age=70")), {
    minAge: 50,
    maxAge: 70,
  });
  assert.equal(ageFilterPath("/deaths", {}), "/deaths");
  assert.equal(ageFilterPath("/deaths", { minAge: 40 }), "/deaths?min_age=40");
  assert.equal(
    ageFilterPath("/deaths/officials", { minAge: 50, maxAge: 80 }),
    "/deaths/officials?min_age=50&max_age=80",
  );

  const aged = { birth_date: "1950-01-01", death_date: "2020-01-01" };
  const missing = { death_date: "2020-01-01" };
  assert.equal(matchesAgeFilter(aged, {}), true);
  assert.equal(matchesAgeFilter(missing, {}), true);
  assert.equal(matchesAgeFilter(aged, { minAge: 60 }), true);
  assert.equal(matchesAgeFilter(aged, { minAge: 80 }), false);
  assert.equal(matchesAgeFilter(missing, { minAge: 1 }), false);
  assert.equal(matchesAgeFilter(missing, { maxAge: 120 }), false);
});

test("gold seed does not backfill birth_date", () => {
  const seed = goldSeed();
  assert.equal(seed.people.length, 72);
  for (const row of seed.people) {
    assert.ok(row.birth_date == null, row.id);
  }
});

test("age filter is on catalog lists and excludes rows without birth_date", async () => {
  const seed = goldSeed();
  setMemory({
    people: [
      ...seed.people,
      deathRow({
        id: "young-star",
        name: "Young Star",
        category: "death_celebrity",
        event_date: "2024-12-01",
        birth_date: "2000-01-01",
      }),
      deathRow({
        id: "old-official",
        name: "Old Official",
        category: "death_official",
        event_date: "2024-11-15",
        birth_date: "1940-06-16",
      }),
      deathRow({
        id: "unknown-birth",
        name: "Unknown Birth",
        category: "death_ceo",
        event_date: "2024-10-01",
      }),
    ],
    dog_comms: seed.dog_comms,
  });

  const young = await listPeople({
    category: ["death_celebrity", "death_official", "death_ceo"],
    minAge: 1,
    maxAge: 30,
  });
  assert.ok(young.some((r) => r.id === "young-star"));
  assert.ok(!young.some((r) => r.id === "old-official"));
  assert.ok(!young.some((r) => r.id === "unknown-birth"));

  const old = await listPeople({
    category: "death_official",
    minAge: 70,
  });
  assert.ok(old.some((r) => r.id === "old-official"));
  assert.ok(!old.some((r) => r.id === "unknown-birth"));

  assert.equal(
    await countPeople({
      category: ["death_celebrity", "death_official", "death_ceo"],
      minAge: 1,
    }),
    2,
  );

  const deaths = await requestPage("/deaths");
  const celebs = await requestPage("/deaths/celebrities");
  const officials = await requestPage("/deaths/officials");
  const firings = await requestPage("/firings");
  const arrests = await requestPage("/arrests");
  const unsorted = await requestPage("/unsorted");
  const dogs = await requestPage("/dog-comms");
  const home = await requestPage("/");
  const add = await requestPage("/add");
  const detail = await requestPage("/people/james-comey");

  for (const res of [deaths, celebs, officials]) {
    assert.equal(res.status, 200);
    assert.match(res.body, /class="age-filter"/);
    assert.match(res.body, /name="min_age"/);
    assert.match(res.body, /name="max_age"/);
    assert.match(res.body, /Age at death/);
  }
  for (const res of [firings, arrests]) {
    assert.equal(res.status, 200);
    assert.match(res.body, /class="age-filter"/);
    assert.match(res.body, /name="min_age"/);
    assert.match(res.body, />Age</);
    assert.doesNotMatch(res.body, /Age at death/);
  }
  for (const res of [unsorted, dogs, home, add, detail]) {
    assert.doesNotMatch(res.body, /class="age-filter"/);
    assert.doesNotMatch(res.body, /name="min_age"/);
  }

  const filtered = await requestPage("/deaths?min_age=1&max_age=30");
  assert.equal(filtered.status, 200);
  assert.match(filtered.body, /href="\/people\/young-star"/);
  assert.doesNotMatch(filtered.body, /href="\/people\/old-official"/);
  assert.doesNotMatch(filtered.body, /href="\/people\/unknown-birth"/);
  assert.match(filtered.body, /1 available/);
  assert.match(filtered.body, /href="\/deaths\?min_age=1&amp;max_age=30"/);
  assert.doesNotMatch(filtered.body, /href="\/deaths\?page=/);

  const child = await requestPage("/deaths/officials?min_age=70");
  assert.match(child.body, /href="\/people\/old-official"/);
  assert.doesNotMatch(child.body, /href="\/people\/young-star"/);
  assert.doesNotMatch(child.body, /href="\/people\/unknown-birth"/);

  const unfiltered = await requestPage("/deaths");
  assert.match(unfiltered.body, /href="\/people\/unknown-birth"/);
  assert.match(unfiltered.body, /href="\/people\/young-star"/);
});

test("person cards and detail stay one card; birth_date is not invented", () => {
  const row = deathRow({
    id: "young-star",
    name: "Young Star",
    category: "death_celebrity",
    event_date: "2024-12-01",
  });
  const card = personRow(row, { showDeath: true });
  assert.match(card, /Young Star/);
  assert.doesNotMatch(card, /person-card[\s\S]*person-card/);
  const detail = personDetail({ ...row, events: row.events, sources: [] });
  assert.doesNotMatch(detail, /birth_date|Birth date|Age at death/);
});
