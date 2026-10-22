/** Pure helpers for retiring the federal_investigation person fact tag. No database. */

import path from "node:path";

export const TAG = "federal_investigation";
const HYPHEN = "federal-investigation";

export function isRetiredSpelling(value) {
  return value === TAG || value === HYPHEN;
}

export function tagsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Copy a jsonb tags value into an array. Non-arrays become []. */
export function tagArray(value) {
  if (Array.isArray(value)) return value.slice();
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.slice();
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * New array with only the exact retired spellings removed.
 * Order and every other element stay as they are, including fraud and unknown values.
 */
export function stripTag(tags) {
  const list = Array.isArray(tags) ? tags : [];
  return list.filter((item) => !isRetiredSpelling(item));
}

/** Rows that still store the tag. Sorted by slug. prior_tags is a copy of the stored array. */
export function planStrip(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const tags = Array.isArray(row?.tags) ? row.tags : null;
    if (!tags || !tags.some((item) => isRetiredSpelling(item))) continue;
    out.push({
      slug: row.id,
      prior_tags: tags.slice(),
      next_tags: stripTag(tags),
    });
  }
  out.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  return out;
}

export function buildManifest(plan, meta = {}) {
  return {
    kind: "et-retire-fedinv-tag",
    tag: TAG,
    created_at: meta.created_at,
    db_label: meta.db_label,
    cards: (Array.isArray(plan) ? plan : []).map((card) => ({
      slug: card.slug,
      prior_tags: Array.isArray(card.prior_tags) ? card.prior_tags.slice() : [],
    })),
  };
}

/**
 * Restore each manifest card to its exact prior_tags.
 * A missing card is reported. A card whose current tags already equal prior_tags is a no-op.
 */
export function planUndo(manifest, currentRows) {
  const byId = new Map();
  for (const row of Array.isArray(currentRows) ? currentRows : []) {
    if (row && row.id != null) byId.set(row.id, row);
  }
  const cards = Array.isArray(manifest?.cards) ? manifest.cards : [];
  return cards.map((card) => {
    const slug = card?.slug;
    const prior = Array.isArray(card?.prior_tags) ? card.prior_tags.slice() : [];
    const row = byId.get(slug);
    if (!row) return { slug, prior_tags: prior, status: "missing" };
    const current = tagArray(row.tags);
    if (tagsEqual(current, prior)) {
      return { slug, prior_tags: prior, current_tags: current, status: "noop" };
    }
    return {
      slug,
      prior_tags: prior,
      current_tags: current,
      next_tags: prior.slice(),
      status: "restore",
    };
  });
}

/** Lab-only gate. Messages never include the database URL or its host. */
export function labGuard(env = {}, { apply = false } = {}) {
  const raw = env.DATABASE_URL;
  if (raw == null || String(raw).trim() === "") {
    return { ok: false, code: 1, message: "DATABASE_URL is missing or empty" };
  }
  if (String(env.RENDER ?? "").trim() !== "") {
    return { ok: false, code: 1, message: "refused: RENDER is set; this script is lab only" };
  }
  let host = "";
  try {
    host = new URL(String(raw)).hostname;
  } catch {
    return { ok: false, code: 1, message: "DATABASE_URL is not a usable database URL" };
  }
  if (!host) {
    return { ok: false, code: 1, message: "DATABASE_URL is not a usable database URL" };
  }
  const folded = host.toLowerCase();
  if (folded.includes("render.com") || folded.includes("oregon-postgres")) {
    return { ok: false, code: 1, message: "refused: database host is not the lab" };
  }
  if (apply && env.ET_RETIRE_FEDINV_CONFIRM !== "lab") {
    return {
      ok: false,
      code: 1,
      message: "refused: --apply requires ET_RETIRE_FEDINV_CONFIRM=lab",
    };
  }
  return { ok: true, code: 0, label: "lab" };
}

export function manifestStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Default manifest path is under process.cwd(), never a hardcoded checkout root. */
export function defaultManifestPath(cwd, date) {
  return path.join(
    path.resolve(cwd || "."),
    "var",
    "ops",
    "et-retire-fedinv-tag",
    `manifest-${manifestStamp(date)}.json`,
  );
}

export function parseOpsArgs(argv) {
  const out = {
    apply: false,
    dryRun: true,
    manifest: "",
    manifestExplicit: false,
    force: false,
  };
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  let sawDry = false;
  let sawApply = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dry-run") {
      sawDry = true;
      continue;
    }
    if (arg === "--apply") {
      sawApply = true;
      continue;
    }
    if (arg === "--force") {
      out.force = true;
      continue;
    }
    if (arg === "--manifest" || arg.startsWith("--manifest=")) {
      const value = arg === "--manifest" ? args[i + 1] : arg.slice("--manifest=".length);
      if (arg === "--manifest") i += 1;
      if (!value || value.startsWith("--")) {
        return { ok: false, message: "--manifest requires a path" };
      }
      out.manifest = value;
      out.manifestExplicit = true;
      continue;
    }
    if (String(arg).includes("://")) return { ok: false, message: "unknown argument" };
    return { ok: false, message: `unknown argument: ${arg}` };
  }
  if (sawDry && sawApply) {
    return { ok: false, message: "--dry-run and --apply are mutually exclusive" };
  }
  if (sawApply) {
    out.apply = true;
    out.dryRun = false;
  }
  return { ok: true, args: out };
}
