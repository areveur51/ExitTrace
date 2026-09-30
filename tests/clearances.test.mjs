import assert from "node:assert/strict";
import { test } from "node:test";
import { personDetail, personHeader } from "../app/lib/html.mjs";
import { normalizeClearances } from "../app/lib/clearances.mjs";
import { applyIdentifiedPerson, ensurePersonClearances, getPerson, setMemory } from "../app/lib/store.mjs";
import { LOCK_MEDIA_DIR, LOCK_PORTRAIT, NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const GOVINFO = "https://www.govinfo.gov/content/pkg/FR-2025-01-29/html/2025-01954.htm";
const WHITEHOUSE =
  "https://www.whitehouse.gov/presidential-actions/2025/01/holding-former-government-officials-accountablefor-election-interference-and-improper-disclosure-of-sensitive-governmental-information/";

const CITES = [
  {
    url: GOVINFO,
    publisher: "Federal Register",
    date: "2025-01-20",
    snippet: "shall revoke any current or active clearances held by the following individuals",
  },
  {
    url: WHITEHOUSE,
    publisher: "The White House",
    date: "2025-01-20",
    snippet: "Signatories of the letter falsely suggested that the news story was part of a Russian disinformation campaign.",
  },
];

const REVOKED = [
  {
    status: "revoked",
    date: "2025-01-20",
    authority: "Executive Order 14152",
    role: "Former intelligence official",
    scope: "any current or active security clearances",
    sources: CITES,
  },
];

test("a clearance fact without two official cites is dropped", () => {
  assert.deepEqual(normalizeClearances(undefined), []);
  assert.deepEqual(
    normalizeClearances([
      {
        status: "revoked",
        date: "2025-01-20",
        authority: "Executive Order 14152",
        sources: [{ url: GOVINFO }],
      },
    ]),
    [],
  );
  assert.equal(
    normalizeClearances([
      {
        status: "revoked",
        date: "2025-01-20",
        authority: "Executive Order 14152",
        sources: [
          { url: "https://en.wikipedia.org/wiki/James_Clapper" },
          { url: GOVINFO },
        ],
      },
    ]).length,
    0,
  );
  assert.equal(normalizeClearances([{ status: "suspended", date: "2025-01-20", authority: "Memo", sources: CITES }]).length, 0);
});

test("detail page shows a cited clearance revocation and hides the line when empty", async () => {
  setMemory({ people: [], operations: [], source_posts: [] });
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: [
      "https://www.example.com/news/casey-vale-held",
      "https://www.example.net/world/casey-vale-arrest",
    ],
    role: "Anchor",
    clearances: REVOKED,
  });
  const person = await getPerson("casey-vale");
  assert.equal(person.clearances[0].status, "revoked");
  assert.equal(person.clearances[0].date, "2025-01-20");
  assert.equal(person.clearances[0].authority, "Executive Order 14152");
  const header = personHeader(person);
  assert.match(header, /Security clearance · Revoked · Jan 20, 2025/);
  const html = personDetail(person);
  assert.match(html, /data-kind="clearance"/);
  assert.match(html, /govinfo\.gov/);
  assert.match(html, /falsely suggested/);
  assert.doesNotMatch(personHeader({ name: "Casey Vale", clearances: [] }), /Security clearance/);
});

test("clearance update leaves the exit card alone and creates a card when the person is missing", async () => {
  setMemory({
    people: [
      {
        id: "john-brennan",
        category: "corona_comms",
        name: "John Brennan",
        role: "Former CIA director",
        event_date: "2020-04-08",
        death_date: null,
        country_of_origin: "USA",
        photo: "/media/people/john-brennan.jpg",
        events: [{ kind: "corona_comms", event_date: "2020-04-08", sources: [] }],
        sources: [],
        tags: [],
        career: [],
        nicknames: [],
        clearances: [],
      },
    ],
    operations: [],
    source_posts: [],
  });
  const updated = await ensurePersonClearances({ subject: "John Brennan", clearances: REVOKED });
  assert.equal(updated.action, "updated");
  assert.equal(updated.person.category, "corona_comms");
  assert.equal(String(updated.person.event_date).slice(0, 10), "2020-04-08");
  assert.equal(updated.person.photo, "/media/people/john-brennan.jpg");
  assert.equal(updated.person.country_of_origin, "USA");
  assert.equal(updated.person.role, "Former CIA director");
  assert.equal(updated.person.clearances[0].status, "revoked");

  await applyIdentifiedPerson({
    subject: "John Brennan",
    event_date: "2024-08-01",
    category: "resignations",
    cite_urls: [
      "https://www.example.com/news/john-brennan-quit",
      "https://www.example.net/world/john-brennan-resigned",
    ],
  });
  const again = await getPerson("john-brennan");
  assert.equal(again.clearances[0].authority, "Executive Order 14152");
  assert.equal(again.photo, "/media/people/john-brennan.jpg");

  await assert.rejects(
    () => ensurePersonClearances({ subject: "James R. Clapper Jr.", clearances: [{ status: "revoked", sources: [] }] }),
    /two official/,
  );
  assert.equal(await getPerson("james-r-clapper-jr"), null);

  const cited = {
    subject: "James R. Clapper Jr.",
    role: "Former intelligence official",
    clearances: REVOKED,
  };
  await assert.rejects(
    () => ensurePersonClearances(cited),
    (err) => err.code === "missing_portrait",
  );
  assert.equal(await getPerson("james-r-clapper-jr"), null);

  const created = await ensurePersonClearances({
    ...cited,
    photo: LOCK_PORTRAIT,
    photo_credit: "Test portrait",
    mediaDir: LOCK_MEDIA_DIR,
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.id, "james-r-clapper-jr");
  assert.equal(created.person.category, "clearance");
  assert.equal(created.person.country_of_origin, "");
  assert.equal(String(created.person.event_date).slice(0, 10), "2025-01-20");
  assert.equal(created.person.photo, "/media/people/james-r-clapper-jr.jpg");
  assert.equal(created.person.events[0].kind, "clearance");
  assert.equal(created.person.events[0].sources.length, 0);
  const detail = personDetail(created.person);
  assert.match(detail, /Security clearance · Revoked · Jan 20, 2025/);
  assert.equal(detail.match(/data-kind="clearance"/g).length, 1);
  assert.match(personDetail(created.person), /data-kind="clearance"/);
  assert.doesNotMatch(personDetail(created.person), /lied/);
});
