import assert from "node:assert/strict";
import { test } from "node:test";
import path from "path";
import { fileURLToPath } from "url";
import { isMilitaryInput } from "../app/lib/event-attrs.mjs";
import { handle } from "../app/server.mjs";
import { PromoteError } from "../app/lib/promote.mjs";
import { rankDimension } from "../app/lib/dashboard.mjs";
import {
  applyIdentifiedPerson,
  getPerson,
  listPeople,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK, withNewPersonLock } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
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

const BASE = {
  subject: "Casey Vale",
  event_date: "2024-06-15",
  category: "firings",
  cite_urls: CITES,
};

test("new person insert is fail-closed on lock fields", async () => {
  setMemory(goldSeed());
  const missing = [
    ["birth_date", "missing_birth_date"],
    ["country_of_origin", "missing_origin_country"],
    ["position", "missing_position"],
    ["organization", "missing_organization"],
    ["comments", "missing_reason"],
  ];
  for (const [field, code] of missing) {
    const input = withNewPersonLock({ ...BASE });
    delete input[field];
    await assert.rejects(
      () => applyIdentifiedPerson(input),
      (err) => err instanceof PromoteError && err.code === code,
      field,
    );
  }
  await assert.rejects(
    () => applyIdentifiedPerson({ ...NEW_PERSON_LOCK, ...BASE, event_date: "" }),
    (err) => err instanceof PromoteError && err.code === "missing_event_date",
  );
  await assert.rejects(
    () => applyIdentifiedPerson(withNewPersonLock({ ...BASE, cite_urls: [CITES[0]] })),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
  assert.equal(await getPerson("casey-vale"), null);
});

test("military new insert requires branch; civilian branch stays nullable", async () => {
  setMemory(goldSeed());
  assert.equal(isMilitaryInput({}), false);
  assert.equal(isMilitaryInput({ position: "General, US Army" }), false);
  assert.equal(isMilitaryInput({ military: true }), true);
  assert.equal(isMilitaryInput({ tags: ["military"] }), true);

  await assert.rejects(
    () => applyIdentifiedPerson(withNewPersonLock({ ...BASE, military: true })),
    (err) => err instanceof PromoteError && err.code === "missing_branch",
  );
  assert.equal(await getPerson("casey-vale"), null);

  const civilian = await applyIdentifiedPerson(withNewPersonLock({ ...BASE }));
  assert.equal(civilian.action, "created");
  assert.equal(civilian.person.events[0].branch, "");
  const vale = await getPerson("casey-vale");
  assert.equal(vale.country_of_origin, "United States");
  assert.equal(vale.birth_date, "1985-03-12");
  assert.equal(vale.events[0].age_at_event, 39);
  assert.equal(vale.events[0].country, "");
});

test("military branch is stored and ranked on the dashboard", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedPerson(
    withNewPersonLock({
      subject: "Morgan Hale",
      event_date: "2024-03-01",
      category: "resignations",
      cite_urls: CITES,
      military: true,
      branch: "Navy",
      position: "Admiral",
      organization: "Department of the Navy",
      comments: "Retired from active service",
    }),
  );
  assert.equal(created.action, "created");
  const person = await getPerson("morgan-hale");
  assert.equal(person.events[0].branch, "Navy");
  const people = await listPeople();
  const ranked = rankDimension(people, "branch");
  assert.ok(ranked.some((row) => row.label === "Navy" && row.count === 1));
  const dash = await requestPage("/dashboard/branch");
  assert.equal(dash.status, 200);
  assert.match(dash.body, /Navy/);
  assert.match(dash.body, /Morgan Hale|1/);
});

test("age filter uses stored age_at_event on a non-death KEEP list", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson(
    withNewPersonLock({
      subject: "Young Analyst",
      event_date: "2024-06-15",
      category: "firings",
      cite_urls: CITES,
      birth_date: "2000-01-01",
    }),
  );
  await applyIdentifiedPerson(
    withNewPersonLock({
      subject: "Old Analyst",
      event_date: "2024-06-15",
      category: "firings",
      cite_urls: [
        "https://www.example.com/news/old-analyst-held",
        "https://www.example.net/world/old-analyst-arrest",
      ],
      birth_date: "1950-01-01",
    }),
  );
  const young = await listPeople({ category: "firings", minAge: 20, maxAge: 30 });
  assert.ok(young.some((r) => r.id === "young-analyst"));
  assert.ok(!young.some((r) => r.id === "old-analyst"));
  const old = await listPeople({ category: "firings", minAge: 70 });
  assert.ok(old.some((r) => r.id === "old-analyst"));
  assert.ok(!old.some((r) => r.id === "young-analyst"));

  const page = await requestPage("/firings?min_age=20&max_age=30");
  assert.equal(page.status, 200);
  assert.match(page.body, /href="\/people\/young-analyst"/);
  assert.doesNotMatch(page.body, /href="\/people\/old-analyst"/);
  assert.match(page.body, /class="age-filter"/);
  assert.doesNotMatch(page.body, /Age at death/);
});

test("gold rows still load empty; annotate does not require the lock", async () => {
  const seed = goldSeed();
  setMemory(seed);
  for (const row of seed.people) {
    assert.ok(row.birth_date == null, row.id);
    assert.equal(row.country_of_origin, "");
    for (const ev of row.events || []) {
      assert.equal(ev.position || "", "");
      assert.equal(ev.organization || "", "");
      assert.equal(ev.branch || "", "");
      assert.equal(ev.age_at_event, null);
    }
  }
  const annotated = await applyIdentifiedPerson({
    subject: "James Comey",
    event_date: "2017-06-01",
    category: "resignations",
    cite_urls: CITES,
  });
  assert.equal(annotated.action, "annotated");
  const comey = await getPerson("james-comey");
  assert.ok(comey.birth_date == null);
  assert.equal(comey.country_of_origin, "");
  const page = await requestPage("/firings");
  assert.equal(page.status, 200);
  assert.match(page.body, /href="\/people\/james-comey"/);
  const reason = await requestPage("/dashboard/reason");
  assert.equal(reason.status, 200);
  assert.match(reason.body, /Firings/);
});
