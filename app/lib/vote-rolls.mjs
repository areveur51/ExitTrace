/** Closed roll-call catalog: ROLLS. VOTE_ROLLS is its recorded-no view.
 * `roll_call` is stored on each `people.events[]` object and kept by
 * normalizePersonEvent, the same way headcount is. A comments value that is
 * only a roll id (`H-119-1-145`) is read when the field is empty, and only
 * for a recorded-no kind.
 * `person_events` has no roll_call column and allows seq 0 outside notable,
 * so that companion table holds one row per kind: the newest-dated roll.
 * The card reads every roll on people.events.
 * Media on a recorded-no event stays on people.events. The card does not
 * render it. It is not orphaned and must not be cleaned up.
 *
 * Each roll also carries the official party split, `party.D|R|I` as
 * [yea, nay, present, not voting], copied from the House Clerk roll XML
 * (<totals-by-party>) or counted from the senate.gov roll-call page. It is
 * never derived from ExitTrace cards. `source` is the page the numbers came
 * from. The three untagged rolls (Transparency Act, Ukraine aid, the
 * H. Res. 1100 referral) back vote-fact tags that never store roll_call; the
 * dashboard groups them under the tag that cites them (tagRollIds in tags.mjs).
 */

const ROLL_ID_RE = /^([HS])-([1-9]\d{2})-([12])-([1-9]\d{0,3})$/;

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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2025-04-10` -> `April 10, 2025`; "" when the value is not a YYYY-MM-DD date. */
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Party keys in display order. Each count is [yea, nay, present, not voting]. */
export const VOTE_PARTIES = Object.freeze([
  Object.freeze({ id: "D", label: "Democratic" }),
  Object.freeze({ id: "R", label: "Republican" }),
  Object.freeze({ id: "I", label: "Independent" }),
]);

export const VOTE_POSITIONS = Object.freeze(["yea", "nay", "present", "not_voting"]);

function partyRecord(raw, id) {
  const out = {};
  for (const { id: key } of VOTE_PARTIES) {
    const counts = raw?.[key];
    if (!Array.isArray(counts) || counts.length !== VOTE_POSITIONS.length) {
      throw new Error(`roll ${id} has no ${key} party counts`);
    }
    out[key] = Object.freeze(Object.fromEntries(VOTE_POSITIONS.map((pos, i) => [pos, Number(counts[i])])));
  }
  return Object.freeze(out);
}

function sumParties(party) {
  const out = {};
  for (const pos of VOTE_POSITIONS) {
    out[pos] = VOTE_PARTIES.reduce((n, { id }) => n + party[id][pos], 0);
  }
  return Object.freeze(out);
}

/** House: the Clerk roll XML. Senate: the senate.gov roll-call page. */
function sourceFor(id, date, chamber) {
  return chamber === "House" ? houseClerkXmlUrl(id, date) : senateRollCallUrl(id);
}

/**
 * Every roll entry is built here, so id, chamber, congress, session, number and urls
 * always come from the roll id and date. `tag` is optional and set only on a
 * recorded-no row (a VOTE_NO_TAGS kind). `party`, `totals`, `source`,
 * `procedure` and `note` carry the official party split for every row.
 */
function rollRecord(entry) {
  const parsed = parseRollId(entry.id);
  if (!parsed) throw new Error(`roll id ${entry.id} is not a catalog id`);
  const party = partyRecord(entry.party, parsed.id);
  return Object.freeze({
    id: parsed.id,
    ...(entry.tag ? { tag: entry.tag } : {}),
    chamber: parsed.chamber,
    congress: parsed.congress,
    session: parsed.session,
    number: parsed.number,
    date: entry.date,
    measure: entry.measure,
    question: entry.question,
    stage: entry.stage,
    result: entry.result,
    tally: entry.tally,
    procedure: entry.procedure || (entry.stage === "procedural" ? "cloture" : ""),
    note: entry.note || "",
    party,
    totals: sumParties(party),
    source: sourceFor(parsed.id, entry.date, parsed.chamber),
    urls: urlsFor(parsed.id, entry.date, parsed.chamber),
  });
}

/**
 * One roll catalog. Recorded-no rows carry the `tag` of their VOTE_NO_TAGS kind;
 * untagged rows are rolls that tag descriptions cite by id (Transparency Act,
 * Ukraine aid, the H. Res. 1100 referral).
 */
export const ROLLS = Object.freeze([
  {
    id: "H-119-1-145",
    tag: "big_beautiful_bill_act",
    date: "2025-05-22",
    measure: "H.R. 1",
    question: "On Passage",
    stage: "passage",
    result: "Passed",
    tally: "215-214, 1 present, 2 not voting",
    party: { D: [0, 212, 0, 0], R: [215, 2, 1, 2], I: [0, 0, 0, 0] },
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
    party: { D: [0, 45, 0, 0], R: [50, 3, 0, 0], I: [0, 2, 0, 0] },
    note: "Vice President voted yea",
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
    party: { D: [0, 212, 0, 0], R: [218, 2, 0, 0], I: [0, 0, 0, 0] },
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
    party: { D: [4, 208, 0, 1], R: [216, 0, 0, 4], I: [0, 0, 0, 0] },
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
    party: { D: [0, 211, 0, 2], R: [219, 2, 0, 1], I: [0, 0, 0, 0] },
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
    party: { D: [46, 156, 0, 13], R: [217, 0, 0, 1], I: [0, 0, 0, 0] },
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
    party: { D: [12, 33, 0, 0], R: [52, 0, 0, 0], I: [0, 2, 0, 0] },
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
    party: { D: [1, 213, 0, 0], R: [217, 0, 0, 1], I: [0, 0, 0, 0] },
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
    party: { D: [0, 45, 0, 0], R: [53, 0, 0, 0], I: [0, 2, 0, 0] },
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
    party: { D: [0, 44, 0, 1], R: [52, 0, 0, 1], I: [0, 2, 0, 0] },
  },
  {
    id: "H-119-1-289",
    date: "2025-11-18",
    measure: "H.R. 4405",
    question: "On Motion to Suspend the Rules and Pass",
    stage: "passage",
    result: "Passed",
    tally: "427-1, 5 not voting",
    party: { D: [211, 0, 0, 3], R: [216, 1, 0, 2], I: [0, 0, 0, 0] },
  },
  {
    id: "H-118-2-151",
    date: "2024-04-20",
    measure: "H.R. 8035",
    question: "On Passage",
    stage: "passage",
    result: "Passed",
    tally: "311-112, 1 present, 7 not voting",
    party: { D: [210, 0, 0, 3], R: [101, 112, 1, 4], I: [0, 0, 0, 0] },
  },
  {
    id: "H-119-2-83",
    date: "2026-03-04",
    measure: "H. Res. 1100",
    question: "On Motion to Refer",
    stage: "procedural",
    procedure: "motion to refer",
    result: "Passed",
    tally: "357-65, 1 present, 9 not voting",
    party: { D: [182, 27, 0, 5], R: [175, 38, 1, 4], I: [0, 0, 0, 0] },
  },
]
  .map(rollRecord));

const ROLLS_BY_ID = Object.freeze(Object.fromEntries(ROLLS.map((roll) => [roll.id, roll])));

/** Catalog roll for an id, tagged or not; null when the id is not in ROLLS. */
export function rollById(id) {
  return ROLLS_BY_ID[normalizeRollCall(id)] || null;
}

/** Human page for a catalog roll. House Votes URL, or the Senate roll-call page. */
export function officialRollPageUrl(id) {
  const roll = rollById(id);
  return roll?.urls?.[0] ? String(roll.urls[0]) : "";
}

/** Both House pages, or the one Senate page. Empty when the id is not in the catalog. */
export function officialRollUrls(id) {
  const roll = rollById(id);
  return roll ? roll.urls : Object.freeze([]);
}

export function voteRollTitle(roll) {
  if (!roll) return "";
  const noun = roll.chamber === "Senate" ? "vote" : "roll";
  return `${roll.measure} · ${roll.chamber} ${noun} ${roll.number}`;
}

export function voteStageLabel(stage, procedure = "cloture") {
  if (stage === "procedural") return `Procedural (${procedure || "cloture"})`;
  if (stage === "passage") return "Final passage";
  return "";
}

/**
 * The six recorded-no kinds. A lede only says who is listed; the tag description
 * (TAG_DESCRIPTIONS in tags.mjs) carries the recorded votes, built from ROLLS.
 */
export const VOTE_NO_TAGS = Object.freeze([
  Object.freeze({
    id: "big_beautiful_bill_act",
    nav: "One Big Beautiful Bill Act",
    path: "/tags/one-big-beautiful-bill-act",
    lede: "People who voted no on H.R. 1, the One Big Beautiful Bill Act.",
  }),
  Object.freeze({
    id: "save_act",
    nav: "SAVE Act",
    path: "/tags/save-act",
    lede: "People who voted no on H.R. 22, the SAVE Act.",
  }),
  Object.freeze({
    id: "secure_the_border_act",
    nav: "Secure the Border Act",
    path: "/tags/secure-the-border-act",
    lede: "People who voted no on H.R. 2, the Secure the Border Act.",
  }),
  Object.freeze({
    id: "laken_riley_act",
    nav: "Laken Riley Act",
    path: "/tags/laken-riley-act",
    lede: "People who voted no on S. 5, the Laken Riley Act.",
  }),
  Object.freeze({
    id: "save_america_act",
    nav: "SAVE America Act",
    path: "/tags/save-america-act",
    lede: "People who voted no on the SAVE America Act.",
  }),
  Object.freeze({
    id: "s_5271_photo_id",
    nav: "S. 5271",
    path: "/tags/s-5271",
    lede: "People who voted no on S. 5271.",
  }),
]);

export const VOTE_NO_KIND_IDS = Object.freeze(VOTE_NO_TAGS.map((tag) => tag.id));

/** Recorded-no rolls by id: the ROLLS entries whose tag is a VOTE_NO_TAGS kind. */
export const VOTE_ROLLS = Object.freeze(
  Object.fromEntries(ROLLS.filter((roll) => VOTE_NO_KIND_IDS.includes(roll.tag)).map((roll) => [roll.id, roll])),
);
for (const roll of ROLLS) {
  if (roll.tag && !VOTE_ROLLS[roll.id]) throw new Error(`roll ${roll.id} has tag ${roll.tag}, which is not a recorded-no kind`);
}

/** The six recorded-no kinds. Each roll call is its own event of this kind. */
export const VOTE_NO_KINDS = new Set(VOTE_NO_KIND_IDS);

/** Recorded-vote facts. They are not catalog kinds. Earlier vote tags stay in this set; their own card sections stay as they are. */
export const VOTE_FACT_KINDS = new Set([
  ...VOTE_NO_KIND_IDS,
  "harassment_records",
  "ukraine_aid_flags",
]);
