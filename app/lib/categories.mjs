export const CATEGORIES = [
  {
    id: "firings",
    kind: "person",
    title: "Firings",
    nav: "Firings",
    path: "/firings",
    blurb: "Public-role dismissals recorded by contemporaneous news reports.",
  },
  {
    id: "resignations",
    kind: "person",
    title: "Resignations",
    nav: "Resignations",
    path: "/resignations",
    blurb: "Announced resignations from public or corporate roles.",
  },
  {
    id: "government_stepdowns",
    kind: "person",
    title: "Officials",
    nav: "Officials",
    path: "/government",
    blurb: "People tagged official — government, appointed, military, or law-enforcement roles. One card per person; celebrity, CEO, and other tags may also apply.",
  },
  {
    id: "arrests",
    kind: "person",
    title: "Arrests",
    nav: "Arrests",
    path: "/arrests",
    blurb: "Public-role arrests recorded by contemporaneous news reports.",
  },
  {
    id: "corona_comms",
    kind: "person",
    title: "Corona Comms",
    nav: "Corona",
    path: "/corona-comms",
    blurb: "Identified people who carry the corona comms tag. Parent lists every tagged person; there is no child split.",
  },
  {
    id: "indictment_civilian",
    kind: "person",
    title: "Indictments — civilians",
    nav: "Civilians",
    path: "/indictments/civilians",
    blurb: "Indictments of private persons recorded by contemporaneous news reports.",
  },
  {
    id: "indictment_non_civilian",
    kind: "person",
    title: "Indictments — non-civilians",
    nav: "Non-civilians",
    path: "/indictments/non-civilians",
    blurb: "Indictments of government, appointed, military, or law-enforcement persons recorded by contemporaneous news reports.",
  },
  {
    id: "indictment_unspecified",
    kind: "person",
    title: "Indictments",
    nav: "Indictments",
    path: "/indictments",
    blurb: "Indictments of civilians and non-civilians recorded by contemporaneous news reports.",
  },
  {
    id: "death_celebrity",
    kind: "person",
    title: "Deaths — celebrities",
    nav: "Celebrities",
    path: "/deaths/celebrities",
    blurb: "Deaths of widely known public figures in arts, sport, and entertainment.",
  },
  {
    id: "death_official",
    kind: "person",
    title: "Deaths — officials",
    nav: "Officials",
    path: "/deaths/officials",
    blurb: "Deaths of current or former government officials and heads of state.",
  },
  {
    id: "death_ceo",
    kind: "person",
    title: "Deaths — CEOs",
    nav: "Executives",
    path: "/deaths/ceos",
    blurb: "Deaths of chief executives, chairs, and controlling founders of major firms.",
  },
  {
    id: "death_unconfirmed",
    kind: "person",
    title: "Death*",
    nav: "Unconfirmed*",
    path: "/deaths/unconfirmed",
    blurb:
      "Unconfirmed death claims. Not a confirmed death. A calendar date is stored only when a cite states YYYY-MM-DD. Death date, cause, and location stay empty.",
  },
  {
    id: "death_unspecified",
    kind: "person",
    title: "Deaths",
    nav: "Deaths",
    path: "/deaths",
    blurb: "Deaths of celebrities, officials, and CEOs recorded by contemporaneous news reports.",
  },
  {
    id: "missing_kids",
    kind: "operation",
    title: "Operations — missing kids",
    nav: "Missing Kids",
    path: "/group-operations/missing-kids",
    blurb: "Operations tagged missing kids. Lists operations, not people. Named children are not stored.",
  },
  {
    id: "human_smuggling",
    kind: "operation",
    title: "Operations — human smuggling",
    nav: "Human Smuggling",
    path: "/group-operations/human-smuggling",
    blurb: "Operations tagged human smuggling. Lists operations, not people. Named children are not stored.",
  },
  {
    id: "fugitives",
    kind: "operation",
    title: "Operations — fugitives",
    nav: "Fugitives",
    path: "/group-operations/fugitives",
    blurb: "Operations tagged fugitives. Lists operations, not people. Named children are not stored.",
  },
  {
    id: "cybercrime",
    kind: "operation",
    title: "Operations — cybercrime",
    nav: "Cybercrime",
    path: "/group-operations/cybercrime",
    blurb: "Operations tagged cybercrime. Lists operations, not people. Named children are not stored.",
  },
  {
    id: "drug_trafficking",
    kind: "operation",
    title: "Operations — drug trafficking",
    nav: "Drug Trafficking",
    path: "/group-operations/drug-trafficking",
    blurb: "Operations tagged drug trafficking. Lists operations, not people. Named children are not stored.",
  },
  {
    id: "violent_crime",
    kind: "operation",
    title: "Operations — violent crime",
    nav: "Violent Crime",
    path: "/group-operations/violent-crime",
    blurb: "Operations tagged violent crime. Lists operations, not people. Named children are not stored.",
  },
  {
    id: "fraud",
    kind: "operation",
    title: "Operations — fraud",
    nav: "Fraud",
    path: "/group-operations/fraud",
    blurb: "Operations tagged fraud. Lists operations, not people. Named children are not stored.",
  },
  {
    id: "group_ops_unspecified",
    kind: "operation",
    title: "Operations",
    nav: "Operations",
    path: "/group-operations",
    blurb: "Identified operations. Parent lists every signed operation. Child paths filter by tag. Named children are not stored.",
  },
  {
    id: "unsorted",
    kind: "source",
    title: "Unsorted",
    nav: "Unsorted",
    path: "/unsorted",
    blurb: "Public source posts not yet identified as people. Category guess is kept for later classify.",
  },
  {
    id: "dog_comms",
    kind: "dog",
    title: "Dog comms",
    nav: "Dog comms",
    path: "/dog-comms",
    blurb: "Official government posts about dogs, or that include a dog in the image. Stored locally; the source URL is a citation only.",
  },
  {
    id: "red_folder_comms",
    kind: "red_folder",
    title: "Red Folder comms",
    nav: "Red Folder comms",
    path: "/red-folder-comms",
    blurb: "Stored official and news-org posts about a red folder. Catalog page of posts, not a person row. Stored locally; the source URL is a citation only.",
  },
  {
    id: "central_casting",
    kind: "central_casting",
    title: "Central Casting",
    nav: "Central Casting",
    path: "/central-casting",
    blurb: "One card per identified person, not a harvest clip. This catalog holds both Trump “looks the part / Hollywood ideal” and “replacement” claim senses; filter by sense. Classifications are cite-backed badges on the existing person KEEP. Stored locally; the source URL is a citation only.",
  },
];

export const PERSON_CATEGORIES = CATEGORIES.filter((c) => c.kind === "person");

/** Categories the JSONL import will park. Commentary dog posts are skipped. */
export const IMPORT_CATEGORY_IDS = [
  "firings",
  "resignations",
  "government_stepdowns",
  "arrests",
  "death_unspecified",
];

/** Person categories a promote may write. dog_comms and red_folder_comms are post catalogs. central_casting annotates an existing person; it is not a new KEEP kind. */
export const PROMOTE_CATEGORY_IDS = [
  "firings",
  "resignations",
  "government_stepdowns",
  "death_celebrity",
  "death_official",
  "death_ceo",
  "arrests",
  "corona_comms",
  "indictment_civilian",
  "indictment_non_civilian",
];

/**
 * Confirmed death KEEP kinds. death_unconfirmed is not a member.
 * Confirmed counts, /deaths, child celebrity/official/ceo lists, and death
 * dashboard slices use this set only.
 */
export const DEATH_KEEP_IDS = [
  "death_celebrity",
  "death_official",
  "death_ceo",
];

/**
 * Unconfirmed death claim. Not a confirmed death.
 * Asterisk is the UI label (Death* / Unconfirmed*), not a column.
 * event_date may be NULL (this kind only) unless a cite states YYYY-MM-DD.
 * death_date, cause, and location are never invented.
 * Leads are never auto-classified here. Admiral-named claim cites may park it.
 * Upgrade to a DEATH_KEEP_IDS kind still needs ≥2 official/gov/news cites,
 * a calendar date, and CLEAR.
 */
export const DEATH_UNCONFIRMED_ID = "death_unconfirmed";

/** KEEP kinds classify may write for identified indictment rows. */
export const INDICTMENT_KEEP_IDS = [
  "indictment_civilian",
  "indictment_non_civilian",
];

/** Signed operation filter tags. Not unique-person KEEP kinds. Later siblings append here. */
export const GROUP_OPS_KEEP_IDS = [
  "missing_kids",
  "human_smuggling",
  "fugitives",
  "cybercrime",
  "drug_trafficking",
  "violent_crime",
  "fraud",
];

const IMPORT_ALIASES = {
  firings: "firings",
  firing: "firings",
  resignations: "resignations",
  resignation: "resignations",
  government_stepdowns: "government_stepdowns",
  government: "government_stepdowns",
  arrests: "arrests",
  arrest: "arrests",
  death_unspecified: "death_unspecified",
  death: "death_unspecified",
  deaths: "death_unspecified",
};

export function mapImportCategory(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!key) return null;
  if (key === "dog_comms" || key === "dog" || key === "dog_comm" || key === "dogcomms") {
    return null;
  }
  if (
    key === "red_folder_comms" ||
    key === "red_folder" ||
    key === "redfolder" ||
    key === "red_folder_comm" ||
    key === "redfoldercomms"
  ) {
    return null;
  }
  if (
    key === "central_casting_comms" ||
    key === "central_casting" ||
    key === "centralcasting" ||
    key === "central_casting_comm" ||
    key === "centralcastingcomms"
  ) {
    return null;
  }
  return IMPORT_ALIASES[key] || null;
}

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function categoryByPath(pathname) {
  return CATEGORIES.find((c) => c.path === pathname) || null;
}

export function isDeathUnconfirmed(id) {
  return String(id) === DEATH_UNCONFIRMED_ID;
}

/**
 * Confirmed death catalog ids and the /deaths parent index.
 * death_unconfirmed is excluded so startsWith("death_") count paths
 * do not treat an unconfirmed claim as a confirmed death.
 */
export function isDeathCategory(id) {
  const key = String(id);
  if (isDeathUnconfirmed(key)) return false;
  return key.startsWith("death_");
}

/** Death trail: confirmed kinds, the /deaths parent, and Unconfirmed*. */
export function isDeathFamily(id) {
  return isDeathCategory(id) || isDeathUnconfirmed(id);
}

/** Person-detail event rows. death_unconfirmed is shown; it is not a promote kind. */
export function isDisplayedEventKind(id) {
  const key = String(id || "").trim();
  return PROMOTE_CATEGORY_IDS.includes(key) || isDeathUnconfirmed(key);
}

export function isIndictmentKeepKind(id) {
  return INDICTMENT_KEEP_IDS.includes(String(id));
}

export function isIndictmentCategory(id) {
  return String(id).startsWith("indictment_");
}

export function isGroupOpsKeepKind(id) {
  return GROUP_OPS_KEEP_IDS.includes(String(id));
}

/** Parent index plus signed operation-tag children. Later siblings append to GROUP_OPS_KEEP_IDS. */
export function isGroupOpsCategory(id) {
  const key = String(id);
  return key === "group_ops_unspecified" || isGroupOpsKeepKind(key);
}

export function isOperationCategory(id) {
  return isGroupOpsCategory(id);
}

export function isIndexCategory(id) {
  const key = String(id);
  return (
    key === "death_unspecified" ||
    key === "indictment_unspecified" ||
    key === "group_ops_unspecified"
  );
}

/** Catalog path kinds. Person parents are the KEEP union; group-ops parents are signed operation tags. */
export function catalogListKinds(id) {
  const key = String(id);
  if (key === "death_unspecified") return DEATH_KEEP_IDS.slice();
  if (key === "indictment_unspecified") return INDICTMENT_KEEP_IDS.slice();
  if (key === "group_ops_unspecified") return GROUP_OPS_KEEP_IDS.slice();
  return [key];
}

export function formatUsd(n) {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  if (num >= 1e9) {
    const v = num / 1e9;
    return `$${v >= 10 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (num >= 1e6) {
    const v = num / 1e6;
    return `$${v >= 10 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

const X_CLOCK_RE = /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;
const ISO_TIME_RE = /T\d{2}:\d{2}/;
const SPACE_TIME_RE = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcMidnight(d) {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function localMidnight(d) {
  return (
    d.getHours() === 0 &&
    d.getMinutes() === 0 &&
    d.getSeconds() === 0 &&
    d.getMilliseconds() === 0
  );
}

function ymd(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** pg DATE often arrives as a JS Date at UTC or local midnight — not a stored clock. */
function dateLooksDateOnly(d) {
  return utcMidnight(d) || localMidnight(d);
}

/** True when the stored value itself carries a clock (ISO/X/time). Date-only is false. */
export function hasPostedTime(raw) {
  if (raw == null || raw === "") return false;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return false;
    return !dateLooksDateOnly(raw);
  }
  const s = String(raw).trim();
  if (!s || DATE_ONLY_RE.test(s)) return false;
  if (X_CLOCK_RE.test(s)) return true;
  if (ISO_TIME_RE.test(s) || SPACE_TIME_RE.test(s)) return true;
  if (/\d{2}:\d{2}:\d{2}/.test(s)) return true;
  return false;
}

/**
 * Keep posted datetime for CITE. Unlike calendar asDate, ISO/X clocks are not sliced to a day.
 * pg DATE (JS Date at midnight) stays `YYYY-MM-DD` so we do not invent 12:00 AM.
 */
export function asPostedAt(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    if (utcMidnight(raw)) return raw.toISOString().slice(0, 10);
    if (localMidnight(raw)) return ymd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
    return raw.toISOString();
  }
  const s = String(raw).trim();
  return s || null;
}

/** First candidate with a real clock, else the first present value. */
export function postedAtValue(...candidates) {
  const vals = [];
  for (const raw of candidates) {
    const v = asPostedAt(raw);
    if (v) vals.push(v);
  }
  return vals.find((v) => hasPostedTime(v)) || vals[0] || "";
}

function formatXClock(d) {
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).formatToParts(d);
  const hour = clock.find((p) => p.type === "hour")?.value;
  const minute = clock.find((p) => p.type === "minute")?.value;
  const period = String(clock.find((p) => p.type === "dayPeriod")?.value || "").toUpperCase();
  const date = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
  return `${hour}:${minute} ${period} · ${date}`;
}

/**
 * Shared CITE posted formatter (X-native): `6:39 PM · Aug 26, 2026`.
 * Date-only stored values stay `MMM D, YYYY` — no invented clock.
 */
export function formatPosted(raw) {
  if (raw == null || raw === "") return "—";
  if (raw instanceof Date) return formatPosted(asPostedAt(raw) || "");
  const s = String(raw).trim();
  if (!s) return "—";
  if (X_CLOCK_RE.test(s) && /·/.test(s)) return s;
  if (!hasPostedTime(s)) {
    const day = DATE_ONLY_RE.test(s) ? s : s.slice(0, 10);
    return DATE_ONLY_RE.test(day) ? formatDate(day) : s;
  }

  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const iso = /Z$|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const day = s.slice(0, 10);
    return DATE_ONLY_RE.test(day) ? formatDate(day) : s;
  }
  return formatXClock(d);
}

/** @deprecated use formatPosted — kept as the shared CITE alias. */
export const formatXDateTime = formatPosted;

export function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}
