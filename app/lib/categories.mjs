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
    nav: "CEOs",
    path: "/deaths/ceos",
    blurb: "Deaths of chief executives, chairs, and controlling founders of major firms.",
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

/** Person categories a promote may write. dog_comms is catalog-only, not a person row. */
export const PROMOTE_CATEGORY_IDS = [
  "firings",
  "resignations",
  "government_stepdowns",
  "death_celebrity",
  "death_official",
  "death_ceo",
  "arrests",
  "indictment_civilian",
  "indictment_non_civilian",
];

/** KEEP kinds classify may write for identified death rows. */
export const DEATH_KEEP_IDS = [
  "death_celebrity",
  "death_official",
  "death_ceo",
];

/** KEEP kinds classify may write for identified indictment rows. */
export const INDICTMENT_KEEP_IDS = [
  "indictment_civilian",
  "indictment_non_civilian",
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
  return IMPORT_ALIASES[key] || null;
}

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function categoryByPath(pathname) {
  return CATEGORIES.find((c) => c.path === pathname) || null;
}

export function isDeathCategory(id) {
  return String(id).startsWith("death_");
}

export function isIndictmentKeepKind(id) {
  return INDICTMENT_KEEP_IDS.includes(String(id));
}

export function isIndictmentCategory(id) {
  return String(id).startsWith("indictment_");
}

export function isIndexCategory(id) {
  const key = String(id);
  return key === "death_unspecified" || key === "indictment_unspecified";
}

/** Person kinds a catalog path lists. Parents are the KEEP union; children are one kind. */
export function catalogListKinds(id) {
  const key = String(id);
  if (key === "death_unspecified") return DEATH_KEEP_IDS.slice();
  if (key === "indictment_unspecified") return INDICTMENT_KEEP_IDS.slice();
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

export function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}
