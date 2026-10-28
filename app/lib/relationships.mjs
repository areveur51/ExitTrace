/** One connection between two people. Not an event and not a career row. */

import { formatCareerYears, parseCareerYear } from "./career.mjs";
import { isOfficialCiteUrl } from "./official.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

export const RELATIONSHIP_KINDS = ["former_spouse", "parent_child", "professional"];

export const RELATIONSHIP_LABELS = [
  "Ex-husband",
  "Ex-wife",
  "Spouse",
  "Former spouse",
  "Son",
  "Father",
  "Speechwriter",
  "Principal",
  "Personal chef",
];

export const CITE_FLOOR = 2;
export const NOTE_MAX = 240;

const GROUP_ORDER = ["Family", "Professional"];

export class RelationshipError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RelationshipError";
    this.code = code;
  }
}

function requiredText(raw) {
  return String(raw || "").trim();
}

function requirePersonId(raw) {
  const id = requiredText(raw);
  if (!id) throw new RelationshipError("both people are required", "relationship_person");
  return id;
}

function requirePersonName(raw) {
  const name = requiredText(raw);
  if (!name) throw new RelationshipError("both people are required", "relationship_person");
  return name;
}

function requireLabel(raw) {
  const label = requiredText(raw);
  if (!RELATIONSHIP_LABELS.includes(label)) {
    throw new RelationshipError("relationship label is not in the closed list", "relationship_label");
  }
  return label;
}

function cleanNote(raw) {
  const note = requiredText(raw);
  if (!note) return "";
  if (note.length > NOTE_MAX) {
    throw new RelationshipError("relationship note is too long", "relationship_note");
  }
  if (
    /[‘’“”]/.test(note) ||
    /\b(?:unsealed|unsealing|made public|celebrity|today)\b/i.test(note)
  ) {
    throw new RelationshipError("relationship note is not stored", "relationship_note");
  }
  return note;
}

export function relationshipGroup(kind) {
  if (kind === "parent_child" || kind === "former_spouse") return "Family";
  if (kind === "professional") return "Professional";
  return "";
}

function requireYear(raw) {
  if (raw == null || raw === "") return null;
  const year = parseCareerYear(raw);
  if (year == null) {
    throw new RelationshipError("relationship year is out of range", "relationship_year");
  }
  return year;
}

function prepareSources(sources) {
  if (!Array.isArray(sources)) {
    throw new RelationshipError("relationship cites are required", "relationship_cite");
  }
  const seen = new Set();
  const out = [];
  for (const source of sources) {
    const url = requiredText(source?.url);
    if (!url || !isOfficialCiteUrl(url)) {
      throw new RelationshipError("relationship cite is not official news or government", "relationship_cite");
    }
    const key = canonicalPublicUrl(url) || url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      publisher: requiredText(source.publisher || source.source_label),
      url,
      date: requiredText(source.date),
      title: requiredText(source.title),
      snippet: requiredText(source.snippet || source.quote),
    });
  }
  if (out.length < CITE_FLOOR) {
    throw new RelationshipError("a relationship needs two official cites", "relationship_cite_floor");
  }
  return out;
}

/**
 * One stored edge. person_a sorts before person_b.
 * a_calls_b is the label on person_a's card. b_calls_a is the label on person_b's card.
 * Names are checked here and are not stored. The page reads names from the people rows.
 */
export function prepareRelationship(input = {}) {
  const leftId = requirePersonId(input.left_id);
  const rightId = requirePersonId(input.right_id);
  requirePersonName(input.left_name);
  requirePersonName(input.right_name);
  if (leftId === rightId) {
    throw new RelationshipError("a person cannot connect to the same card", "relationship_self");
  }
  const kind = requiredText(input.kind);
  if (!RELATIONSHIP_KINDS.includes(kind)) {
    throw new RelationshipError("relationship kind is not drawn in this release", "relationship_kind");
  }
  const leftCallsRight = requireLabel(input.left_calls_right);
  const rightCallsLeft = requireLabel(input.right_calls_left);
  const leftNote = cleanNote(input.left_note);
  const rightNote = cleanNote(input.right_note);
  const start_year = requireYear(input.start_year);
  const end_year = requireYear(input.end_year);
  if (start_year != null && end_year != null && end_year < start_year) {
    throw new RelationshipError("the end year is before the start year", "relationship_year_order");
  }
  const sources = prepareSources(input.sources);
  const leftFirst = leftId < rightId;
  const person_a = leftFirst ? leftId : rightId;
  const person_b = leftFirst ? rightId : leftId;
  const a_calls_b = leftFirst ? leftCallsRight : rightCallsLeft;
  const b_calls_a = leftFirst ? rightCallsLeft : leftCallsRight;
  const a_note = leftFirst ? leftNote : rightNote;
  const b_note = leftFirst ? rightNote : leftNote;
  return {
    id: `${person_a}--${person_b}--${kind.replaceAll("_", "-")}`,
    person_a,
    person_b,
    kind,
    a_calls_b,
    b_calls_a,
    a_note,
    b_note,
    start_year,
    end_year,
    sources,
  };
}

/** The line for the person whose card is open. A missing other name omits the line. */
export function relationshipView(stored, viewerId) {
  const viewer = requiredText(viewerId);
  if (!stored || typeof stored !== "object" || !viewer) return null;
  const personA = requiredText(stored.person_a);
  const personB = requiredText(stored.person_b);
  let otherId = "";
  let otherName = "";
  let label = "";
  if (viewer === personA) {
    otherId = personB;
    otherName = requiredText(stored.person_b_name);
    label = requiredText(stored.a_calls_b);
  } else if (viewer === personB) {
    otherId = personA;
    otherName = requiredText(stored.person_a_name);
    label = requiredText(stored.b_calls_a);
  } else {
    return null;
  }
  if (!otherId || !otherName || !label) return null;
  const kind = requiredText(stored.kind);
  if (!relationshipGroup(kind)) return null;
  return {
    otherId,
    otherName,
    label,
    kind,
    note: viewer === personA ? requiredText(stored.a_note) : requiredText(stored.b_note),
    years: formatCareerYears(stored.start_year, stored.end_year),
    sources: Array.isArray(stored.sources) ? stored.sources : [],
  };
}

export function relationshipViews(rows, viewerId) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => relationshipView(row, viewerId))
    .filter(Boolean);
}

/** Family, then Professional. Within a group, the other name. */
export function relationshipSections(rows, viewerId) {
  const lines = relationshipViews(rows, viewerId).slice().sort((a, b) => {
    const group = GROUP_ORDER.indexOf(relationshipGroup(a.kind)) - GROUP_ORDER.indexOf(relationshipGroup(b.kind));
    if (group) return group;
    return a.otherName.localeCompare(b.otherName);
  });
  const sections = [];
  for (const line of lines) {
    const label = relationshipGroup(line.kind);
    const last = sections[sections.length - 1];
    if (!last || last.label !== label) sections.push({ label, lines: [line] });
    else last.lines.push(line);
  }
  return sections;
}
