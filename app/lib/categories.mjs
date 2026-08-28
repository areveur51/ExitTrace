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
    title: "Government step-downs",
    nav: "Gov. step-downs",
    path: "/government",
    blurb: "Officials leaving a government post by ouster, resignation from office, or election loss that ended the role.",
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
    id: "dog_comms",
    kind: "dog",
    title: "Dog comms",
    nav: "Dog comms",
    path: "/dog-comms",
    blurb: "Official government posts about dogs, or that include a dog in the image. Stored locally; the source URL is a citation only.",
  },
];

export const PERSON_CATEGORIES = CATEGORIES.filter((c) => c.kind === "person");

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function categoryByPath(pathname) {
  return CATEGORIES.find((c) => c.path === pathname) || null;
}

export function isDeathCategory(id) {
  return String(id).startsWith("death_");
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
