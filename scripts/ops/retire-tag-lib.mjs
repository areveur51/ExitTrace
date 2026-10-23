/**
 * Shared helpers for retiring a person fact tag from people.tags. Plan helpers are
 * pure; the CLI helpers at the end take an injected pg-like client ({ query }).
 * The tag id is passed with --tag. TAG (underscore form) and HYPHEN (route form)
 * are derived from it, and only those two exact spellings are removed.
 */

import fs from "node:fs";
import path from "node:path";
import { normalizeTag } from "../../app/lib/tags.mjs";

export const MANIFEST_KIND = "et-retire-tag";
export const CONFIRM_ENV = "ET_RETIRE_TAG_CONFIRM";

/** Lab database: loopback only, on the lab Postgres port. */
export const LAB_HOSTS = Object.freeze(["127.0.0.1", "localhost"]);
export const LAB_DB_PORT = "5433";

/** Hosted database names that are always refused, before the allowlist. */
const DENY_HOST = [/^dpg-/i, /render\.com/i, /oregon-postgres/i];

const ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * Derive both stored spellings from a tag id.
 * "federal_investigation" or "federal-investigation" -> TAG federal_investigation, HYPHEN federal-investigation.
 */
export function tagSpellings(raw) {
  const id = String(raw || "").trim().replace(/-/g, "_");
  if (!ID_RE.test(id)) return { ok: false, message: "--tag must be a lowercase tag id like some_fact_tag" };
  return { ok: true, TAG: id, HYPHEN: id.replace(/_/g, "-") };
}

/** Refuse a tag the app still defines; the code removal ships first. */
export function retiredTagCheck(raw) {
  const spell = tagSpellings(raw);
  if (!spell.ok) return spell;
  if (normalizeTag(spell.TAG)) {
    return { ok: false, message: `refused: ${spell.TAG} is still a live tag in app/lib/tags.mjs` };
  }
  return spell;
}

export function isRetiredSpelling(value, spell) {
  return value === spell.TAG || value === spell.HYPHEN;
}

export function tagsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Copy a jsonb tags value into an array. Non-arrays become [].
 * TODO: fold into the shared parseJsonList helper once that PR lands.
 */
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

/** New array with only the two exact retired spellings removed. Order and every other element stay. */
export function stripTag(tags, spell) {
  const list = Array.isArray(tags) ? tags : [];
  return list.filter((item) => !isRetiredSpelling(item, spell));
}

/** Rows that still store the tag. Sorted by slug. prior_tags is a copy of the stored array. */
export function planStrip(rows, spell) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const tags = Array.isArray(row?.tags) ? row.tags : null;
    if (!tags || !tags.some((item) => isRetiredSpelling(item, spell))) continue;
    out.push({ slug: row.id, prior_tags: tags.slice(), next_tags: stripTag(tags, spell) });
  }
  out.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  return out;
}

export function buildManifest(plan, spell, meta = {}) {
  return {
    kind: MANIFEST_KIND,
    tag: spell.TAG,
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
    if (tagsEqual(current, prior)) return { slug, prior_tags: prior, current_tags: current, status: "noop" };
    return { slug, prior_tags: prior, current_tags: current, next_tags: prior.slice(), status: "restore" };
  });
}

/**
 * Lab-only gate: an allowlist, not a denylist. The URL host must be 127.0.0.1 or
 * localhost and the port must be the lab Postgres port. dpg-*, render.com and
 * oregon-postgres hosts are refused first. Messages never include the URL or host.
 */
export function labGuard(env = {}, { apply = false } = {}) {
  const raw = env.DATABASE_URL;
  if (raw == null || String(raw).trim() === "") {
    return { ok: false, code: 1, message: "DATABASE_URL is missing or empty" };
  }
  if (String(env.RENDER ?? "").trim() !== "") {
    return { ok: false, code: 1, message: "refused: RENDER is set; this script is lab only" };
  }
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return { ok: false, code: 1, message: "DATABASE_URL is not a usable database URL" };
  }
  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, code: 1, message: "DATABASE_URL is not a usable database URL" };
  if (DENY_HOST.some((re) => re.test(host))) {
    return { ok: false, code: 1, message: "refused: database host is a hosted database, not the lab" };
  }
  if (!LAB_HOSTS.includes(host) || url.port !== LAB_DB_PORT) {
    return { ok: false, code: 1, message: "refused: database host is not the lab (loopback on the lab port)" };
  }
  if (apply && env[CONFIRM_ENV] !== "lab") {
    return { ok: false, code: 1, message: `refused: --apply requires ${CONFIRM_ENV}=lab` };
  }
  return { ok: true, code: 0, label: "lab" };
}

export function manifestStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Default manifest dir is under process.cwd() (var/ is gitignored), never a hardcoded checkout root. */
export function defaultManifestPath(cwd, spell, date) {
  return path.join(
    path.resolve(cwd || "."),
    "var",
    "ops",
    "et-retire-tag",
    `manifest-${spell.TAG}-${manifestStamp(date)}.json`,
  );
}

export function parseOpsArgs(argv) {
  const out = { apply: false, dryRun: true, manifest: "", manifestExplicit: false, force: false, tag: "" };
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  let sawDry = false;
  let sawApply = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dry-run") { sawDry = true; continue; }
    if (arg === "--apply") { sawApply = true; continue; }
    if (arg === "--force") { out.force = true; continue; }
    const valued = ["--manifest", "--tag"].find((name) => arg === name || arg.startsWith(`${name}=`));
    if (valued) {
      const value = arg === valued ? args[i + 1] : arg.slice(valued.length + 1);
      if (arg === valued) i += 1;
      if (!value || value.startsWith("--")) return { ok: false, message: `${valued} requires a value` };
      if (valued === "--tag") out.tag = value;
      else { out.manifest = value; out.manifestExplicit = true; }
      continue;
    }
    if (String(arg).includes("://")) return { ok: false, message: "unknown argument" };
    return { ok: false, message: `unknown argument: ${arg}` };
  }
  if (sawDry && sawApply) return { ok: false, message: "--dry-run and --apply are mutually exclusive" };
  if (!out.tag) return { ok: false, message: "--tag <id> is required" };
  if (sawApply) { out.apply = true; out.dryRun = false; }
  return { ok: true, args: out };
}

// ---- CLI helpers shared by et-retire-tag.mjs and et-retire-tag-undo.mjs ----

/** Error text without the URL or credentials. */
export function safeMessage(err) {
  const text = String(err?.message || "failed");
  if (text.includes("://") || /password|DATABASE_URL/i.test(text)) return "database query failed";
  return text;
}

export function rowsFrom(selected) {
  return (selected?.rows || []).map((row) => ({ id: row.id, tags: tagArray(row.tags) }));
}

/** Manifest dir is 0700 and the file is 0600. Writes a .partial file, then renames it into place. */
export function writePrivateJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tmp = `${filePath}.${process.pid}.partial`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, 0o600);
}

export async function rollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* transaction already closed */
  }
}

/** Connect with the repo's pg only when no client was injected. */
export async function withClient(client, url, fn) {
  if (client) return fn(client);
  const { default: pg } = await import("pg");
  const own = new pg.Client({ connectionString: url });
  try {
    await own.connect();
  } catch {
    try {
      await own.end();
    } catch {
      /* never opened */
    }
    return { code: 1, lines: ["database connection failed"], manifestPath: null };
  }
  try {
    return await fn(own);
  } finally {
    try {
      await own.end();
    } catch {
      /* close */
    }
  }
}

/** Print result lines and exit with the result code. */
export function runAsMain(main) {
  main()
    .then((result) => {
      const write = result.code === 0 ? console.log : console.error;
      for (const line of result.lines || []) write(line);
      process.exitCode = result.code || 0;
    })
    .catch(() => {
      console.error("failed");
      process.exitCode = 1;
    });
}
