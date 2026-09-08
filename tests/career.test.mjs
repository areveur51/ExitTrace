import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAREER_FIELDS,
  careerLine,
  careerOverlapsKeepEvent,
  formatCareerYears,
  mergeCareer,
  normalizeCareerRow,
  parseCareerYear,
  personCareer,
  visibleCareer,
} from "../app/lib/career.mjs";

test("career schema is title/org/branch plus years only", () => {
  assert.deepEqual(CAREER_FIELDS, [
    "title",
    "organization",
    "branch",
    "start_year",
    "end_year",
  ]);
});

test("career rows require a label and at least one year — role is not guessed", () => {
  assert.equal(parseCareerYear("1953"), 1953);
  assert.equal(parseCareerYear("1953-06-15"), 1953);
  assert.equal(parseCareerYear("navy"), null);
  assert.equal(parseCareerYear(12), null);
  assert.equal(normalizeCareerRow({ organization: "U.S. Army" }), null);
  assert.equal(normalizeCareerRow({ start_year: 1953, end_year: 1954 }), null);
  assert.deepEqual(
    normalizeCareerRow({
      title: "U.S. Army",
      Organization: "U.S. Army",
      start_year: "1953",
      end_year: "1954",
    }),
    {
      title: "U.S. Army",
      organization: "U.S. Army",
      branch: "",
      start_year: 1953,
      end_year: 1954,
    },
  );
  assert.equal(personCareer({ role: "Director, Federal Bureau of Investigation" }).length, 0);
  assert.equal(personCareer({ career: [{ position: "Anchor", start_year: 2010, end_year: 2024 }] })[0].title, "Anchor");
  assert.equal(formatCareerYears(1953, 1954), "1953–1954");
  assert.equal(careerLine({ title: "U.S. Army", organization: "U.S. Army", start_year: 1953, end_year: 1954 }), "U.S. Army · 1953–1954");
  assert.equal(
    careerLine({ title: "U.S. Army", organization: "U.S. Army", branch: "Army", start_year: 1953, end_year: 1954 }),
    "U.S. Army · 1953–1954",
  );
  assert.equal(
    careerLine({
      title: "Officer",
      organization: "Department of Defense",
      branch: "Navy",
      start_year: 1953,
      end_year: 1956,
    }),
    "Officer · Department of Defense · Navy · 1953–1956",
  );
  assert.deepEqual(
    mergeCareer(
      [{ title: "U.S. Army", start_year: 1953, end_year: 1954 }],
      [{ title: "U.S. Army", start_year: 1953, end_year: 1954 }, { title: "Anchor", organization: "Desk", start_year: 2010, end_year: 2020 }],
    ).map((row) => row.title),
    ["U.S. Army", "Anchor"],
  );
});

test("career history omits rows that duplicate a KEEP event occupation", () => {
  const arrest = {
    kind: "arrests",
    position: "Anchor, CNN",
    organization: "Example Desk",
  };
  assert.equal(
    careerOverlapsKeepEvent(
      { title: "Anchor, CNN", organization: "Example Desk", start_year: 2010, end_year: 2024 },
      arrest,
    ),
    true,
  );
  assert.equal(
    careerOverlapsKeepEvent({ title: "U.S. Army", organization: "U.S. Army", start_year: 1953, end_year: 1954 }, arrest),
    false,
  );
  const rows = visibleCareer(
    {
      career: [
        { title: "U.S. Army", start_year: 1953, end_year: 1954 },
        { position: "Anchor, CNN", organization: "Example Desk", start_year: 2010, end_year: 2024 },
      ],
    },
    [arrest],
  );
  assert.deepEqual(rows.map((r) => r.title), ["U.S. Army"]);
});
