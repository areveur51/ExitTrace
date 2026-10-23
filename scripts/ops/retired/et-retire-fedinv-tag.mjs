#!/usr/bin/env node
/**
 * Retire the federal_investigation person fact tag on the lab database.
 * Sets only people.tags. people has no updated_at column, and savePerson
 * does not bump one, so this script does not set a timestamp.
 * It does not write Notables, events, or any other table.
 *
 * Usage (lab only; dry-run is the default). Run on the lab host with the lab
 * checkout's .env (DATABASE_URL is read from the environment; the script exits
 * non-zero when it is missing):
 *   node --env-file=<lab checkout>/.env scripts/ops/et-retire-fedinv-tag.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  buildManifest,
  defaultManifestPath,
  labGuard,
  parseOpsArgs,
  planStrip,
  tagArray,
} from "./retire-fedinv-lib.mjs";

const SELECT_RETIRED =
  "SELECT id, tags FROM people WHERE tags ? 'federal_investigation' OR tags ? 'federal-investigation' ORDER BY id";

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

function writePrivateJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.partial`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, 0o600);
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

async function runDry(client) {
  await client.query("BEGIN READ ONLY");
  try {
    const selected = await client.query(SELECT_RETIRED);
    await client.query("ROLLBACK");
    return rowsFrom(selected);
  } catch (err) {
    await rollback(client);
    throw err;
  }
}

async function runApply(client, { manifestPath, createdAt, dbLabel }) {
  await client.query("BEGIN");
  try {
    const selected = await client.query(`${SELECT_RETIRED} FOR UPDATE`);
    const plan = planStrip(rowsFrom(selected));
    const manifest = buildManifest(plan, { created_at: createdAt, db_label: dbLabel });
    writePrivateJson(manifestPath, manifest);
    const changed = [];
    for (const card of plan) {
      const result = await client.query(UPDATE_TAGS, [
        JSON.stringify(card.next_tags),
        card.slug,
        JSON.stringify(card.prior_tags),
      ]);
      if (Number(result?.rowCount) !== 1) {
        throw new Error(`update did not change exactly one row: ${card.slug}`);
      }
      changed.push(card.slug);
    }
    await client.query("COMMIT");
    return changed;
  } catch (err) {
    await rollback(client);
    throw err;
  }
}

export async function retireFedinvMain({
  argv = process.argv,
  env = process.env,
  client = null,
  cwd = process.cwd(),
  now = new Date(),
} = {}) {
  const parsed = parseOpsArgs(argv);
  if (!parsed.ok) return { code: 1, lines: [parsed.message], manifestPath: null };
  const args = parsed.args;
  const guard = labGuard(env, { apply: args.apply });
  if (!guard.ok) return { code: guard.code, lines: [guard.message], manifestPath: null };

  const manifestPath = args.manifestExplicit
    ? path.resolve(cwd, args.manifest)
    : defaultManifestPath(cwd, now);
  const createdAt = now.toISOString();

  let db = client;
  let own = false;
  if (!db) {
    own = true;
    try {
      db = await openClient(env.DATABASE_URL);
    } catch {
      return { code: 1, lines: ["database connection failed"], manifestPath: null };
    }
  }

  try {
    if (args.apply) {
      const changed = await runApply(db, {
        manifestPath,
        createdAt,
        dbLabel: guard.label,
      });
      return {
        code: 0,
        manifestPath,
        lines: [
          `host-kind ${guard.label}`,
          "apply",
          `count ${changed.length}`,
          ...changed,
          `manifest ${manifestPath}`,
        ],
      };
    }

    const rows = await runDry(db);
    let previewPath = null;
    if (args.manifestExplicit) {
      const preview = buildManifest(planStrip(rows), {
        created_at: createdAt,
        db_label: guard.label,
      });
      preview.dry_run = true;
      writePrivateJson(manifestPath, preview);
      previewPath = manifestPath;
    }
    return {
      code: 0,
      manifestPath: previewPath,
      lines: [
        `host-kind ${guard.label}`,
        "dry-run",
        `count ${rows.length}`,
        ...rows.map((row) => `${row.id} ${JSON.stringify(row.tags)}`),
        ...(previewPath ? [`preview ${previewPath}`] : []),
      ],
    };
  } catch (err) {
    return { code: 1, lines: [safeMessage(err)], manifestPath: null };
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
  retireFedinvMain()
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
