/** Closed catalog of recorded-no roll calls.
 * `roll_call` is stored on each `people.events[]` object and kept by
 * normalizePersonEvent, the same way headcount is. A comments value that is
 * only a roll id (`H-119-1-145`) is read when the field is empty.
 * `person_events` has no roll_call column and allows seq 0 outside notable,
 * so that companion table holds one row per kind. The card reads people.events.
 */

const ROLL_ID_RE = /^([HS])-(\d{3})-([12])-(\d{1,4})$/;

export function parseRollId(raw) {
  const text = String(raw || "").trim();
  const match = ROLL_ID_RE.exec(text);
  if (!match) return null;
  return {
    id: text,
    chamber: match[1] === "H" ? "House" : "Senate",
    congress: Number(match[2]),
    session: Number(match[3]),
    number: Number(match[4]),
  };
}

/** Roll id, or "" when the value is not `H-119-1-145` shaped. */
export function normalizeRollCall(raw) {
  const parsed = parseRollId(raw);
  return parsed ? parsed.id : "";
}

function voteYear(date) {
  const text = String(date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(0, 4) : "";
}

/** https://clerk.house.gov/Votes/2025145 */
export function houseClerkVoteUrl(id, date) {
  const parsed = parseRollId(id);
  const year = voteYear(date);
  if (!parsed || parsed.chamber !== "House" || !year) return "";
  return `https://clerk.house.gov/Votes/${year}${parsed.number}`;
}

/** https://clerk.house.gov/evs/2025/roll145.xml — roll number is 3 digits. */
export function houseClerkXmlUrl(id, date) {
  const parsed = parseRollId(id);
  const year = voteYear(date);
  if (!parsed || parsed.chamber !== "House" || !year) return "";
  const pad = String(parsed.number).padStart(3, "0");
  return `https://clerk.house.gov/evs/${year}/roll${pad}.xml`;
}

/** https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00372.htm */
export function senateRollCallUrl(id) {
  const parsed = parseRollId(id);
  if (!parsed || parsed.chamber !== "Senate") return "";
  const pad = String(parsed.number).padStart(5, "0");
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${parsed.congress}${parsed.session}/vote_${parsed.congress}_${parsed.session}_${pad}.htm`;
}

function urlsFor(id, date, chamber) {
  if (chamber === "House") {
    return Object.freeze([houseClerkVoteUrl(id, date), houseClerkXmlUrl(id, date)].filter(Boolean));
  }
  const page = senateRollCallUrl(id);
  return Object.freeze(page ? [page] : []);
}

const ROLL_FACTS = [
  {
    id: "H-119-1-145",
    tag: "big_beautiful_bill_act",
    date: "2025-05-22",
    measure: "H.R. 1",
    question: "On Passage",
    stage: "passage",
    result: "Passed",
    tally: "215-214, 1 present, 2 not voting",
  },
  {
    id: "S-119-1-372",
    tag: "big_beautiful_bill_act",
    date: "2025-07-01",
    measure: "H.R. 1",
    question: "On Passage of the Bill, as amended",
    stage: "passage",
    result: "Passed",
    tally: "50-50, Vice President voted yea",
  },
  {
    id: "H-119-1-190",
    tag: "big_beautiful_bill_act",
    date: "2025-07-03",
    measure: "H.R. 1",
    question: "On Motion to Concur in the Senate Amendment",
    stage: "passage",
    result: "Passed",
    tally: "218-214",
  },
  {
    id: "H-119-1-102",
    tag: "save_act",
    date: "2025-04-10",
    measure: "H.R. 22",
    question: "On Passage",
    stage: "passage",
    result: "Passed",
    tally: "220-208, 5 not voting",
  },
  {
    id: "H-118-1-209",
    tag: "secure_the_border_act",
    date: "2023-05-11",
    measure: "H.R. 2",
    question: "On Passage",
    stage: "passage",
    result: "Passed",
    tally: "219-213, 3 not voting",
  },
  {
    id: "H-119-1-23",
    tag: "laken_riley_act",
    date: "2025-01-22",
    measure: "S. 5",
    question: "On Passage",
    stage: "passage",
    result: "Passed",
    tally: "263-156, 14 not voting",
  },
  {
    id: "S-119-1-7",
    tag: "laken_riley_act",
    date: "2025-01-20",
    measure: "S. 5",
    question: "On Passage of the Bill",
    stage: "passage",
    result: "Passed",
    tally: "64-35",
  },
  {
    id: "H-119-2-69",
    tag: "save_america_act",
    date: "2026-02-11",
    measure: "S. 1383 (House-substituted SAVE America Act text)",
    question: "On Passage",
    stage: "passage",
    result: "Passed",
    tally: "218-213, 1 not voting",
  },
  {
    id: "S-119-2-73",
    tag: "save_america_act",
    date: "2026-03-26",
    measure: "S. Amdt. 4732 (Husted, photo identification) to S. Amdt. 4420 to S. 1383",
    question: "On the Cloture Motion",
    stage: "procedural",
    result: "Cloture Motion Rejected (3/5 required)",
    tally: "53-47",
  },
  {
    id: "S-119-2-231",
    tag: "s_5271_photo_id",
    date: "2026-08-08",
    measure: "S. 5271",
    question: "On Cloture on the Motion to Proceed",
    stage: "procedural",
    result: "Cloture on the Motion to Proceed Rejected (3/5 required)",
    tally: "52-46, 2 not voting",
  },
];

function rollRecord(fact) {
  const parsed = parseRollId(fact.id);
  if (!parsed) throw new Error(`roll id ${fact.id} is not a catalog id`);
  return Object.freeze({
    id: parsed.id,
    tag: fact.tag,
    chamber: parsed.chamber,
    congress: parsed.congress,
    session: parsed.session,
    number: parsed.number,
    date: fact.date,
    measure: fact.measure,
    question: fact.question,
    stage: fact.stage,
    result: fact.result,
    tally: fact.tally,
    urls: urlsFor(parsed.id, fact.date, parsed.chamber),
  });
}

export const VOTE_ROLLS = Object.freeze(
  Object.fromEntries(ROLL_FACTS.map((fact) => {
    const row = rollRecord(fact);
    return [row.id, row];
  })),
);

/** Human page for a catalog roll. House Votes URL, or the Senate roll-call page. */
export function officialRollPageUrl(id) {
  const roll = VOTE_ROLLS[normalizeRollCall(id)];
  return roll?.urls?.[0] ? String(roll.urls[0]) : "";
}

/** Both House pages, or the one Senate page. Empty when the id is not in the catalog. */
export function officialRollUrls(id) {
  const roll = VOTE_ROLLS[normalizeRollCall(id)];
  return roll ? roll.urls : Object.freeze([]);
}

export function voteRollTitle(roll) {
  if (!roll) return "";
  const noun = roll.chamber === "Senate" ? "vote" : "roll";
  return `${roll.measure} · ${roll.chamber} ${noun} ${roll.number}`;
}

export function voteStageLabel(stage) {
  if (stage === "procedural") return "Procedural (cloture)";
  if (stage === "passage") return "Final passage";
  return "";
}

export const VOTE_NO_TAGS = Object.freeze([
  Object.freeze({
    id: "big_beautiful_bill_act",
    nav: "One Big Beautiful Bill Act",
    path: "/tags/one-big-beautiful-bill-act",
    lede:
      "People who voted no on H.R. 1, the One Big Beautiful Bill Act. House roll 145 on May 22, 2025 passed 215-214, with 1 present and 2 not voting. Senate vote 372 on July 1, 2025 passed 50-50, and the Vice President voted yea. House roll 190 on July 3, 2025, the motion to concur in the Senate amendment, passed 218-214.",
  }),
  Object.freeze({
    id: "save_act",
    nav: "SAVE Act",
    path: "/tags/save-act",
    lede:
      "People who voted no on H.R. 22, the SAVE Act. House roll 102 on April 10, 2025 passed 220-208, with 5 not voting.",
  }),
  Object.freeze({
    id: "secure_the_border_act",
    nav: "Secure the Border Act",
    path: "/tags/secure-the-border-act",
    lede:
      "People who voted no on H.R. 2, the Secure the Border Act. House roll 209 on May 11, 2023 passed 219-213, with 3 not voting.",
  }),
  Object.freeze({
    id: "laken_riley_act",
    nav: "Laken Riley Act",
    path: "/tags/laken-riley-act",
    lede:
      "People who voted no on S. 5, the Laken Riley Act. Senate vote 7 on January 20, 2025 passed 64-35. House roll 23 on January 22, 2025 passed 263-156, with 14 not voting.",
  }),
  Object.freeze({
    id: "save_america_act",
    nav: "SAVE America Act",
    path: "/tags/save-america-act",
    lede:
      "People who voted no on the SAVE America Act. House roll 69 on February 11, 2026 passed the House-substituted text of S. 1383, 218-213, with 1 not voting. Senate vote 73 on March 26, 2026 rejected cloture on S. Amdt. 4732, 53-47. Cloture requires three-fifths.",
  }),
  Object.freeze({
    id: "s_5271_photo_id",
    nav: "S. 5271",
    path: "/tags/s-5271",
    lede:
      "People who voted no on S. 5271. Senate vote 231 on August 8, 2026 rejected cloture on the motion to proceed, 52-46, with 2 not voting. Cloture requires three-fifths.",
  }),
]);

export const VOTE_NO_KIND_IDS = Object.freeze(VOTE_NO_TAGS.map((tag) => tag.id));

/** The six recorded-no kinds. Each roll call is its own event of this kind. */
export const VOTE_NO_KINDS = new Set(VOTE_NO_KIND_IDS);

/** Recorded-vote facts. They are not catalog kinds. Earlier vote tags stay in this set; their own card sections stay as they are. */
export const VOTE_FACT_KINDS = new Set([
  ...VOTE_NO_KIND_IDS,
  "harassment_records",
  "ukraine_aid_flags",
]);
