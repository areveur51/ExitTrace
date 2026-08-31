import assert from "node:assert/strict";
import fs from "fs";
import { test } from "node:test";
import { fileURLToPath } from "url";
import path from "path";
import {
  INDICTMENT_KEEP_IDS,
  IMPORT_CATEGORY_IDS,
  PROMOTE_CATEGORY_IDS,
  categoryById,
  categoryByPath,
  isIndictmentKeepKind,
  mapImportCategory,
} from "../app/lib/categories.mjs";
import { DisplayError, checkPersonDisplayed, listPathForPerson } from "../app/lib/display-check.mjs";
import { personRow } from "../app/lib/html.mjs";
import { importSourcePostsText } from "../app/lib/import-posts.mjs";
import {
  findGoldMatch,
  PromoteError,
  validateIdentifiedPersonInput,
} from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
  countPeople,
  getMemory,
  getPerson,
  listPeople,
  loadSeedFile,
  promoteSourcePost,
  setMemory,
} from "../app/lib/store.mjs";
import { LIST_THUMB_CSS_H, LIST_THUMB_CSS_W } from "../app/lib/thumb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "source-posts.jsonl");
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

test("indictment IA matches deaths: parent index, two KEEP child lists", () => {
  const index = categoryByPath("/indictments");
  const civilians = categoryByPath("/indictments/civilians");
  const nonCivilians = categoryByPath("/indictments/non-civilians");
  assert.equal(index.id, "indictment_unspecified");
  assert.equal(index.nav, "Indictments");
  assert.equal(civilians.id, "indictment_civilian");
  assert.equal(civilians.nav, "Civilians");
  assert.equal(nonCivilians.id, "indictment_non_civilian");
  assert.equal(nonCivilians.nav, "Non-civilians");
  assert.deepEqual(INDICTMENT_KEEP_IDS, [
    "indictment_civilian",
    "indictment_non_civilian",
  ]);
  assert.ok(PROMOTE_CATEGORY_IDS.includes("indictment_civilian"));
  assert.ok(PROMOTE_CATEGORY_IDS.includes("indictment_non_civilian"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("indictment_unspecified"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("indictment_civilian"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("indictment_non_civilian"));
  assert.equal(mapImportCategory("indictment_civilian"), null);
  assert.equal(mapImportCategory("indictment_non_civilian"), null);
  assert.equal(isIndictmentKeepKind("indictment_civilian"), true);
  assert.equal(isIndictmentKeepKind("indictment_unspecified"), false);
});

test("indictment routes render empty HUD lists; parent is not a dump", async () => {
  setMemory(goldSeed());
  const paths = ["/indictments", "/indictments/civilians", "/indictments/non-civilians"];
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
    assert.doesNotMatch(res.body, /ChronoTrace|chronotrace/i);
    assert.doesNotMatch(res.body, /CLOSE HACK|SAMURAI PROTOCOL|BREACH PROTOCOL/i);
  }

  const index = await requestPage("/indictments");
  assert.match(index.body, /href="\/indictments\/civilians"/);
  assert.match(index.body, /href="\/indictments\/non-civilians"/);
  assert.match(index.body, />Civilians</);
  assert.match(index.body, />Non-civilians</);
  assert.doesNotMatch(index.body, /source-card/);

  const civilians = await requestPage("/indictments/civilians");
  assert.match(civilians.body, /data-key="i"/);
  assert.match(civilians.body, /href="\/indictments"/);
  assert.match(civilians.body, />Civilians</);
  assert.match(civilians.body, />Non-civilians</);
  assert.doesNotMatch(civilians.body, /href="\/deaths\/celebrities"/);
});

test("home and add nav know Indictments; classify form lists both KEEP kinds", async () => {
  setMemory(goldSeed());
  const home = await requestPage("/");
  assert.equal(home.status, 200);
  assert.match(home.body, /href="\/indictments"/);
  assert.match(home.body, /data-key="i"/);
  assert.match(home.body, />Indictments</);

  const add = await requestPage("/add");
  assert.equal(add.status, 200);
  assert.match(add.body, /value="indictment_civilian"/);
  assert.match(add.body, /value="indictment_non_civilian"/);
  assert.doesNotMatch(add.body, /value="indictment_unspecified"/);
});

test("classify accepts the two KEEP kinds and fail-closes the index slug", () => {
  const civilian = validateIdentifiedPersonInput({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
  });
  assert.equal(civilian.category, "indictment_civilian");
  const nonCivilian = validateIdentifiedPersonInput({
    subject: "Casey Vale",
    event_date: "2024-08-02",
    category: "indictment_non_civilian",
    cite_urls: CITES,
  });
  assert.equal(nonCivilian.category, "indictment_non_civilian");
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-08-01",
        category: "indictment_unspecified",
        cite_urls: CITES,
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
});

test("list paths skip the /indictments index", () => {
  assert.equal(listPathForPerson("indictment_civilian"), "/indictments/civilians");
  assert.equal(listPathForPerson("indictment_non_civilian"), "/indictments/non-civilians");
  assert.throws(
    () => listPathForPerson("indictment_unspecified"),
    (err) => err instanceof DisplayError && err.code === "indictments_index",
  );
  assert.equal(categoryById("indictment_civilian").path, "/indictments/civilians");
});

test("parked source posts rematch onto indictment KEEP kinds; catalog stays closed", async () => {
  setMemory(goldSeed());
  await importSourcePostsText(fs.readFileSync(FIXTURE, "utf8"));
  const created = await promoteSourcePost({
    source_url: "https://example.com/n/arrest-1",
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.category, "indictment_civilian");
  assert.equal(created.person.event_date, "2024-08-01");
  assert.equal(created.person.death_date, null);
  assert.equal(created.person.sources.length, 2);

  const shown = await checkPersonDisplayed(created.person);
  assert.equal(shown.list, "/indictments/civilians");
  assert.equal(shown.detail, "/people/casey-vale");

  const list = await requestPage("/indictments/civilians");
  assert.match(list.body, /Casey Vale/);
  assert.match(list.body, /href="\/people\/casey-vale"/);
  assert.match(list.body, /class="tui-row person-card/);
  assert.match(list.body, / · Civilians · /);
  const index = await requestPage("/indictments");
  assert.doesNotMatch(index.body, /href="\/people\/casey-vale"/);
  assert.match(index.body, /href="\/indictments\/civilians"/);
});

test("per-kind dedup: arrest + indictment when events differ; never two of the same indictment kind", async () => {
  setMemory(goldSeed());
  await importSourcePostsText(fs.readFileSync(FIXTURE, "utf8"));
  const arrest = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  });
  assert.equal(arrest.action, "created");
  assert.equal(arrest.person.id, "casey-vale");

  assert.equal(
    findGoldMatch(await listPeople(), {
      subject: "Casey Vale",
      event_date: "2024-08-01",
      category: "indictment_civilian",
    }),
    null,
  );

  const indictment = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: CITES,
  });
  assert.equal(indictment.action, "created");
  assert.equal(indictment.person.category, "indictment_civilian");
  assert.notEqual(indictment.person.id, arrest.person.id);
  assert.equal(await countPeople(), 74);
  assert.equal((await getPerson("casey-vale")).category, "arrests");

  const again = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-09-01",
    category: "indictment_civilian",
    cite_urls: ["https://www.example.com/news/casey-vale-held", "https://www.example.org/n/extra"],
  });
  assert.equal(again.action, "annotated");
  assert.equal(again.person.category, "indictment_civilian");
  assert.equal(again.person.event_date, "2024-08-01");
  assert.equal(await countPeople(), 74);

  const otherKind = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-10-01",
    category: "indictment_non_civilian",
    cite_urls: CITES,
  });
  assert.equal(otherKind.action, "annotated");
  assert.equal(otherKind.person.category, "indictment_civilian");
  assert.equal(await countPeople(), 74);

  const shown = await checkPersonDisplayed(indictment.person);
  assert.equal(shown.list, "/indictments/civilians");
});

test("indictment person cards keep 40×52 local thumbs", () => {
  const html = personRow(
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "indictment_civilian",
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
