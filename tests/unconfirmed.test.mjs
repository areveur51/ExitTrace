/** General unconfirmed person event. death_unconfirmed stays as it is. */

import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import {
  DEATH_UNCONFIRMED_ID,
  PROMOTE_CATEGORY_IDS,
  UNCONFIRMED_ID,
  isDeathCategory,
  isDeathUnconfirmed,
  isDisplayedEventKind,
  isUnconfirmed,
  mapImportCategory,
  mayOmitEventDate,
} from "../app/lib/categories.mjs";
import {
  buildDashboard,
  countDeathUnconfirmed,
  countPersonEventsInRange,
  rankDimension,
  unconfirmedStanding,
} from "../app/lib/dashboard.mjs";
import { listPathForPerson } from "../app/lib/display-check.mjs";
import {
  DEATH_UNCONFIRMED_FOOTNOTE,
  deathUnconfirmedEvent,
  eventFromLead,
  mapLeadReason,
  normalizeUnconfirmedSubject,
  unconfirmedEvent,
  unconfirmedSubjectLabel,
} from "../app/lib/event-attrs.mjs";
import { buildUpsertSql } from "../app/lib/gap-upsert.mjs";
import { dashboardBody, personDetail } from "../app/lib/html.mjs";
import { PromoteError, attachPersonEvent, validateIdentifiedPersonInput } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { getPerson, loadSeedFile, setMemory } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = path.join(ROOT, "data", "seed.json");
const CITE = {
  title: "Desk note",
  publisher: "Example News",
  url: "https://www.example.com/news/masks",
  date: "2024-06-02",
};

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

test("unconfirmed is a person event, not a death or a promote kind", () => {
  assert.equal(UNCONFIRMED_ID, "unconfirmed");
  assert.equal(isUnconfirmed("unconfirmed"), true);
  assert.equal(isUnconfirmed(DEATH_UNCONFIRMED_ID), false);
  assert.equal(isDeathUnconfirmed(UNCONFIRMED_ID), false);
  assert.equal(isDeathCategory(UNCONFIRMED_ID), false);
  assert.equal(isDisplayedEventKind(UNCONFIRMED_ID), true);
  assert.equal(mayOmitEventDate(UNCONFIRMED_ID), true);
  assert.equal(mayOmitEventDate(DEATH_UNCONFIRMED_ID), true);
  assert.equal(mayOmitEventDate("firings"), false);
  assert.equal(PROMOTE_CATEGORY_IDS.includes(UNCONFIRMED_ID), false);
  assert.equal(listPathForPerson(UNCONFIRMED_ID), null);
  assert.equal(mapImportCategory("unconfirmed"), null);
  assert.equal(mapImportCategory("masks"), null);
  assert.equal(mapLeadReason("unconfirmed"), null);
  assert.equal(mapLeadReason("masks"), null);
  assert.equal(eventFromLead({ reason: "unconfirmed", event_date: "2024-06-01" }), null);
  assert.equal(normalizeUnconfirmedSubject("  Masks "), "masks");
  assert.equal(normalizeUnconfirmedSubject("face masks"), "face masks");
  assert.equal(unconfirmedSubjectLabel("masks"), "Masks");
  assert.equal(unconfirmedSubjectLabel("face masks"), "Face Masks");
  assert.equal(normalizeUnconfirmedSubject(""), "");
  assert.equal(normalizeUnconfirmedSubject("not a confirmed death"), "");
  assert.equal(unconfirmedEvent({}), null);
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Riley North",
        event_date: "2024-06-01",
        category: "unconfirmed",
        cite_urls: [
          "https://www.example.com/news/one",
          "https://www.example.net/world/two",
        ],
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
});

test("the subject reuses comments and the card shows Unconfirmed: Masks", () => {
  const parked = unconfirmedEvent({
    subject: "Masks",
    sources: [CITE],
    event_date: null,
  });
  assert.equal(parked.kind, "unconfirmed");
  assert.equal(parked.event_date, null);
  assert.equal(parked.comments, "masks");
  assert.equal(parked.subject, undefined);

  const host = hostPerson();
  const attached = attachPersonEvent(host, parked);
  assert.equal(attached.person.id, host.id);
  assert.equal(attached.person.category, "firings");
  assert.equal(attached.person.death_date, null);
  assert.equal(attached.person.event_date, "2024-06-01");
  const claim = attached.person.events.find((ev) => ev.kind === "unconfirmed");
  assert.equal(claim.comments, "masks");
  assert.equal(claim.event_date, null);

  const filled = attachPersonEvent(
    attached.person,
    unconfirmedEvent({
      subject: "boots",
      sources: [CITE],
      event_date: "2024-07-04",
    }),
  );
  const filledClaim = filled.person.events.find((ev) => ev.kind === "unconfirmed");
  assert.equal(filledClaim.comments, "masks");
  assert.equal(filledClaim.event_date, "2024-07-04");
  assert.equal(filled.person.category, "firings");

  const withDeath = attachPersonEvent(
    attached.person,
    deathUnconfirmedEvent({
      comments: DEATH_UNCONFIRMED_FOOTNOTE,
      sources: [CITE],
      event_date: null,
    }),
  ).person;
  const html = personDetail(withDeath);
  const rows = html.match(/<article class="event-tag-row"[\s\S]*?<\/article>/g) || [];
  const claimRow = rows.find((row) => row.includes('data-kind="unconfirmed"'));
  const deathRow = rows.find((row) => row.includes('data-kind="death_unconfirmed"'));
  assert.ok(claimRow);
  assert.ok(deathRow);
  assert.match(claimRow, /class="event-badge" data-unconfirmed="masks">Unconfirmed<\/span>: Masks/);
  assert.doesNotMatch(claimRow, /event-oneline/);
  assert.doesNotMatch(claimRow, /Not a confirmed/);
  assert.doesNotMatch(claimRow, /disclaimer/i);
  assert.match(deathRow, />Death\*</);
  assert.match(deathRow, /class="event-oneline">Trump Truth Social claim; no media confirmation yet\./);
  assert.match(html, /data-kind="firings"/);
  assert.doesNotMatch(html, /data-kind="death_celebrity"/);

  assert.throws(
    () => attachPersonEvent(host, { kind: "unconfirmed", event_date: null, comments: "" }),
    (err) => err instanceof PromoteError && err.code === "missing_subject",
  );
});

test("dashboard total sums deaths and each other subject", () => {
  const deathOnly = {
    id: "death-only",
    category: "death_unconfirmed",
    name: "Death Only",
    event_date: null,
    events: [deathUnconfirmedEvent({ comments: DEATH_UNCONFIRMED_FOOTNOTE, sources: [CITE] })],
  };
  const both = attachPersonEvent(
    attachPersonEvent(
      hostPerson(),
      unconfirmedEvent({ subject: "masks", sources: [CITE] }),
    ).person,
    deathUnconfirmedEvent({ comments: DEATH_UNCONFIRMED_FOOTNOTE, sources: [CITE] }),
  ).person;
  const boots = {
    id: "ada-boots",
    category: "resignations",
    name: "Ada Boots",
    event_date: "2024-03-01",
    events: [
      {
        kind: "resignations",
        event_date: "2024-03-01",
        sources: [CITE],
      },
      unconfirmedEvent({
        subject: "Masks",
        sources: [CITE],
        event_date: "2026-10-01",
      }),
    ],
  };
  const datedBoots = {
    id: "beau-boots",
    category: "arrests",
    name: "Beau Boots",
    event_date: "2024-04-01",
    events: [
      { kind: "arrests", event_date: "2024-04-01", sources: [CITE] },
      unconfirmedEvent({ subject: "boots", sources: [CITE], event_date: "2024-04-02" }),
    ],
  };
  const people = [deathOnly, both, boots, datedBoots];
  assert.equal(countDeathUnconfirmed(people, { id: "all" }), 2);
  assert.equal(
    countPersonEventsInRange(people, { id: "all" }, (item) => isDeathUnconfirmed(item.kind)),
    countDeathUnconfirmed(people, { id: "all" }),
  );
  const standing = unconfirmedStanding(people, { id: "all" });
  assert.equal(standing.deaths, 2);
  assert.deepEqual(
    standing.subjects.map((row) => [row.key, row.label, row.count]),
    [
      ["masks", "Masks", 2],
      ["boots", "Boots", 1],
    ],
  );
  assert.equal(standing.total, 5);

  const ranged = unconfirmedStanding(people, {
    id: "custom",
    from: "2026-09-01",
    to: "2026-10-14",
  });
  assert.equal(ranged.deaths, 0);
  assert.deepEqual(ranged.subjects, [{ key: "masks", label: "Masks", count: 1 }]);
  assert.equal(ranged.total, 1);
  assert.equal(countDeathUnconfirmed(people, { id: "30d" }), 0);

  const model = buildDashboard(people, { id: "all" });
  assert.equal(model.unconfirmed, 2);
  assert.equal(model.unconfirmedAll.total, 5);
  assert.equal(
    rankDimension(people, "reason").some((row) => row.key === "unconfirmed" || row.key === "death_unconfirmed"),
    false,
  );
  const html = dashboardBody(model, { path: "/dashboard", range: { id: "all" } });
  assert.match(html, /data-death-unconfirmed="2"/);
  assert.match(html, /Unconfirmed\*/);
  assert.match(html, /data-unconfirmed-total="5"/);
  assert.match(html, /data-unconfirmed-subject="deaths"[^>]*data-unconfirmed-count="2"/);
  assert.match(html, /data-unconfirmed-subject="masks"[^>]*data-unconfirmed-count="2"/);
  assert.match(html, /data-unconfirmed-subject="boots"[^>]*data-unconfirmed-count="1"/);
  assert.match(html, /href="\/deaths\/unconfirmed"/);
  assert.match(html, />Unconfirmed · 5</);
});

test("unconfirmed streams on the existing person_events gap upsert", () => {
  const schema = fs.readFileSync(path.join(ROOT, "scripts/bootstrap-db.sql"), "utf8");
  assert.match(schema, /ADD COLUMN IF NOT EXISTS comments TEXT/);
  assert.doesNotMatch(schema, /ADD COLUMN IF NOT EXISTS subject/);
  assert.match(
    schema,
    /event_date IS NOT NULL OR kind = 'death_unconfirmed' OR kind = 'unconfirmed'/,
  );
  const built = buildUpsertSql("person_events", [
    {
      person_id: "riley-north",
      kind: "unconfirmed",
      event_date: null,
      sources: [CITE],
      comments: "masks",
    },
  ]);
  assert.match(built.sql, /INSERT INTO person_events \(/);
  assert.match(built.sql, /\bcomments\b/);
  assert.match(built.sql, /ON CONFLICT \(person_id, kind\) DO UPDATE SET/);
  assert.equal(built.params[1], "unconfirmed");
  assert.equal(built.params[2], null);
  assert.equal(built.params[9], "masks");
  assert.doesNotMatch(built.sql, /DELETE/);
  assert.doesNotMatch(built.sql, /TRUNCATE/);
});

test("the person page shows the badge and the dashboard total", async () => {
  const seedBytes = fs.readFileSync(SEED_PATH);
  const seed = loadSeedFile(SEED_PATH);
  const person = attachPersonEvent(
    hostPerson(),
    unconfirmedEvent({ subject: "masks", sources: [CITE] }),
  ).person;
  setMemory({ ...seed, people: [...seed.people, person] });
  const page = await requestPage("/people/riley-north");
  assert.equal(page.status, 200);
  assert.match(page.body, /data-kind="unconfirmed"/);
  assert.match(page.body, /data-unconfirmed="masks">Unconfirmed<\/span>: Masks/);
  const claim = page.body.match(
    /<article class="event-tag-row" data-kind="unconfirmed"[\s\S]*?<\/article>/,
  );
  assert.ok(claim);
  assert.doesNotMatch(claim[0], /event-oneline/);
  assert.doesNotMatch(claim[0], /Not a confirmed/);
  const dash = await requestPage("/dashboard");
  assert.equal(dash.status, 200);
  assert.match(dash.body, /data-unconfirmed-total="1"/);
  assert.match(dash.body, /data-unconfirmed-subject="masks"/);
  assert.match(dash.body, /Unconfirmed\*/);
  const stored = await getPerson("riley-north");
  assert.equal(stored.category, "firings");
  assert.equal(stored.events.find((ev) => ev.kind === "unconfirmed").comments, "masks");
  assert.ok(seedBytes.equals(fs.readFileSync(SEED_PATH)));
});
