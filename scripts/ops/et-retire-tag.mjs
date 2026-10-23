#!/usr/bin/env node
/**
 * Retire one person fact tag from people.tags on the lab database.
 * Removes only the exact TAG and HYPHEN spellings derived from --tag. Sets only
 * people.tags (people has no updated_at column, and savePerson does not bump
 * one). It does not write Notables, events, or any other table.
 * Refuses a tag that app/lib/tags.mjs still defines: ship the code removal first.
 *
 * Usage (lab only; dry-run is the default). Run on the lab host with the lab
 * checkout's .env (DATABASE_URL is read from the environment; the script exits
 * non-zero when it is missing):
 *   node --env-file=<lab checkout>/.env scripts/ops/et-retire-tag.mjs --tag federal_investigation --dry-run
 *   ET_RETIRE_TAG_CONFIRM=lab node --env-file=<lab checkout>/.env scripts/ops/et-retire-tag.mjs --tag federal_investigation --apply
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildManifest,
  defaultManifestPath,
  labGuard,
  parseOpsArgs,
  planStrip,
  retiredTagCheck,
  rollback,
  rowsFrom,
  runAsMain,
  safeMessage,
  withClient,
  writePrivateJson,
} from "./retire-tag-lib.mjs";

export const SELECT_TAGGED =
  "SELECT id, tags FROM people WHERE tags ? $1 OR tags ? $2 ORDER BY id";

// Optimistic check: the row must still hold the exact prior tags array.
export const UPDATE_TAGS =
  "UPDATE people SET tags = $1::jsonb WHERE id = $2 AND tags = $3::jsonb";

async function runDry(client, spell) {
  await client.query("BEGIN READ ONLY");
  try {
    const selected = await client.query(SELECT_TAGGED, [spell.TAG, spell.HYPHEN]);
    await client.query("ROLLBACK");
    return rowsFrom(selected);
  } catch (err) {
    await rollback(client);
    throw err;
  }
}

async function runApply(client, spell, { manifestPath, createdAt, dbLabel }) {
  await client.query("BEGIN");
  try {
    const selected = await client.query(`${SELECT_TAGGED} FOR UPDATE`, [spell.TAG, spell.HYPHEN]);
    const plan = planStrip(rowsFrom(selected), spell);
    // The undo manifest is on disk before any UPDATE runs.
    writePrivateJson(manifestPath, buildManifest(plan, spell, { created_at: createdAt, db_label: dbLabel }));
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

export async function retireTagMain({
  argv = process.argv,
  env = process.env,
  client = null,
  cwd = process.cwd(),
  now = new Date(),
} = {}) {
  const parsed = parseOpsArgs(argv);
  if (!parsed.ok) return { code: 1, lines: [parsed.message], manifestPath: null };
  const args = parsed.args;
  const spell = retiredTagCheck(args.tag);
  if (!spell.ok) return { code: 1, lines: [spell.message], manifestPath: null };
  const guard = labGuard(env, { apply: args.apply });
  if (!guard.ok) return { code: guard.code, lines: [guard.message], manifestPath: null };

  const manifestPath = args.manifestExplicit
    ? path.resolve(cwd, args.manifest)
    : defaultManifestPath(cwd, spell, now);
  const createdAt = now.toISOString();

  return withClient(client, env.DATABASE_URL, async (db) => {
    try {
      if (args.apply) {
        const changed = await runApply(db, spell, { manifestPath, createdAt, dbLabel: guard.label });
        return {
          code: 0,
          manifestPath,
          lines: [`host-kind ${guard.label}`, `tag ${spell.TAG}`, "apply", `count ${changed.length}`, ...changed, `manifest ${manifestPath}`],
        };
      }
      const rows = await runDry(db, spell);
      let previewPath = null;
      if (args.manifestExplicit) {
        const preview = buildManifest(planStrip(rows, spell), spell, { created_at: createdAt, db_label: guard.label });
        preview.dry_run = true;
        writePrivateJson(manifestPath, preview);
        previewPath = manifestPath;
      }
      return {
        code: 0,
        manifestPath: previewPath,
        lines: [
          `host-kind ${guard.label}`,
          `tag ${spell.TAG}`,
          "dry-run",
          `count ${rows.length}`,
          ...rows.map((row) => `${row.id} ${JSON.stringify(row.tags)}`),
          ...(previewPath ? [`preview ${previewPath}`] : []),
        ],
      };
    } catch (err) {
      return { code: 1, lines: [safeMessage(err)], manifestPath: null };
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAsMain(retireTagMain);
}
