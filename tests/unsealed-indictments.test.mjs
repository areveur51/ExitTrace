import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import {
  INDICTMENT_KEEP_IDS,
  PROMOTE_CATEGORY_IDS,
  categoryByPath,
} from "../app/lib/categories.mjs";
import { buildDashboard, countUnsealedIndictments } from "../app/lib/dashboard.mjs";
import {
  annotateUnsealedPerson,
  planUnsealedAnnotations,
  textStatesUnsealed,
  unsealedFromEvidence,
} from "../app/lib/event-attrs.mjs";
import { buildUpsertSql } from "../app/lib/gap-upsert.mjs";
import { eventTagRow } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
  countDogComms,
  countOperations,
  countPeople,
  getPerson,
  listPeople,
  loadSeedFile,
  peopleUnsealedWhere,
  setMemory,
} from "../app/lib/store.mjs";
import {
  IDENTITY_TAG_IDS,
  indictmentUnsealedSelectOptions,
  parseTagFilter,
  parseUnsealedFilter,
} from "../app/lib/tags.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";

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

test("unsealed is evidence on indictment events only; sealed or unclear stays null", () => {
  assert.equal(textStatesUnsealed("The indictment was unsealed in open court"), true);
  assert.equal(textStatesUnsealed("The filing was made public Tuesday"), true);
  assert.equal(textStatesUnsealed("The indictment remains sealed"), false);
  assert.equal(textStatesUnsealed("The indictment was not unsealed"), false);
  assert.equal(
    textStatesUnsealed("It is unclear whether the indictment was unsealed"),
    false,
  );
  assert.equal(
    unsealedFromEvidence(
      { comments: "The indictment was unsealed", unsealed: true },
      "indictment_civilian",
    ),
    true,
  );
  assert.equal(
    unsealedFromEvidence(
      { comments: "Public-role exit", unsealed: true },
      "indictment_civilian",
    ),
    null,
  );
  assert.equal(
    unsealedFromEvidence(
      { comments: "The indictment was unsealed" },
      "firings",
    ),
    null,
  );
  assert.equal(PROMOTE_CATEGORY_IDS.includes("unsealed"), false);
  assert.equal(IDENTITY_TAG_IDS.includes("unsealed"), false);
  assert.deepEqual(INDICTMENT_KEEP_IDS, [
    "indictment_civilian",
    "indictment_non_civilian",
  ]);
  assert.equal(categoryByPath("/indictments/unsealed"), null);
});

test("promote sets unsealed only from cite wording and does not clear a stored true", async () => {
  setMemory(goldSeed());
  const opened = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
    comments: "The indictment was unsealed in federal court",
  });
  assert.equal(opened.person.events[0].unsealed, true);
  assert.equal(opened.person.events[0].kind, "indictment_civilian");

  const kept = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
    comments: "The indictment remains sealed",
  });
  assert.equal(kept.person.events[0].unsealed, true);
  assert.match(kept.person.events[0].comments, /unsealed in federal court/);

  const sealed = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Mina Holt",
    event_date: "2024-09-02",
    category: "indictment_non_civilian",
    cite_urls: CITES,
    comments: "The indictment remains sealed",
  });
  assert.equal(sealed.person.events[0].unsealed, null);

  const unclear = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Noah Peck",
    event_date: "2024-09-03",
    category: "indictment_civilian",
    cite_urls: CITES,
    unsealed_evidence: "It is unclear whether the indictment was unsealed",
  });
  assert.equal(unclear.person.events[0].unsealed, null);

  const firing = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Ada Quinn",
    event_date: "2024-09-04",
    category: "firings",
    cite_urls: CITES,
    comments: "The indictment was unsealed",
  });
  assert.notEqual(firing.person.events[0].unsealed, true);

  const filled = await applyIdentifiedPerson({
    subject: "Mina Holt",
    event_date: "2024-09-02",
    category: "indictment_non_civilian",
    cite_urls: CITES,
    unsealed_evidence: "DOJ said the indictment was made public",
  });
  assert.equal(filled.person.events[0].unsealed, true);
  assert.equal(filled.person.events[0].comments, "The indictment remains sealed");
  assert.equal(filled.person.name, "Mina Holt");
});

test("unsealed SQL with no indictment kinds is always false", async () => {
  assert.equal(peopleUnsealedWhere([], true, []), " AND FALSE");
  assert.equal(peopleUnsealedWhere([], true, ["firings", "arrests"]), " AND FALSE");
  assert.equal(peopleUnsealedWhere([], false, []), "");
  const params = [];
  const sql = peopleUnsealedWhere(params, true, ["firings", "indictment_civilian"]);
  assert.match(sql, /e\.unsealed IS TRUE/);
  assert.deepEqual(params[0], ["indictment_civilian"]);

  setMemory(goldSeed());
  const people = await countPeople();
  const ops = await countOperations();
  const dogs = await countDogComms();
  assert.equal(await countPeople({ unsealed: true }), 0);
  assert.equal((await listPeople({ category: "firings", unsealed: true })).length, 0);
  assert.equal(await countPeople(), people);
  assert.equal(await countOperations(), ops);
  assert.equal(await countDogComms(), dogs);
});

test("?tags=unsealed narrows existing indictment routes and does not add a route", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
    comments: "The indictment was unsealed",
  });
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Mina Holt",
    event_date: "2024-09-02",
    category: "indictment_non_civilian",
    cite_urls: CITES,
    comments: "The indictment remains sealed",
  });
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Noah Peck",
    event_date: "2024-09-03",
    category: "indictment_civilian",
    cite_urls: CITES,
  });

  const all = await listPeople({
    category: ["indictment_civilian", "indictment_non_civilian"],
  });
  const opened = await listPeople({
    category: ["indictment_civilian", "indictment_non_civilian"],
    unsealed: true,
  });
  assert.equal(all.length, 3);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, "Casey Vale");

  assert.deepEqual(parseTagFilter("tags=unsealed", "/indictments/civilians"), [
    "civilian",
  ]);
  assert.equal(parseUnsealedFilter("tags=unsealed"), true);
  assert.deepEqual(parseTagFilter("tags=celebrity", "/firings"), ["celebrity"]);

  assert.deepEqual(
    indictmentUnsealedSelectOptions().map((opt) => [opt.label, opt.href]),
    [
      ["Unsealed", "/indictments?tags=unsealed"],
      ["Unsealed·Civilians", "/indictments/civilians?tags=unsealed"],
      ["Unsealed·Non-civilians", "/indictments/non-civilians?tags=unsealed"],
    ],
  );

  const selectedByRoute = {
    "/indictments?tags=unsealed": "/indictments?tags=unsealed",
    "/indictments/civilians?tags=unsealed": "/indictments/civilians?tags=unsealed",
    "/indictments?tags=civilian,unsealed": "/indictments/civilians?tags=unsealed",
    "/indictments?tags=non_civilian,unsealed": "/indictments/non-civilians?tags=unsealed",
  };
  for (const [route, selected] of Object.entries(selectedByRoute)) {
    const page = await requestPage(route);
    assert.equal(page.status, 200, route);
    assert.match(page.body, /data-filter-select/);
    assert.doesNotMatch(page.body, /unsealed-filter/);
    assert.match(page.body, />All</);
    assert.match(page.body, />Civilians</);
    assert.match(page.body, />Non-civilians</);
    assert.match(page.body, />Unsealed</);
    assert.match(page.body, />Unsealed·Civilians</);
    assert.match(page.body, />Unsealed·Non-civilians</);
    assert.match(
      page.body,
      new RegExp(`value="${selected.replace(/[?]/g, "\\?")}" selected`),
    );
    const showsCasey =
      route === "/indictments?tags=unsealed" ||
      route === "/indictments/civilians?tags=unsealed" ||
      route === "/indictments?tags=civilian,unsealed";
    if (showsCasey) {
      assert.match(page.body, /Casey Vale/);
      assert.doesNotMatch(page.body, /Mina Holt/);
      assert.doesNotMatch(page.body, /Noah Peck/);
    }
    if (route === "/indictments?tags=non_civilian,unsealed") {
      assert.doesNotMatch(page.body, /Casey Vale/);
      assert.doesNotMatch(page.body, /Mina Holt/);
      assert.doesNotMatch(page.body, /Noah Peck/);
    }
  }
  const nonCiv = await requestPage("/indictments/non-civilians?tags=unsealed");
  assert.equal(nonCiv.status, 200);
  assert.match(nonCiv.body, /value="\/indictments\/non-civilians\?tags=unsealed" selected/);
  assert.doesNotMatch(nonCiv.body, /unsealed-filter/);
  assert.doesNotMatch(nonCiv.body, /Casey Vale/);
  assert.doesNotMatch(nonCiv.body, /Mina Holt/);
  assert.doesNotMatch(nonCiv.body, /Noah Peck/);

  const civilians = await requestPage("/indictments/civilians");
  assert.match(civilians.body, /Casey Vale/);
  assert.match(civilians.body, /Noah Peck/);
  assert.doesNotMatch(civilians.body, /Mina Holt/);
  assert.match(civilians.body, /value="\/indictments\/civilians" selected/);
  assert.match(civilians.body, /value="\/indictments\/civilians\?tags=unsealed"/);
  assert.doesNotMatch(civilians.body, /unsealed-filter/);
  assert.doesNotMatch(civilians.body, /href="\/indictments\/unsealed"/);

  const missing = await requestPage("/indictments/unsealed");
  assert.equal(missing.status, 404);

  const firings = await requestPage("/firings");
  assert.doesNotMatch(firings.body, /unsealed-filter/);
  assert.doesNotMatch(firings.body, />Unsealed</);
});

test("detail badge shows Unsealed only when the indictment event is true", async () => {
  const shown = eventTagRow({
    kind: "indictment_civilian",
    event_date: "2024-08-01",
    unsealed: true,
    sources: [],
  });
  assert.match(shown, /data-unsealed="true"/);
  assert.match(shown, />Unsealed</);
  const hidden = eventTagRow({
    kind: "indictment_civilian",
    event_date: "2024-08-01",
    unsealed: null,
    sources: [],
  });
  assert.doesNotMatch(hidden, /data-unsealed/);
  assert.doesNotMatch(hidden, />Unsealed</);
  const sealed = eventTagRow({
    kind: "indictment_non_civilian",
    event_date: "2024-08-01",
    unsealed: false,
    sources: [],
  });
  assert.doesNotMatch(sealed, />Unsealed</);
  const firing = eventTagRow({
    kind: "firings",
    event_date: "2024-08-01",
    unsealed: true,
    sources: [],
  });
  assert.doesNotMatch(firing, />Unsealed</);

  setMemory(goldSeed());
  const created = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
    comments: "The indictment was unsealed",
  });
  const detail = await requestPage(`/people/${created.person.id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.body, /data-unsealed="true"/);
  assert.match(detail.body, />Unsealed</);
});

test("annotate helper and column add do not change people, ops, or dog counts", async () => {
  setMemory(goldSeed());
  const before = {
    people: await countPeople(),
    ops: await countOperations(),
    dogs: await countDogComms(),
  };
  const plans = planUnsealedAnnotations(await listPeople());
  assert.equal(plans.length, 0);
  assert.equal(await countPeople(), before.people);
  assert.equal(await countOperations(), before.ops);
  assert.equal(await countDogComms(), before.dogs);
  assert.equal(countUnsealedIndictments(await listPeople()), 0);

  const gold = {
    id: "gold-row",
    name: "Gold Name",
    events: [
      {
        kind: "indictment_civilian",
        event_date: "2024-01-01",
        comments: "sealed filing",
        sources: [{ title: "Court unsealed the indictment", url: "https://www.example.com/a" }],
        unsealed: true,
      },
    ],
  };
  const kept = annotateUnsealedPerson(gold);
  assert.equal(kept.changed, false);
  assert.equal(kept.person.name, "Gold Name");
  assert.equal(kept.person.events[0].comments, "sealed filing");
  assert.equal(kept.person.events[0].unsealed, true);

  const empty = {
    id: "empty-row",
    name: "Empty Name",
    photo: "/media/people/empty-row.jpg",
    events: [
      {
        kind: "indictment_non_civilian",
        event_date: "2024-02-02",
        comments: "sealed filing",
        sources: [{ title: "Indictment unsealed", url: "https://www.example.com/b" }],
      },
      {
        kind: "firings",
        event_date: "2023-01-01",
        comments: "The indictment was unsealed",
        sources: [],
      },
    ],
  };
  const filled = annotateUnsealedPerson(empty);
  assert.equal(filled.changed, true);
  assert.equal(filled.person.name, "Empty Name");
  assert.equal(filled.person.photo, empty.photo);
  assert.equal(filled.person.events[0].unsealed, true);
  assert.equal(filled.person.events[0].comments, "sealed filing");
  assert.notEqual(filled.person.events[1].unsealed, true);
  assert.equal(annotateUnsealedPerson(filled.person).changed, false);

  const sql = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS unsealed BOOLEAN/);
  assert.doesNotMatch(sql, /SET\s+unsealed/i);
  const helper = fs.readFileSync(
    path.join(ROOT, "scripts", "annotate-unsealed-indictments.mjs"),
    "utf8",
  );
  assert.match(helper, /dry-run/);
  assert.match(helper, /--apply/);
  assert.match(helper, /does not write data\/seed\.json/i);
  assert.doesNotMatch(helper, /TRUNCATE|DELETE FROM|unlink|rmSync/i);
  const notes = fs.readFileSync(
    path.join(ROOT, "scripts", "annotate-unsealed-indictments.sql"),
    "utf8",
  );
  assert.match(notes, /Do not execute a row change/);
  assert.doesNotMatch(notes, /^\s*UPDATE\s+/im);

  const upsert = buildUpsertSql("person_events", [
    {
      person_id: "gold-row",
      kind: "indictment_civilian",
      event_date: "2024-01-01",
      sources: [],
      unsealed: false,
    },
  ]);
  assert.match(upsert.sql, /unsealed/);
  assert.match(upsert.sql, /IS TRUE THEN TRUE/);
  assert.equal(upsert.params.includes(false), false);
});

test("dashboard unsealed count is indictment events with true and leaves other counts", async () => {
  setMemory(goldSeed());
  const peopleBefore = await countPeople();
  const opsBefore = await countOperations();
  const dogsBefore = await countDogComms();
  const base = buildDashboard(await listPeople(), { id: "all" }, []);
  assert.equal(base.unsealed, 0);
  assert.equal(base.people, peopleBefore);

  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
    comments: "The indictment was unsealed",
  });
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Mina Holt",
    event_date: "2024-09-02",
    category: "indictment_non_civilian",
    cite_urls: CITES,
  });
  const people = await listPeople();
  const model = buildDashboard(people, { id: "all" }, []);
  assert.equal(model.unsealed, 1);
  assert.equal(model.people, peopleBefore + 2);
  assert.equal(await countOperations(), opsBefore);
  assert.equal(await countDogComms(), dogsBefore);
  const row = await getPerson("casey-vale");
  assert.equal(row.events[0].unsealed, true);

  const dash = await requestPage("/dashboard");
  assert.equal(dash.status, 200);
  assert.match(dash.body, /data-unsealed-count="1"/);
  assert.match(dash.body, /href="\/indictments\?tags=unsealed"/);
});
