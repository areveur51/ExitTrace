/** Person identity tags — independent of event kind. Multi-tag is allowed. */

import { hostOf, isGovHost, isOfficialNewsHost } from "./official.mjs";
import { VOTE_NO_TAGS, VOTE_ROLLS, normalizeRollCall, officialRollPageUrl } from "./vote-rolls.mjs";

export const IDENTITY_TAGS = [
  { id: "civilian", nav: "Civilians" },
  { id: "non_civilian", nav: "Non-civilians" },
  { id: "celebrity", nav: "Celebrities" },
  { id: "official", nav: "Officials" },
  { id: "ceo", nav: "Executives" },
];

export const IDENTITY_TAG_IDS = IDENTITY_TAGS.map((t) => t.id);

/**
 * Fact tags. Not identity, and not implied by an event kind.
 * The catalog menu has a letterless Tags section. Each row links to the people who already store that fact.
 * They are not catalog hotkeys.
 */
/** Person category for a flight-log card that has no other catalog entry. Not a nav page. */
export const EPSTEIN_CLIENTS_CATEGORY = "epstein_clients";

export const ATTRIBUTE_TAGS = [
  {
    id: "clearance_revoked",
    nav: "Revoked clearances",
    path: "/tags/clearance-revoked",
    lede:
      "People with a stored security-clearance revocation.",
  },
  {
    id: "trump_nickname",
    nav: "Trump nicknames",
    path: "/tags/trump-nicknames",
    lede:
      "People with a stored Trump nickname.",
  },
  {
    id: "epstein_clients",
    nav: "Epstein Clients",
    path: "/tags/epstein-clients",
    lede:
      "People named on the Epstein flight log.",
  },
  {
    id: "epstein_files",
    nav: "Epstein files",
    path: "/tags/epstein-files",
    lede:
      "People named in a stored Epstein-files document.",
  },
  {
    id: "masks",
    nav: "Masks",
    path: "/tags/masks",
    lede:
      "People stored with a mask, body-double, or impersonation claim. Impersonation is part of what this tag records.",
  },
  {
    id: "epstein_transparency_act",
    nav: "Transparency Act",
    path: "/tags/transparency-act",
    lede:
      "People with a stored vote against the Epstein Files Transparency Act, H.R. 4405, or against a House Rules Committee motion to consider it. The House passed the bill 427-1 on November 18, 2025.",
  },
  {
    id: "endorsements",
    nav: "Endorsements",
    path: "/tags/endorsements",
    lede:
      "People with a stored endorsement from Donald Trump.",
  },
  {
    id: "harassment_records",
    nav: "Harassment records",
    path: "/tags/harassment-records",
    lede:
      "People who voted yea on March 4, 2026 to refer H. Res. 1100 to the House Committee on Ethics. Roll Call 83 passed 357-65, with 1 present. The resolution would have directed the committee to preserve and publicly release records of its reviews of sexual harassment and of clause 18 of House Rule XXIII.",
  },
  {
    id: "ukraine_aid_flags",
    nav: "Ukraine aid",
    path: "/tags/ukraine-aid",
    lede:
      "People who voted yea on April 20, 2024, on H.R. 8035, the Ukraine Security Supplemental Appropriations Act, 2024. Roll Call 151 passed 311-112, with 1 present.",
  },
  ...VOTE_NO_TAGS,
  {
    id: "former_intel_agency_personnel",
    nav: "Former intel",
    path: "/tags/former-intel-agency-personnel",
    lede:
      "People with stored former employment at a U.S. intelligence agency.",
  },
  {
    id: "fraud",
    nav: "Fraud",
    path: "/tags/fraud",
    lede:
      "People with a stored record of a fraud charge, plea, conviction, indictment or official fraud finding.",
  },
];

export const ATTRIBUTE_TAG_IDS = ATTRIBUTE_TAGS.map((t) => t.id);

/**
 * General description at the top of each `/tags/<slug>` page. One map for every Tags-menu tag.
 * Record-only text: what a bill does plus its recorded votes, or what qualifies a card for the tag.
 * A bill names its catalog rolls by id, and the vote line is built from VOTE_ROLLS (vote-rolls.mjs).
 * A roll that is not in that catalog is listed inline under `rolls` in the same shape.
 * A cite is `{ label, url }` or `{ label, roll }`; a roll cite reuses the official roll page URL.
 * Cites must be https on a .gov host or an official news host (official.mjs), or they are dropped.
 */
export const TAG_DESCRIPTIONS = Object.freeze({
  clearance_revoked: {
    kind: "rule",
    text: "A card gets this tag when it stores a security-clearance revocation for the person.",
  },
  trump_nickname: {
    kind: "rule",
    text: "A card gets this tag when it stores a nickname Donald Trump used for the person.",
  },
  epstein_clients: {
    kind: "rule",
    text: "A card gets this tag when the person is named on the Epstein flight log.",
  },
  epstein_files: {
    kind: "rule",
    text: "A card gets this tag when the person is named in a stored Epstein-files document.",
  },
  masks: {
    kind: "rule",
    text: "A card gets this tag when it stores a mask, body-double, or impersonation claim about the person.",
  },
  epstein_transparency_act: {
    kind: "bill",
    text:
      "H.R. 4405, the Epstein Files Transparency Act, requires the Justice Department to publish its unclassified records on the investigation and prosecution of Jeffrey Epstein, with limited withholding such as victims' personal information; it became Public Law 119-38 on November 19, 2025.",
    rolls: [
      {
        chamber: "House",
        number: 289,
        date: "2025-11-18",
        question: "On Motion to Suspend the Rules and Pass",
        result: "Passed",
        tally: "427-1, 5 not voting",
      },
    ],
    cites: [
      { label: "congress.gov", url: "https://www.congress.gov/bill/119th-congress/house-bill/4405" },
      { label: "clerk.house.gov", url: "https://clerk.house.gov/Votes/2025289" },
      { label: "ABC News", url: "https://abcnews.go.com/Politics/house-vote-full-epstein-files-release-move-speaker/story?id=127593181" },
    ],
  },
  endorsements: {
    kind: "rule",
    text: "A card gets this tag when it stores an endorsement of the person by Donald Trump.",
  },
  harassment_records: {
    kind: "rule",
    text:
      "A card gets this tag when the member voted yea on House roll 83 on March 4, 2026, the motion to refer H. Res. 1100 to the House Committee on Ethics, which passed 357-65 with 1 present.",
  },
  ukraine_aid_flags: {
    kind: "bill",
    text:
      "H.R. 8035, the Ukraine Security Supplemental Appropriations Act, 2024, provides FY2024 emergency supplemental appropriations to respond to the conflict in Ukraine, including funds for the Defense Department, the State Department, and USAID.",
    rolls: [
      {
        chamber: "House",
        number: 151,
        date: "2024-04-20",
        question: "On Passage",
        result: "Passed",
        tally: "311-112, 1 present, 7 not voting",
      },
    ],
    cites: [
      { label: "congress.gov", url: "https://www.congress.gov/bill/118th-congress/house-bill/8035" },
      { label: "clerk.house.gov", url: "https://clerk.house.gov/Votes/2024151" },
      { label: "CBS News", url: "https://www.cbsnews.com/news/house-vote-aid-bill-ukraine-israel-taiwan/" },
    ],
  },
  big_beautiful_bill_act: {
    kind: "bill",
    text:
      "H.R. 1, the One Big Beautiful Bill Act, is a budget reconciliation law that changes taxes and federal spending and raises the statutory debt limit; it became Public Law 119-21 on July 4, 2025.",
    rolls: ["H-119-1-145", "S-119-1-372", "H-119-1-190"],
    cites: [
      { label: "congress.gov", url: "https://www.congress.gov/bill/119th-congress/house-bill/1" },
      { label: "clerk.house.gov", roll: "H-119-1-190" },
      { label: "NPR", url: "https://www.npr.org/2025/07/03/nx-s1-5454841/house-republicans-trump-tax-bill-medicaid" },
    ],
  },
  save_act: {
    kind: "bill",
    text:
      "H.R. 22, the SAVE Act, would require documentary proof of U.S. citizenship to register to vote in federal elections.",
    rolls: ["H-119-1-102"],
    cites: [
      { label: "congress.gov", url: "https://www.congress.gov/bill/119th-congress/house-bill/22" },
      { label: "clerk.house.gov", roll: "H-119-1-102" },
      { label: "NPR", url: "https://www.npr.org/2025/04/10/g-s1-59519/save-act-voter-registration" },
    ],
  },
  secure_the_border_act: {
    kind: "bill",
    text:
      "H.R. 2, the Secure the Border Act of 2023, would change immigration law, including limits on asylum eligibility, resumed U.S.-Mexico border wall construction, and required electronic employment-eligibility verification for new hires.",
    rolls: ["H-118-1-209"],
    cites: [
      { label: "congress.gov", url: "https://www.congress.gov/bill/118th-congress/house-bill/2" },
      { label: "clerk.house.gov", roll: "H-118-1-209" },
      { label: "ABC News", url: "https://abcnews.go.com/Politics/house-vote-strengthened-border-bill-hours-title-42/story?id=99197886" },
    ],
  },
  laken_riley_act: {
    kind: "bill",
    text:
      "S. 5, the Laken Riley Act, requires the Department of Homeland Security to detain certain non-U.S. nationals arrested for or charged with burglary, theft, larceny, shoplifting, assaulting a law enforcement officer, or a crime causing death or serious bodily injury; it became Public Law 119-1 on January 29, 2025.",
    rolls: ["S-119-1-7", "H-119-1-23"],
    cites: [
      { label: "congress.gov", url: "https://www.congress.gov/bill/119th-congress/senate-bill/5" },
      { label: "clerk.house.gov", roll: "H-119-1-23" },
      { label: "NBC News", url: "https://www.nbcnews.com/politics/congress/house-passes-laken-riley-act-sending-first-bill-trump-sign-law-rcna188724" },
    ],
  },
  save_america_act: {
    kind: "bill",
    text:
      "The SAVE America Act, passed by the House as an amendment to S. 1383, would require documentary proof of U.S. citizenship to register for federal elections, valid photo ID to vote in person, a copy of a photo ID or a stated alternative with a mail ballot, and state checks of voter rolls against the DHS SAVE system.",
    rolls: ["H-119-2-69", "S-119-2-73"],
    cites: [
      { label: "congress.gov (CRS IF12902)", url: "https://www.congress.gov/crs-product/IF12902" },
      { label: "clerk.house.gov", roll: "H-119-2-69" },
      { label: "CBS News", url: "https://www.cbsnews.com/news/save-america-act-election-bill-house-republicans/" },
    ],
  },
  s_5271_photo_id: {
    kind: "bill",
    text:
      "S. 5271 would amend the Help America Vote Act of 2002 to require voters to present valid photo identification to receive a ballot in federal elections, with a provisional ballot for a voter who does not.",
    rolls: ["S-119-2-231"],
    cites: [
      { label: "congress.gov", url: "https://www.congress.gov/bill/119th-congress/senate-bill/5271" },
      { label: "senate.gov", roll: "S-119-2-231" },
    ],
  },
  former_intel_agency_personnel: {
    kind: "rule",
    text: "A card gets this tag only when it stores the person's former employment at a U.S. intelligence agency.",
  },
  fraud: {
    kind: "rule",
    text: "A card gets this tag when it stores a fraud charge, plea, conviction, indictment, or official fraud finding for the person.",
  },
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * `House roll 102 (April 10, 2025), On Passage: Passed, 220-208, 5 not voting`.
 * A procedural roll also names its measure, since that is often an amendment or motion.
 */
export function rollVoteText(roll) {
  if (!roll) return "";
  const noun = roll.chamber === "Senate" ? "vote" : "roll";
  const measure = roll.stage === "procedural" && roll.measure ? `, ${roll.measure}` : "";
  return `${roll.chamber} ${noun} ${roll.number} (${longDate(roll.date)}), ${roll.question}${measure}: ${roll.result}, ${roll.tally}`;
}

/** True for an https URL on a .gov host or an official news host. */
export function isTagCiteUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || "").trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const host = hostOf(parsed);
  return Boolean(host) && (isGovHost(host) || isOfficialNewsHost(host));
}

function resolveRoll(entry) {
  if (typeof entry === "string") return VOTE_ROLLS[normalizeRollCall(entry)] || null;
  return entry && typeof entry === "object" ? entry : null;
}

/**
 * Resolved description for a tag id: `{ id, kind, text, votes, cites: [{ label, url }] }`, or null.
 * `votes` is "Recorded votes: …." for a bill and "" otherwise.
 */
export function tagDescription(id) {
  const raw = Object.prototype.hasOwnProperty.call(TAG_DESCRIPTIONS, id) ? TAG_DESCRIPTIONS[id] : null;
  if (!raw) return null;
  const rolls = (raw.rolls || []).map(resolveRoll).filter(Boolean);
  const votes = rolls.length ? `Recorded votes: ${rolls.map(rollVoteText).join("; ")}.` : "";
  const cites = (raw.cites || [])
    .map((c) => ({ label: String(c.label || "").trim(), url: c.roll ? officialRollPageUrl(c.roll) : String(c.url || "").trim() }))
    .filter((c) => c.label && isTagCiteUrl(c.url));
  return Object.freeze({ id, kind: raw.kind, text: raw.text, votes, cites: Object.freeze(cites), rolls: Object.freeze(rolls) });
}

/** Event kinds that imply an identity tag. Gold rows often have only the kind. */
export const KIND_TAGS = {
  death_celebrity: ["celebrity"],
  death_official: ["official"],
  death_ceo: ["ceo"],
  indictment_civilian: ["civilian"],
  indictment_non_civilian: ["non_civilian"],
  government_stepdowns: ["official"],
};

export const PATH_TAGS = {
  "/deaths/celebrities": ["celebrity"],
  "/deaths/officials": ["official"],
  "/deaths/ceos": ["ceo"],
  "/indictments/civilians": ["civilian"],
  "/indictments/non-civilians": ["non_civilian"],
  "/government": ["official"],
};

const TAG_SET = new Set([...IDENTITY_TAG_IDS, ...ATTRIBUTE_TAG_IDS]);

/**
 * Event filter token for indictment lists. Not an identity tag and not a KEEP kind.
 * Stored as person_events.unsealed / people.events[].unsealed, not people.tags.
 */
export const UNSEALED_FILTER = "unsealed";

function searchParamsOf(searchParams) {
  return searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || "");
}

function rawTagTokens(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return list
    .map((item) =>
      String(item || "")
        .trim()
        .toLowerCase()
        .replace(/-/g, "_"),
    )
    .filter(Boolean);
}

export function normalizeTag(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return TAG_SET.has(id) ? id : null;
}

export function normalizeTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = normalizeTag(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function tagsFromKinds(kinds) {
  const out = [];
  const seen = new Set();
  for (const kind of kinds || []) {
    for (const id of KIND_TAGS[kind] || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Union of stored tags plus tags implied by event kinds / primary category. */
export function personTags(row) {
  const kinds = [
    ...((row?.events || []).map((ev) => ev.kind).filter(Boolean)),
    row?.category,
  ];
  return normalizeTags([...(row?.tags || []), ...tagsFromKinds(kinds)]);
}

export function kindsImplyingTags(tags) {
  const want = new Set(normalizeTags(tags));
  if (!want.size) return [];
  const kinds = [];
  for (const [kind, implied] of Object.entries(KIND_TAGS)) {
    if (implied.some((id) => want.has(id))) kinds.push(kind);
  }
  return kinds;
}

/** OR: a person matches if they have any of the selected tags. */
export function matchesTags(row, tags) {
  const want = normalizeTags(tags);
  if (!want.length) return true;
  const have = new Set(personTags(row));
  return want.some((id) => have.has(id));
}

/** True when the tags query includes the indictment event token `unsealed`. */
export function parseUnsealedFilter(searchParams) {
  const src = searchParamsOf(searchParams);
  if (!src.has("tags")) return false;
  return rawTagTokens(src.get("tags")).includes(UNSEALED_FILTER);
}

export function parseTagFilter(searchParams, pathname) {
  const src = searchParamsOf(searchParams);
  const fromPath = PATH_TAGS[String(pathname || "").split("?")[0]] || [];
  if (!src.has("tags")) return fromPath.slice();
  const identity = normalizeTags(
    rawTagTokens(src.get("tags")).filter((id) => id !== UNSEALED_FILTER),
  );
  // `?tags=unsealed` is an event filter. Keep the path's identity slice.
  if (!identity.length && parseUnsealedFilter(src)) return fromPath.slice();
  return identity;
}

export function catalogMainPath(pathname) {
  const p = String(pathname || "").split("?")[0];
  if (p.startsWith("/deaths")) return "/deaths";
  if (p.startsWith("/indictments")) return "/indictments";
  if (p.startsWith("/group-operations")) return "/group-operations";
  if (p === "/government") return "/government";
  return p;
}

export function filterQuery({ tags, unsealed = false } = {}) {
  const params = new URLSearchParams();
  const parts = normalizeTags(tags);
  if (unsealed) parts.push(UNSEALED_FILTER);
  if (parts.length) params.set("tags", parts.join(","));
  return params.toString();
}

export function pathForTagFilter(mainPath, tags) {
  const selected = normalizeTags(tags);
  if (selected.length === 1) {
    const only = selected[0];
    const child = {
      "/deaths": {
        celebrity: "/deaths/celebrities",
        official: "/deaths/officials",
        ceo: "/deaths/ceos",
      },
      "/indictments": {
        civilian: "/indictments/civilians",
        non_civilian: "/indictments/non-civilians",
      },
    }[mainPath];
    if (child && child[only]) return child[only];
  }
  return catalogMainPath(mainPath) || "/";
}

/**
 * Indictment list dropdown rows for the event token. Same paths as the
 * `?tags=unsealed` filter: identity stays on the civilian child route,
 * unsealed stays a query token. Not a route and not an identity tag.
 */
export function indictmentUnsealedSelectOptions() {
  return [
    { tags: [], label: "Unsealed" },
    { tags: ["civilian"], label: "Unsealed·Civilians" },
    { tags: ["non_civilian"], label: "Unsealed·Non-civilians" },
  ].map(({ tags, label }) => ({
    label,
    href: filterPath("/indictments", { tags, unsealed: true }),
  }));
}

export function filterPath(basePath, filter) {
  const selected = normalizeTags(filter?.tags);
  const unsealed = filter?.unsealed === true;
  const main = catalogMainPath(basePath);
  const here = String(basePath || "").split("?")[0];
  const path =
    here === "/deaths/unconfirmed" && !selected.length
      ? here
      : main === "/group-operations" &&
          here.startsWith("/group-operations/") &&
          !selected.length
        ? here
        : pathForTagFilter(main, selected);
  const q = filterQuery({
    tags:
      PATH_TAGS[path] &&
      PATH_TAGS[path].length === selected.length &&
      PATH_TAGS[path].every((id) => selected.includes(id))
        ? []
        : selected,
    unsealed,
  });
  if (!q) return path;
  return `${path}?${q}`;
}

export function identityTagById(id) {
  return IDENTITY_TAGS.find((t) => t.id === id) || null;
}

export function attributeTagById(id) {
  return ATTRIBUTE_TAGS.find((t) => t.id === id) || null;
}

export function attributeTagByPath(pathname) {
  const p = String(pathname || "").split("?")[0];
  return ATTRIBUTE_TAGS.find((t) => t.path === p) || null;
}
