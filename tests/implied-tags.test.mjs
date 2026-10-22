import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpsertSql, pickRow } from "../app/lib/gap-upsert.mjs";
import { projectPerson } from "../app/lib/promote.mjs";
import { getPerson, insertPerson, listPeople, savePerson, setMemory, setTestPool } from "../app/lib/store.mjs";
import {
  FORMER_INTEL_EXCLUDE,
  IMPLIED_TAGS,
  isIntelAgencyText,
  matchesTags,
  normalizeTags,
  personTags,
  withImpliedTags,
} from "../app/lib/tags.mjs";

const REVOKED = "clearance_revoked";
const INTEL = "former_intel_agency_personnel";

const CITES = [
  {
    url: "https://www.govinfo.gov/content/pkg/FR-2025-01-29/html/2025-01954.htm",
    publisher: "Federal Register",
    date: "2025-01-20",
    snippet: "shall revoke any current or active clearances held by the following individuals",
  },
  {
    url: "https://www.whitehouse.gov/presidential-actions/2025/01/holding-former-government-officials-accountablefor-election-interference-and-improper-disclosure-of-sensitive-governmental-information/",
    publisher: "The White House",
    date: "2025-01-20",
    snippet: "Signatories of the letter falsely suggested that the news story was part of a Russian disinformation campaign.",
  },
];

function ciaCareer() {
  return [{ title: "Analyst", organization: "Central Intelligence Agency", start_year: 1990, end_year: 2004 }];
}

function clearanceRole(role) {
  return [
    {
      status: "revoked",
      date: "2025-01-20",
      authority: "Executive Order 14152",
      role,
      sources: CITES,
    },
  ];
}

function clearanceCard(id, tags, extra = {}) {
  return {
    id,
    name: id,
    category: "clearance",
    event_date: "2025-01-20",
    events: [{ kind: "clearance", event_date: "2025-01-20", sources: [] }],
    sources: [],
    tags,
    career: [],
    nicknames: [],
    clearances: [],
    ...extra,
  };
}

test("withImpliedTags without a row is a pure pass-through", () => {
  assert.deepEqual(IMPLIED_TAGS[REVOKED], [INTEL]);
  assert.deepEqual(withImpliedTags([REVOKED]), [REVOKED]);
  assert.deepEqual(withImpliedTags(["official", REVOKED, "non_civilian"]), ["official", REVOKED, "non_civilian"]);
  assert.deepEqual(withImpliedTags(["clearance-revoked"]), ["clearance-revoked"]);
  assert.deepEqual(withImpliedTags([REVOKED, INTEL]), [REVOKED, INTEL]);
  assert.deepEqual(withImpliedTags([INTEL]), [INTEL]);
  assert.deepEqual(withImpliedTags(["official"]), ["official"]);
  assert.deepEqual(withImpliedTags([]), []);
  assert.deepEqual(withImpliedTags(null), []);
  const input = [REVOKED];
  withImpliedTags(input);
  assert.deepEqual(input, [REVOKED]);
  const copy = withImpliedTags(input, undefined);
  copy.push("x");
  assert.deepEqual(input, [REVOKED]);
});

test("revoked plus an intel career row adds Former intel", () => {
  const row = { id: "jane-roe", career: ciaCareer() };
  assert.deepEqual(withImpliedTags([REVOKED], row), [REVOKED, INTEL]);
  assert.deepEqual(withImpliedTags(["official", REVOKED, "non_civilian"], row), [
    "official",
    REVOKED,
    "non_civilian",
    INTEL,
  ]);
  assert.deepEqual(withImpliedTags(["clearance-revoked"], row), ["clearance-revoked", INTEL]);
  assert.deepEqual(withImpliedTags([REVOKED, INTEL], row), [REVOKED, INTEL]);
  assert.deepEqual(withImpliedTags([INTEL, REVOKED], row), [INTEL, REVOKED]);
  assert.deepEqual(withImpliedTags(withImpliedTags([REVOKED], row), row), [REVOKED, INTEL]);
  assert.deepEqual(personTags({ id: "jane-roe", tags: [REVOKED], career: ciaCareer() }), [REVOKED, INTEL]);
  assert.deepEqual(
    projectPerson(clearanceCard("jane-roe", [REVOKED], { career: ciaCareer() })).tags,
    [REVOKED, INTEL],
  );
});

test("revoked plus a clearance role naming an intel agency adds Former intel", () => {
  assert.deepEqual(
    withImpliedTags([REVOKED], { id: "a", clearances: clearanceRole("Former intelligence official") }),
    [REVOKED, INTEL],
  );
  assert.deepEqual(
    withImpliedTags([REVOKED], { id: "a", clearances: clearanceRole("Former CIA Director") }),
    [REVOKED, INTEL],
  );
  assert.deepEqual(
    personTags({
      id: "james-clapper",
      tags: [REVOKED],
      clearances: clearanceRole("Former Director of National Intelligence"),
    }),
    [REVOKED, INTEL],
  );
});

test("revoked with no intel role does not add Former intel", () => {
  const nsaAdvisor = { id: "a", clearances: clearanceRole("Former National Security Advisor") };
  assert.deepEqual(withImpliedTags([REVOKED], nsaAdvisor), [REVOKED]);
  assert.deepEqual(personTags({ tags: [REVOKED], ...nsaAdvisor }), [REVOKED]);
  assert.deepEqual(
    projectPerson(clearanceCard("x", [REVOKED], { clearances: clearanceRole("Former National Security Advisor") })).tags,
    [REVOKED],
  );
  assert.deepEqual(personTags({ category: "clearance", tags: [REVOKED] }), [REVOKED]);
});

test("john-bolton is excluded even with a revoked clearance", () => {
  assert.deepEqual(FORMER_INTEL_EXCLUDE, ["john-bolton"]);
  const row = {
    id: "john-bolton",
    tags: [REVOKED],
    clearances: clearanceRole("Former National Security Advisor"),
  };
  assert.deepEqual(withImpliedTags([REVOKED], row), [REVOKED]);
  assert.deepEqual(withImpliedTags(["clearance-revoked"], row), ["clearance-revoked"]);
  assert.deepEqual(personTags(row), [REVOKED]);
  assert.deepEqual(
    projectPerson(
      clearanceCard("john-bolton", [REVOKED], {
        clearances: clearanceRole("Former National Security Advisor"),
      }),
    ).tags,
    [REVOKED],
  );
});

test("john-bolton with a stored Former intel tag is dropped on write", () => {
  const row = { id: "john-bolton", tags: [REVOKED, INTEL] };
  assert.deepEqual(withImpliedTags([REVOKED, INTEL], row), [REVOKED]);
  assert.deepEqual(withImpliedTags(["former-intel-agency-personnel", REVOKED], row), [REVOKED]);
  assert.deepEqual(personTags(row), [REVOKED]);
  assert.equal(pickRow("people", row).tags, JSON.stringify([REVOKED]));
  assert.equal(
    pickRow("people", { id: "john-bolton", tags: JSON.stringify([REVOKED, INTEL]) }).tags,
    JSON.stringify([REVOKED]),
  );
});

test("a non-excluded card that already stores Former intel keeps it (add-only)", () => {
  const stored = { id: "gina-haspel", tags: [INTEL] };
  assert.deepEqual(withImpliedTags([INTEL], stored), [INTEL]);
  assert.deepEqual(withImpliedTags([REVOKED, INTEL], { id: "gina-haspel" }), [REVOKED, INTEL]);
  assert.deepEqual(personTags(stored), [INTEL]);
  assert.equal(pickRow("people", stored).tags, JSON.stringify([INTEL]));
});

test("withImpliedTags inspects the intel role lazily and at most once", () => {
  const unread = {
    id: "unread",
    get career() {
      throw new Error("career inspected");
    },
    get clearances() {
      throw new Error("clearances inspected");
    },
  };
  assert.deepEqual(withImpliedTags(["official"], unread), ["official"]);
  assert.deepEqual(withImpliedTags([], unread), []);
  assert.deepEqual(withImpliedTags([INTEL], unread), [INTEL]);
  assert.deepEqual(withImpliedTags([INTEL, REVOKED], unread), [INTEL, REVOKED]);
  assert.deepEqual(withImpliedTags(["former-intel-agency-personnel", REVOKED], unread), [
    "former-intel-agency-personnel",
    REVOKED,
  ]);

  let careerReads = 0;
  let clearanceReads = 0;
  const counted = {
    id: "counted",
    get career() {
      careerReads += 1;
      return ciaCareer();
    },
    get clearances() {
      clearanceReads += 1;
      return [];
    },
  };
  assert.deepEqual(withImpliedTags([REVOKED, "official", REVOKED], counted), [
    REVOKED,
    "official",
    REVOKED,
    INTEL,
  ]);
  assert.equal(careerReads, 1);
  assert.equal(clearanceReads, 0);

  let passes = 0;
  const plain = {
    id: "plain",
    get career() {
      passes += 1;
      return [{ title: "Ambassador", organization: "Department of State", start_year: 2010, end_year: 2012 }];
    },
    get clearances() {
      passes += 1;
      return clearanceRole("Former National Security Advisor");
    },
  };
  assert.deepEqual(withImpliedTags([REVOKED, REVOKED], plain), [REVOKED, REVOKED]);
  assert.equal(passes, 2);
});

test("Former intel does not imply a revoked clearance", () => {
  assert.deepEqual(personTags({ tags: [INTEL] }), [INTEL]);
  assert.equal(matchesTags({ tags: [INTEL] }, [REVOKED]), false);
});

test("person tags carry a gated implication; filters do not widen", () => {
  const intel = { id: "a", tags: [REVOKED], career: ciaCareer() };
  assert.equal(matchesTags(intel, [INTEL]), true);
  assert.deepEqual(normalizeTags([REVOKED]), [REVOKED]);
  assert.equal(matchesTags({ tags: [REVOKED] }, [INTEL]), false);
});

test("the intel-agency matcher uses word boundaries and excludes committees", () => {
  for (const text of [
    "CIA",
    "Central Intelligence Agency",
    "NSA",
    "National Security Agency",
    "DIA",
    "Defense Intelligence Agency",
    "ODNI",
    "Director of National Intelligence",
    "Directorate of National Intelligence",
    "DNI",
    "National Counterterrorism Center",
    "NCTC",
    "National Intelligence Council",
    "National Intelligence Officer",
    "NGA",
    "National Geospatial-Intelligence Agency",
    "NRO",
    "National Reconnaissance Office",
    "State INR",
    "Bureau of Intelligence and Research",
    "FBI Intelligence Branch",
    "FBI National Security Branch",
    "Under Secretary of Defense for Intelligence",
    "military intelligence",
    "Army Intelligence",
    "Office of Naval Intelligence",
    "Air Force intelligence",
    "Air Force ISR",
    "Marine Corps Intelligence",
    "intelligence official",
    "intelligence officer",
    "intelligence agency",
    "intelligence community",
    "Former intelligence official",
    "Former CIA Director",
  ]) {
    assert.equal(isIntelAgencyText(text), true, text);
  }
  for (const text of [
    "National Security Advisor",
    "National Security Council",
    "Senate Select Committee on Intelligence",
    "Defense Secretary",
    "Secretary of State",
    "Ambassador",
    "Senate Intelligence Committee staff",
  ]) {
    assert.equal(isIntelAgencyText(text), false, text);
  }
});

test("committee text never counts as an intel agency, even beside a real agency role", () => {
  // Conservative: committee text never counts, by design.
  assert.equal(
    isIntelAgencyText("Former CIA officer; staff, Senate Select Committee on Intelligence"),
    false,
  );
});

test("insert and update store the implied tag only with a recorded intel role", async () => {
  setMemory({ people: [], operations: [], source_posts: [] });
  const inserted = await insertPerson(clearanceCard("jane-roe", [REVOKED], { career: ciaCareer() }));
  assert.deepEqual(inserted.tags, [REVOKED, INTEL]);
  assert.deepEqual((await getPerson("jane-roe")).tags, [REVOKED, INTEL]);

  await insertPerson(clearanceCard("john-roe", ["official"]));
  assert.deepEqual((await getPerson("john-roe")).tags, ["official"]);
  const before = await getPerson("john-roe");
  await savePerson({ ...before, tags: ["official", REVOKED] });
  assert.deepEqual((await getPerson("john-roe")).tags, ["official", REVOKED]);

  const kept = await insertPerson(clearanceCard("gina-haspel", [INTEL]));
  assert.deepEqual(kept.tags, [INTEL]);

  const listed = await listPeople({ tags: [INTEL] });
  assert.deepEqual(listed.map((r) => r.id).sort(), ["gina-haspel", "jane-roe"]);
  setMemory({ people: [], operations: [], source_posts: [] });
});

test("john-bolton is not tagged Former intel on insert, save, memory, or personTags", async () => {
  setMemory({ people: [], operations: [], source_posts: [] });
  const nsa = { clearances: clearanceRole("Former National Security Advisor") };
  const inserted = await insertPerson(clearanceCard("john-bolton", [REVOKED], nsa));
  assert.deepEqual(inserted.tags, [REVOKED]);
  assert.deepEqual((await getPerson("john-bolton")).tags, [REVOKED]);
  assert.deepEqual(personTags(await getPerson("john-bolton")), [REVOKED]);

  await savePerson({ ...(await getPerson("john-bolton")), tags: [REVOKED, INTEL] });
  assert.deepEqual((await getPerson("john-bolton")).tags, [REVOKED]);

  const listed = await listPeople({ tags: [INTEL] });
  assert.deepEqual(listed.map((r) => r.id), []);
  setMemory({ people: [], operations: [], source_posts: [] });
});

test("public gap-upsert carries the gated implied tag on people rows", () => {
  const intelRow = { id: "a", tags: [REVOKED], career: ciaCareer() };
  assert.equal(pickRow("people", intelRow).tags, JSON.stringify([REVOKED, INTEL]));
  assert.equal(
    pickRow("people", { id: "a", tags: JSON.stringify(["official", REVOKED]), career: ciaCareer() }).tags,
    JSON.stringify(["official", REVOKED, INTEL]),
  );
  assert.equal(pickRow("people", { id: "a", tags: [REVOKED] }).tags, JSON.stringify([REVOKED]));
  assert.equal(pickRow("people", { id: "a", tags: [REVOKED, INTEL] }).tags, JSON.stringify([REVOKED, INTEL]));
  assert.equal(pickRow("people", { id: "a", tags: ["official"] }).tags, JSON.stringify(["official"]));
  assert.equal(pickRow("people", { id: "a", tags: [] }).tags, "[]");
  assert.equal(pickRow("people", { id: "a" }).tags, "[]");
  assert.equal(pickRow("operations", { id: "op", tags: [REVOKED] }).tags, JSON.stringify([REVOKED]));

  const nsa = {
    id: "john-bolton",
    tags: [REVOKED],
    clearances: clearanceRole("Former National Security Advisor"),
  };
  assert.equal(pickRow("people", nsa).tags, JSON.stringify([REVOKED]));

  const { sql, params } = buildUpsertSql("people", [
    { id: "a", name: "A", category: "clearance", tags: [REVOKED], career: ciaCareer() },
  ]);
  assert.match(sql, /\btags = EXCLUDED\.tags\b/);
  assert.ok(params.includes(JSON.stringify([REVOKED, INTEL])));
});

const PEOPLE_COLS = [
  "id", "category", "name", "role", "event_date", "death_date", "birth_date", "country_of_origin",
  "photo", "photo_credit", "screenshot", "screenshot_credit", "net_worth_usd", "net_worth_note",
  "net_worth_source", "sources", "summary", "events", "tags", "career", "nicknames", "clearances",
];
const JSON_COLS = new Set(["sources", "events", "tags", "career", "nicknames", "clearances"]);

/**
 * Stub Postgres pool. people rows keep exactly the bound column values, so the
 * tag-list query is answered from stored people.tags only (peopleTagWhere),
 * never from personTags on read.
 */
function stubPool() {
  const people = new Map();
  const rowFrom = (params) => {
    const row = {};
    PEOPLE_COLS.forEach((col, i) => {
      row[col] = JSON_COLS.has(col) ? JSON.parse(params[i]) : params[i];
    });
    return row;
  };
  const query = async (sql, params = []) => {
    const text = String(sql).trim();
    if (/^INSERT INTO people \(/.test(text) || /^UPDATE people SET\s+category = \$2/.test(text)) {
      people.set(params[0], rowFrom(params));
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT \* FROM people WHERE id = \$1$/.test(text)) {
      return { rows: people.has(params[0]) ? [structuredClone(people.get(params[0]))] : [] };
    }
    if (/^SELECT \* FROM people WHERE/.test(text)) {
      assert.match(text, /jsonb_array_elements_text\(COALESCE\(people\.tags, '\[\]'::jsonb\)\) t\s+WHERE t = ANY\(\$1::text\[\]\)/);
      assert.doesNotMatch(text, /people\.category = ANY/);
      const want = params[0];
      const rows = [...people.values()].filter((row) => row.tags.some((t) => want.includes(t)));
      return { rows: rows.map((row) => structuredClone(row)) };
    }
    return { rows: [], rowCount: 0 };
  };
  return { people, query, connect: async () => ({ query, release() {} }) };
}

test("the SQL tag list stores Former intel only when an intel role is recorded", async () => {
  const stub = stubPool();
  setTestPool(stub);
  try {
    await insertPerson(clearanceCard("jane-roe", [REVOKED], { career: ciaCareer() }));
    assert.deepEqual(stub.people.get("jane-roe").tags, [REVOKED, INTEL]);

    await insertPerson(clearanceCard("john-roe", ["official"]));
    assert.deepEqual(stub.people.get("john-roe").tags, ["official"]);
    await savePerson({ ...(await getPerson("john-roe")), tags: ["official", REVOKED] });
    assert.deepEqual(stub.people.get("john-roe").tags, ["official", REVOKED]);

    await insertPerson(
      clearanceCard("john-bolton", [REVOKED], {
        clearances: clearanceRole("Former National Security Advisor"),
      }),
    );
    assert.deepEqual(stub.people.get("john-bolton").tags, [REVOKED]);
    await savePerson({ ...(await getPerson("john-bolton")), tags: [REVOKED, INTEL] });
    assert.deepEqual(stub.people.get("john-bolton").tags, [REVOKED]);

    await insertPerson(clearanceCard("gina-haspel", [INTEL]));
    assert.deepEqual(stub.people.get("gina-haspel").tags, [INTEL]);

    // Control: a row written outside the store without the implied tag stays off the list,
    // which proves the list reads stored people.tags.
    stub.people.set("raw-row", { ...clearanceCard("raw-row", [REVOKED]) });

    const intel = await listPeople({ tags: [INTEL] });
    assert.deepEqual(intel.map((r) => r.id).sort(), ["gina-haspel", "jane-roe"]);
    const revoked = await listPeople({ tags: [REVOKED] });
    assert.deepEqual(revoked.map((r) => r.id).sort(), ["jane-roe", "john-bolton", "john-roe", "raw-row"]);
  } finally {
    setTestPool(null);
  }
});

test("gap-upsert tags fall back like clearanceJson", () => {
  assert.equal(pickRow("people", { id: "a", tags: "{not json" }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", tags: "" }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", tags: JSON.stringify({ a: 1 }) }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", tags: { a: 1 } }).tags, "[]");
  assert.equal(pickRow("people", { id: "a", clearances: "{not json" }).clearances, "[]");
});
