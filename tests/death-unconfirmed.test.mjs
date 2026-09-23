import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import {
  DEATH_KEEP_IDS,
  DEATH_UNCONFIRMED_ID,
  PROMOTE_CATEGORY_IDS,
  catalogListKinds,
  isDeathCategory,
  isDeathFamily,
  isDeathUnconfirmed,
  mapImportCategory,
} from "../app/lib/categories.mjs";
import {
  buildDashboard,
  countDeathUnconfirmed,
  rankDimension,
} from "../app/lib/dashboard.mjs";
import { classifyDigestText } from "../app/lib/digest.mjs";
import { listPathForPerson } from "../app/lib/display-check.mjs";
import {
  DEATH_UNCONFIRMED_FOOTNOTE,
  confirmedDeathUpgradeGate,
  deathUnconfirmedEvent,
  eventFromLead,
  mapLeadReason,
} from "../app/lib/event-attrs.mjs";
import { personDetail } from "../app/lib/html.mjs";
import { PromoteError, attachPersonEvent, validateIdentifiedPersonInput } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { countPeople, getPerson, listPeople, loadSeedFile, setMemory } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = path.join(ROOT, "data", "seed.json");
const CLAIM_URL = "https://truthsocial.com/@example/posts/claim-1";
const CITE = {
  title: "Truth Social post",
  publisher: "Truth Social",
  url: CLAIM_URL,
  date: "",
};

function goldSeed() {
  return loadSeedFile(SEED_PATH);
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

function filesUnder(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) filesUnder(full, out);
    else if (/\.(mjs|js|sql)$/.test(ent.name)) out.push(full);
  }
  return out;
}

function hostPerson() {
  return {
    id: "riley-north",
    category: "firings",
    name: "Riley North",
    role: "Editor",
    event_date: "2024-06-01",
    death_date: null,
    sources: [
      {
        title: "Desk exit",
        publisher: "Example News",
        url: "https://www.example.com/news/riley-north",
        date: "2024-06-01",
      },
    ],
    events: [
      {
        kind: "firings",
        event_date: "2024-06-01",
        comments: "Left the desk",
        position: "Editor",
        organization: "Example Desk",
        sources: [
          {
            title: "Desk exit",
            publisher: "Example News",
            url: "https://www.example.com/news/riley-north",
            date: "2024-06-01",
          },
        ],
      },
    ],
  };
}

test("DEATH_KEEP_IDS membership stays the confirmed trio", () => {
  assert.deepEqual(DEATH_KEEP_IDS, ["death_celebrity", "death_official", "death_ceo"]);
  assert.equal(DEATH_KEEP_IDS.includes(DEATH_UNCONFIRMED_ID), false);
  assert.equal(PROMOTE_CATEGORY_IDS.includes(DEATH_UNCONFIRMED_ID), false);
  assert.equal(isDeathUnconfirmed(DEATH_UNCONFIRMED_ID), true);
  assert.equal(isDeathCategory(DEATH_UNCONFIRMED_ID), false);
  assert.equal(isDeathCategory("death_celebrity"), true);
  assert.equal(isDeathCategory("death_unspecified"), true);
  assert.equal(isDeathFamily(DEATH_UNCONFIRMED_ID), true);
  assert.deepEqual(catalogListKinds("death_unspecified"), DEATH_KEEP_IDS);
  assert.deepEqual(catalogListKinds(DEATH_UNCONFIRMED_ID), [DEATH_UNCONFIRMED_ID]);
  assert.equal(listPathForPerson(DEATH_UNCONFIRMED_ID), "/deaths/unconfirmed");
});

test("startsWith death_ count paths use DEATH_KEEP_IDS or exclude death_unconfirmed", () => {
  const offenders = [];
  for (const file of [
    ...filesUnder(path.join(ROOT, "app")),
    ...filesUnder(path.join(ROOT, "scripts")),
  ]) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes("LIKE 'death_%'") || text.includes('LIKE "death_%"')) {
      offenders.push(`${path.relative(ROOT, file)} LIKE`);
    }
    if (
      (text.includes('startsWith("death_")') || text.includes("startsWith('death_')")) &&
      !file.endsWith(`${path.sep}categories.mjs`)
    ) {
      offenders.push(`${path.relative(ROOT, file)} startsWith`);
    }
  }
  assert.deepEqual(offenders, []);
  const categories = fs.readFileSync(path.join(ROOT, "app/lib/categories.mjs"), "utf8");
  assert.match(categories, /if \(isDeathUnconfirmed\(key\)\) return false;/);
  const schema = fs.readFileSync(path.join(ROOT, "scripts/bootstrap-db.sql"), "utf8");
  assert.match(schema, /people_death_date_confirmed/);
  assert.match(schema, /category = 'death_unconfirmed' AND death_date IS NULL/);
  assert.match(schema, /person_events_event_date_kind/);
  assert.match(schema, /event_date IS NOT NULL OR kind = 'death_unconfirmed'/);
  assert.doesNotMatch(schema, /LIKE 'death_%'/);
  for (const rel of ["tests/app.test.mjs", "tests/page-size.test.mjs"]) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(text.includes('startsWith("death_")'), false, rel);
    assert.match(text, /DEATH_KEEP_IDS/);
  }
});

test("leads are never auto-classified into death_unconfirmed", () => {
  assert.equal(mapImportCategory("death_unconfirmed"), null);
  assert.equal(mapImportCategory("death"), "death_unspecified");
  assert.equal(mapLeadReason("death_unconfirmed"), null);
  assert.equal(mapLeadReason("unconfirmed death"), null);
  assert.equal(mapLeadReason("Dead", { tags: ["celebrity", "official"] }), null);
  assert.equal(mapLeadReason("Dead", { tags: ["celebrity"] }), "death_celebrity");
  assert.equal(
    eventFromLead(
      { reason: "Dead", event_date: "2024-01-01", tags: ["celebrity"] },
      { kind: "death_unconfirmed" },
    ).kind,
    "death_celebrity",
  );
  assert.equal(
    eventFromLead({ reason: "unconfirmed death", event_date: "2024-01-01" }),
    null,
  );
  assert.equal(
    classifyDigestText("Officials say the public figure dies aged 81").import_category,
    "death_unspecified",
  );
  assert.equal(
    classifyDigestText("A social post claims a death without confirmation").import_category,
    null,
  );
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Riley North",
        event_date: "2024-06-01",
        category: "death_unconfirmed",
        cite_urls: [
          "https://www.example.com/news/one",
          "https://www.example.net/world/two",
        ],
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
});

test("cite gate parks a footnote without inventing death_date, cause, or location", () => {
  assert.equal(
    DEATH_UNCONFIRMED_FOOTNOTE,
    "Trump Truth Social claim; no media confirmation yet.",
  );
  const parked = deathUnconfirmedEvent({
    comments: DEATH_UNCONFIRMED_FOOTNOTE,
    sources: [CITE],
    event_date: null,
  });
  assert.equal(parked.kind, "death_unconfirmed");
  assert.equal(parked.event_date, null);
  assert.equal(parked.comments, DEATH_UNCONFIRMED_FOOTNOTE);
  assert.equal(parked.country, "");
  assert.equal(parked.cause, undefined);
  assert.equal(parked.death_date, undefined);
  assert.equal(parked.location, undefined);
  assert.deepEqual(parked.sources, [CITE]);

  const month = deathUnconfirmedEvent({ event_date: "2024-02", comments: "partial" });
  assert.equal(month.event_date, null);
  const dated = deathUnconfirmedEvent({
    event_date: "2024-02-02",
    comments: DEATH_UNCONFIRMED_FOOTNOTE,
    sources: [CITE],
  });
  assert.equal(dated.event_date, "2024-02-02");
  assert.equal(dated.death_date, undefined);

  assert.equal(
    confirmedDeathUpgradeGate({
      kind: "death_unconfirmed",
      officialCites: ["https://www.example.com/a", "https://www.example.net/b"],
      eventDate: "2024-02-02",
      clear: true,
    }),
    false,
  );
  assert.equal(
    confirmedDeathUpgradeGate({
      kind: "death_official",
      officialCites: ["https://www.example.com/a"],
      eventDate: "2024-02-02",
      clear: true,
    }),
    false,
  );
  assert.equal(
    confirmedDeathUpgradeGate({
      kind: "death_official",
      officialCites: ["https://www.example.com/a", "https://www.example.net/b"],
      eventDate: null,
      clear: true,
    }),
    false,
  );
  assert.equal(
    confirmedDeathUpgradeGate({
      kind: "death_official",
      officialCites: ["https://www.example.com/a", "https://www.example.net/b"],
      eventDate: "2024-02-02",
      clear: false,
    }),
    false,
  );
  assert.equal(
    confirmedDeathUpgradeGate({
      kind: "death_celebrity",
      officialCites: ["https://www.example.com/a", "https://www.example.net/b"],
      eventDate: "2024-02-02",
      clear: true,
    }),
    true,
  );
});

test("one person card holds the firing and the unconfirmed claim", () => {
  const host = hostPerson();
  assert.notEqual(host.id, "joe-biden");
  const attached = attachPersonEvent(
    host,
    deathUnconfirmedEvent({
      comments: DEATH_UNCONFIRMED_FOOTNOTE,
      sources: [CITE],
      event_date: null,
    }),
  );
  assert.equal(attached.existed, false);
  assert.equal(attached.person.id, host.id);
  assert.equal(attached.person.death_date, null);
  assert.equal(attached.person.category, "firings");
  const kinds = attached.person.events.map((ev) => ev.kind).sort();
  assert.deepEqual(kinds, ["death_unconfirmed", "firings"]);
  const claim = attached.person.events.find((ev) => ev.kind === "death_unconfirmed");
  assert.equal(claim.event_date, null);
  assert.equal(claim.comments, DEATH_UNCONFIRMED_FOOTNOTE);
  assert.equal(claim.country, "");

  const filled = attachPersonEvent(
    attached.person,
    deathUnconfirmedEvent({
      comments: "later note",
      sources: [CITE],
      event_date: "2024-07-04",
    }),
  );
  const filledClaim = filled.person.events.find((ev) => ev.kind === "death_unconfirmed");
  assert.equal(filledClaim.event_date, "2024-07-04");
  assert.equal(filledClaim.comments, DEATH_UNCONFIRMED_FOOTNOTE);
  assert.equal(filled.person.death_date, null);
  assert.equal(filled.person.id, host.id);

  const html = personDetail(attached.person);
  assert.equal((html.match(/class="event-tag-row"/g) || []).length, 2);
  assert.match(html, /data-kind="firings"/);
  assert.match(html, /data-kind="death_unconfirmed"/);
  assert.match(html, />Death\*</);
  assert.match(html, /Footnote/);
  assert.match(html, /Trump Truth Social claim; no media confirmation yet\./);
  assert.match(html, /truthsocial\.com/);
  assert.doesNotMatch(html, /data-kind="death_celebrity"/);
  assert.doesNotMatch(html, /data-kind="death_official"/);
  assert.doesNotMatch(html, /data-kind="death_ceo"/);
});

test("confirmed death counts and /deaths exclude death_unconfirmed", async () => {
  const seedBytes = fs.readFileSync(SEED_PATH);
  const seed = goldSeed();
  setMemory(seed);
  const confirmed = await countPeople(DEATH_KEEP_IDS);
  const celebCount = await countPeople("death_celebrity");
  const officialCount = await countPeople("death_official");
  const ceoCount = await countPeople("death_ceo");
  const host = hostPerson();
  const multi = attachPersonEvent(
    host,
    deathUnconfirmedEvent({
      comments: DEATH_UNCONFIRMED_FOOTNOTE,
      sources: [CITE],
    }),
  ).person;
  const claimOnly = {
    id: "claim-only",
    category: "death_unconfirmed",
    name: "Claim Only",
    role: "",
    event_date: null,
    death_date: "1999-01-01",
    sources: [CITE],
    events: [
      deathUnconfirmedEvent({
        comments: DEATH_UNCONFIRMED_FOOTNOTE,
        sources: [CITE],
        event_date: null,
      }),
    ],
  };
  const datedClaim = {
    id: "dated-claim",
    category: "death_unconfirmed",
    name: "Dated Claim",
    role: "",
    event_date: "2024-02-02",
    death_date: "2024-02-02",
    sources: [CITE],
    events: [
      deathUnconfirmedEvent({
        comments: DEATH_UNCONFIRMED_FOOTNOTE,
        sources: [CITE],
        event_date: "2024-02-02",
      }),
    ],
  };
  setMemory({
    ...seed,
    people: [...seed.people, multi, claimOnly, datedClaim],
  });

  assert.equal(await countPeople(DEATH_KEEP_IDS), confirmed);
  assert.equal(await countPeople("death_celebrity"), celebCount);
  assert.equal(await countPeople("death_official"), officialCount);
  assert.equal(await countPeople("death_ceo"), ceoCount);
  assert.equal(await countPeople(DEATH_UNCONFIRMED_ID), 3);

  const claim = await getPerson("claim-only");
  assert.equal(claim.death_date, null);
  assert.equal(claim.event_date, null);
  assert.equal(claim.events.find((ev) => ev.kind === "death_unconfirmed").event_date, null);
  const dated = await getPerson("dated-claim");
  assert.equal(dated.death_date, null);
  assert.equal(dated.event_date, "2024-02-02");
  assert.equal(dated.category, "death_unconfirmed");

  const parent = await requestPage("/deaths");
  const celebs = await requestPage("/deaths/celebrities");
  const officials = await requestPage("/deaths/officials");
  const ceos = await requestPage("/deaths/ceos");
  const unconfirmed = await requestPage("/deaths/unconfirmed");
  assert.equal(parent.status, 200);
  assert.match(parent.body, new RegExp(`${confirmed} available`));
  assert.doesNotMatch(parent.body, /Claim Only/);
  assert.doesNotMatch(parent.body, /Dated Claim/);
  assert.doesNotMatch(parent.body, /Riley North/);
  for (const res of [celebs, officials, ceos]) {
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body, /Claim Only/);
    assert.doesNotMatch(res.body, /href="\/people\/claim-only"/);
    assert.doesNotMatch(res.body, /href="\/people\/dated-claim"/);
  }
  assert.match(celebs.body, /value="\/deaths\/unconfirmed"/);

  assert.equal(unconfirmed.status, 200);
  assert.match(unconfirmed.body, /3 available/);
  assert.match(unconfirmed.body, /value="\/deaths\/unconfirmed" selected/);
  assert.match(unconfirmed.body, />Unconfirmed\*</);
  assert.match(unconfirmed.body, /href="\/people\/riley-north"/);
  assert.match(unconfirmed.body, /href="\/people\/claim-only"/);
  assert.match(unconfirmed.body, /href="\/people\/dated-claim"/);
  assert.match(unconfirmed.body, /datetime="2024-02-02"/);
  assert.doesNotMatch(unconfirmed.body, /datetime="1999-01-01"/);

  const detail = await requestPage("/people/claim-only");
  assert.equal(detail.status, 200);
  assert.match(detail.body, />Death\*</);
  assert.match(detail.body, /Footnote/);
  assert.match(detail.body, /Trump Truth Social claim; no media confirmation yet\./);
  assert.match(detail.body, new RegExp(CLAIM_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(detail.body, /href="\/deaths\/unconfirmed"/);
  assert.doesNotMatch(detail.body, /1999-01-01/);
  assert.equal((detail.body.match(/class="event-tag-row"/g) || []).length, 1);

  const multiPage = await requestPage("/people/riley-north");
  assert.match(multiPage.body, /data-kind="firings"/);
  assert.match(multiPage.body, /data-kind="death_unconfirmed"/);
  assert.match(multiPage.body, />Death\*</);
  assert.equal((multiPage.body.match(/class="detail person-detail"/g) || []).length, 1);

  const people = [multi, claim, dated];
  assert.equal(countDeathUnconfirmed(people, { id: "all" }), 3);
  assert.equal(countDeathUnconfirmed(people, { id: "30d" }), 0);
  const dashPeople = await listPeople();
  const model = buildDashboard(dashPeople, { id: "all" });
  assert.equal(model.unconfirmed, 3);
  const reason = model.dimensions.find((dim) => dim.id === "reason");
  assert.ok(reason.ranked.some((row) => row.key === "firings"));
  assert.equal(
    reason.ranked.some((row) => row.key === "death_unconfirmed"),
    false,
  );
  assert.equal(
    rankDimension(dashPeople, "reason").some((row) => row.key === "death_unconfirmed"),
    false,
  );
  for (const row of reason.ranked) {
    if (String(row.key).startsWith("death_")) {
      assert.ok(DEATH_KEEP_IDS.includes(row.key), row.key);
    }
  }

  const dash = await requestPage("/dashboard");
  assert.equal(dash.status, 200);
  assert.match(dash.body, /href="\/deaths\/unconfirmed"/);
  assert.match(dash.body, /Unconfirmed\*/);
  assert.match(dash.body, /data-death-unconfirmed="3"/);

  assert.ok(seedBytes.equals(fs.readFileSync(SEED_PATH)));
  assert.equal(fs.readFileSync(SEED_PATH, "utf8").includes('"death_unconfirmed"'), false);
});
