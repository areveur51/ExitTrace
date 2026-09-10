import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "url";
import path from "path";
import {
  GROUP_OPS_KEEP_IDS,
  IMPORT_CATEGORY_IDS,
  PROMOTE_CATEGORY_IDS,
  catalogListKinds,
  categoryById,
  categoryByPath,
  isGroupOpsCategory,
  isGroupOpsKeepKind,
  isIndexCategory,
  mapImportCategory,
} from "../app/lib/categories.mjs";
import { DisplayError, checkPersonDisplayed, listPathForPerson } from "../app/lib/display-check.mjs";
import { personRow } from "../app/lib/html.mjs";
import {
  PromoteError,
  validateIdentifiedPersonInput,
} from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
  countPeople,
  getPerson,
  setMemory,
  loadSeedFile,
} from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";
import { LIST_THUMB_CSS_H, LIST_THUMB_CSS_W } from "../app/lib/thumb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];
const SOCIAL = [
  "https://x.com/randomuser/status/1234567890123456789",
  "https://twitter.com/someone/status/9876543210987654321",
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

test("group-ops IA matches deaths: parent index, signed KEEP child only", () => {
  const index = categoryByPath("/group-operations");
  const kids = categoryByPath("/group-operations/missing-kids");
  assert.equal(index.id, "group_ops_unspecified");
  assert.equal(index.nav, "Group Operations");
  assert.equal(kids.id, "missing_kids");
  assert.equal(kids.nav, "Missing Kids");
  assert.deepEqual(GROUP_OPS_KEEP_IDS, ["missing_kids"]);
  assert.deepEqual(catalogListKinds("group_ops_unspecified"), ["missing_kids"]);
  assert.deepEqual(catalogListKinds("missing_kids"), ["missing_kids"]);
  assert.ok(PROMOTE_CATEGORY_IDS.includes("missing_kids"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("group_ops_unspecified"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("missing_kids"));
  assert.equal(mapImportCategory("missing_kids"), null);
  assert.equal(isGroupOpsKeepKind("missing_kids"), true);
  assert.equal(isGroupOpsKeepKind("group_ops_unspecified"), false);
  assert.equal(isGroupOpsCategory("missing_kids"), true);
  assert.equal(isGroupOpsCategory("group_ops_unspecified"), true);
  assert.equal(isGroupOpsCategory("death_celebrity"), false);
  assert.equal(isIndexCategory("group_ops_unspecified"), true);
  assert.ok(!GROUP_OPS_KEEP_IDS.some((id) => id !== "missing_kids"));
});

test("group-ops routes render empty HUD lists; parent is not a dump", async () => {
  setMemory(goldSeed());
  const paths = ["/group-operations", "/group-operations/missing-kids"];
  for (const p of paths) {
    const res = await requestPage(p);
    assert.equal(res.status, 200, p);
    assert.match(res.body, /ExitTrace/);
    assert.match(res.body, /class="tui hud/);
    assert.match(res.body, /class="hud-stage"/);
    assert.match(res.body, /class="pager"/);
    assert.match(res.body, /No rows on this page/);
    assert.doesNotMatch(res.body, /person-card/);
    assert.doesNotMatch(res.body, /widgets\.js/);
    assert.doesNotMatch(res.body, /CLOSE HACK|SAMURAI PROTOCOL|BREACH PROTOCOL/i);
    assert.doesNotMatch(res.body, /Operation Meridian/i);
  }

  const index = await requestPage("/group-operations");
  assert.match(index.body, /value="\/group-operations\/missing-kids"/);
  assert.match(index.body, />Missing Kids</);
  assert.match(index.body, />All</);
  assert.match(index.body, />Civilians</);
  assert.doesNotMatch(index.body, /source-card/);
  assert.doesNotMatch(index.body, /\/group-operations\/(?!missing-kids)/);

  const kids = await requestPage("/group-operations/missing-kids");
  assert.match(kids.body, /data-key="m"/);
  assert.match(kids.body, /href="\/group-operations"/);
  assert.match(kids.body, /value="\/group-operations\/missing-kids"[^>]*selected/);
  assert.match(kids.body, /Missing Kids/);
  assert.match(kids.body, /aria-label="Identity filters"/);
  assert.match(kids.body, />Age</);
  assert.doesNotMatch(kids.body, /Age at death/);
  assert.doesNotMatch(kids.body, /href="\/deaths\/celebrities"/);
});

test("home and add nav know Group Operations; classify form lists missing_kids only", async () => {
  setMemory(goldSeed());
  const home = await requestPage("/");
  assert.equal(home.status, 200);
  assert.match(home.body, /href="\/group-operations"/);
  assert.match(home.body, /data-key="m"/);
  assert.match(home.body, /Group Operations/);

  const add = await requestPage("/add");
  assert.equal(add.status, 200);
  assert.match(add.body, /value="missing_kids"/);
  assert.doesNotMatch(add.body, /value="group_ops_unspecified"/);
});

test("classify accepts missing_kids and fail-closes the index slug", () => {
  const kids = validateIdentifiedPersonInput({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "missing_kids",
    cite_urls: CITES,
  });
  assert.equal(kids.category, "missing_kids");
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-08-01",
        category: "group_ops_unspecified",
        cite_urls: CITES,
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
});

test("X and unofficial social are extra only — not missing_kids cites", () => {
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-08-01",
        category: "missing_kids",
        cite_urls: SOCIAL,
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-08-01",
        category: "missing_kids",
        cite_urls: [CITES[0], SOCIAL[0]],
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
});

test("list paths skip the /group-operations index", () => {
  assert.equal(listPathForPerson("missing_kids"), "/group-operations/missing-kids");
  assert.throws(
    () => listPathForPerson("group_ops_unspecified"),
    (err) => err instanceof DisplayError && err.code === "group_ops_index",
  );
  assert.equal(categoryById("missing_kids").path, "/group-operations/missing-kids");
});

test("unique person: missing_kids is one card; parent lists the union", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "missing_kids",
    cite_urls: CITES,
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.category, "missing_kids");
  assert.equal(created.person.event_date, "2024-08-01");
  assert.equal(created.person.death_date, null);
  assert.equal(created.person.sources.length, 2);
  assert.equal(created.person.birth_date, NEW_PERSON_LOCK.birth_date);
  assert.equal(created.person.country_of_origin, NEW_PERSON_LOCK.country_of_origin);
  assert.equal(created.person.events[0].position, NEW_PERSON_LOCK.position);
  assert.equal(created.person.events[0].organization, NEW_PERSON_LOCK.organization);
  assert.equal(created.person.events[0].comments, NEW_PERSON_LOCK.comments);

  const shown = await checkPersonDisplayed(created.person);
  assert.equal(shown.list, "/group-operations/missing-kids");
  assert.equal(shown.detail, "/people/casey-vale");

  const list = await requestPage("/group-operations/missing-kids");
  assert.match(list.body, /Casey Vale/);
  assert.match(list.body, /href="\/people\/casey-vale"/);
  assert.match(list.body, /class="tui-row person-card/);
  assert.match(list.body, / · Missing Kids · /);
  const index = await requestPage("/group-operations");
  assert.match(index.body, /href="\/people\/casey-vale"/);
  assert.match(index.body, /Casey Vale/);
  assert.match(index.body, /1 available/);
  assert.match(index.body, /value="\/group-operations\/missing-kids"/);
  const firings = await requestPage("/firings");
  assert.doesNotMatch(firings.body, /href="\/people\/casey-vale"/);

  const again = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-09-01",
    category: "missing_kids",
    cite_urls: ["https://www.example.com/news/casey-vale-held", "https://www.example.org/n/extra"],
  });
  assert.equal(again.action, "annotated");
  assert.equal(again.person.id, "casey-vale");
  assert.equal(again.person.event_date, "2024-08-01");
  assert.equal(await countPeople(), 73);
});

test("missing_kids annotates an existing person — no second row", async () => {
  setMemory(goldSeed());
  const arrest = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  });
  const tagged = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "missing_kids",
    cite_urls: CITES,
  });
  assert.equal(tagged.action, "annotated");
  assert.equal(tagged.person.id, arrest.person.id);
  assert.equal(await countPeople(), 73);
  const vale = await getPerson("casey-vale");
  assert.ok(vale.events.some((ev) => ev.kind === "arrests" && ev.event_date === "2024-06-15"));
  assert.ok(vale.events.some((ev) => ev.kind === "missing_kids" && ev.event_date === "2024-08-01"));

  const list = await requestPage("/group-operations/missing-kids");
  assert.match(list.body, /Casey Vale/);
  const parent = await requestPage("/group-operations");
  assert.match(parent.body, /Casey Vale/);
  const detail = await requestPage("/people/casey-vale");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /Casey Vale/);
  assert.match(detail.body, /Group Operations — missing kids/);
  assert.match(detail.body, /Arrests/);
});

test("missing_kids person cards keep 40×52 local thumbs", () => {
  const html = personRow(
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "missing_kids",
      event_date: "2024-08-01",
      photo: "/media/people/casey-vale.jpg",
      net_worth_usd: null,
    },
    {},
  );
  assert.match(html, /class="tui-row person-card/);
  assert.match(html, /class="portrait thumb"/);
  assert.match(html, new RegExp(`width="${LIST_THUMB_CSS_W}" height="${LIST_THUMB_CSS_H}"`));
  assert.match(html, /\/media\/thumbs\/people\/casey-vale\.jpg/);
  assert.doesNotMatch(html, /src="\/media\/people\//);
});
