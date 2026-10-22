#!/usr/bin/env node
/**
 * Restore people.tags from an et-retire-fedinv-tag manifest. Lab only.
 * Sets only the tags column. people has no updated_at column, and savePerson
 * does not bump one, so this script does not set a timestamp.
 * It does not write Notables, events, or any other table.
 *
 * Usage (lab only; dry-run is the default). Run on the lab host with the lab
 * checkout's .env (DATABASE_URL is read from the environment; the script exits
 * non-zero when it is missing):
 *   node --env-file=<lab checkout>/.env scripts/ops/et-retire-fedinv-tag-undo.mjs --manifest ./var/ops/et-retire-fedinv-tag/manifest-<stamp>.json --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  labGuard,
  parseOpsArgs,
  planUndo,
  stripTag,
  tagArray,
  tagsEqual,
} from "./retire-fedinv-lib.mjs";

const SELECT_IDS = "SELECT id, tags FROM people WHERE id = ANY($1::text[]) ORDER BY id";

// people has no updated_at column. savePerson rewrites the person row and
// does not bump a timestamp, so this statement sets only the tags column.
const UPDATE_TAGS =
  "UPDATE people SET tags = $1::jsonb WHERE id = $2 AND tags = $3::jsonb";

function safeMessage(err) {
  const text = String(err?.message || "failed");
  if (text.includes("://") || /password|DATABASE_URL/i.test(text)) return "database query failed";
  return text;
}

function rowsFrom(selected) {
  return (selected?.rows || []).map((row) => ({
    id: row.id,
    tags: tagArray(row.tags),
  }));
}

function readManifest(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, message: "manifest file could not be read" };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "manifest is not valid JSON" };
  }
  if (!data || data.kind !== "et-retire-fedinv-tag") {
    return { ok: false, message: "manifest kind is not et-retire-fedinv-tag" };
  }
  if (data.dry_run === true) {
    return { ok: false, message: "refused: dry-run preview is not an apply manifest" };
  }
  if (!Array.isArray(data.cards)) {
    return { ok: false, message: "manifest cards are missing" };
  }
  return { ok: true, manifest: data };
}

async function openClient(url) {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    try {
      await client.end();
    } catch {
      /* connection never opened */
    }
    throw err;
  }
  return client;
}

async function rollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* transaction already closed */
  }
}

async function runUndo(client, manifest, { apply, force }) {
  const slugs = manifest.cards.map((card) => card.slug);
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    const selected = await client.query(apply ? `${SELECT_IDS} FOR UPDATE` : SELECT_IDS, [slugs]);
    const plan = planUndo(manifest, rowsFrom(selected));
    const restored = [];
    const skipped = [];
    const noops = [];
    const pending = [];
    for (const item of plan) {
      if (item.status === "missing") {
        skipped.push(`skipped missing ${item.slug}`);
        continue;
      }
      if (item.status === "noop") {
        noops.push(`noop ${item.slug}`);
        continue;
      }
      const unchanged = tagsEqual(item.current_tags, stripTag(item.prior_tags));
      if (!unchanged && !force) {
        skipped.push(`skipped changed ${item.slug}`);
        continue;
      }
      pending.push(item);
    }
    if (!apply) {
      await client.query("ROLLBACK");
      return {
        restored: pending.map((item) => `restore ${item.slug}`),
        skipped,
        noops,
      };
    }
    for (const item of pending) {
      const result = await client.query(UPDATE_TAGS, [
        JSON.stringify(item.prior_tags),
        item.slug,
        JSON.stringify(item.current_tags),
      ]);
      if (Number(result?.rowCount) !== 1) {
        throw new Error(`update did not change exactly one row: ${item.slug}`);
      }
      restored.push(`restored ${item.slug}`);
    }
    await client.query("COMMIT");
    return { restored, skipped, noops };
  } catch (err) {
    await rollback(client);
    throw err;
  }
}

export async function retireFedinvUndoMain({
  argv = process.argv,
  env = process.env,
  client = null,
  cwd = process.cwd(),
} = {}) {
  const parsed = parseOpsArgs(argv);
  if (!parsed.ok) return { code: 1, lines: [parsed.message] };
  const args = parsed.args;
  if (!args.manifestExplicit || !args.manifest) {
    return { code: 1, lines: ["--manifest is required"] };
  }
  const guard = labGuard(env, { apply: args.apply });
  if (!guard.ok) return { code: guard.code, lines: [guard.message] };

  const manifestPath = path.resolve(cwd, args.manifest);
  const loaded = readManifest(manifestPath);
  if (!loaded.ok) return { code: 1, lines: [loaded.message] };

  let db = client;
  let own = false;
  if (!db) {
    own = true;
    try {
      db = await openClient(env.DATABASE_URL);
    } catch {
      return { code: 1, lines: ["database connection failed"] };
    }
  }

  try {
    const outcome = await runUndo(db, loaded.manifest, {
      apply: args.apply,
      force: args.force,
    });
    return {
      code: 0,
      lines: [
        `host-kind ${guard.label}`,
        args.apply ? "apply" : "dry-run",
        ...outcome.restored,
        ...outcome.noops,
        ...outcome.skipped,
      ],
    };
  } catch (err) {
    return { code: 1, lines: [safeMessage(err)] };
  } finally {
    if (own) {
      try {
        await db.end();
      } catch {
        /* close */
      }
    }
  }
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  retireFedinvUndoMain()
    .then((result) => {
      const write = result.code === 0 ? console.log : console.error;
      for (const line of result.lines || []) write(line);
      process.exit(result.code || 0);
    })
    .catch(() => {
      console.error("failed");
      process.exit(1);
    });
}
