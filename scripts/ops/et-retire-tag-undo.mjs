#!/usr/bin/env node
/**
 * Restore people.tags from an et-retire-tag manifest. Lab only.
 * Sets only the tags column, and only where the current tags still equal the
 * stripped value (--force overrides). It does not write Notables, events, or any other table.
 *
 * Usage (lab only; dry-run is the default):
 *   node --env-file=<lab checkout>/.env scripts/ops/et-retire-tag-undo.mjs --tag federal_investigation --manifest ./var/ops/et-retire-tag/manifest-<tag>-<stamp>.json --dry-run
 *   Add --apply with ET_RETIRE_TAG_CONFIRM=lab to write.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_KIND,
  labGuard,
  parseOpsArgs,
  planUndo,
  rollback,
  rowsFrom,
  runAsMain,
  safeMessage,
  stripTag,
  tagSpellings,
  tagsEqual,
  withClient,
} from "./retire-tag-lib.mjs";
import { UPDATE_TAGS } from "./et-retire-tag.mjs";

export const SELECT_IDS = "SELECT id, tags FROM people WHERE id = ANY($1::text[]) ORDER BY id";

function readManifest(file, spell) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { ok: false, message: "manifest file could not be read as JSON" };
  }
  if (!data || data.kind !== MANIFEST_KIND) return { ok: false, message: `manifest kind is not ${MANIFEST_KIND}` };
  if (data.tag !== spell.TAG) return { ok: false, message: "refused: manifest tag does not match --tag" };
  if (data.dry_run === true) return { ok: false, message: "refused: dry-run preview is not an apply manifest" };
  if (!Array.isArray(data.cards)) return { ok: false, message: "manifest cards are missing" };
  return { ok: true, manifest: data };
}

async function runUndo(client, manifest, spell, { apply, force }) {
  const slugs = manifest.cards.map((card) => card.slug);
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    const selected = await client.query(apply ? `${SELECT_IDS} FOR UPDATE` : SELECT_IDS, [slugs]);
    const restored = [];
    const skipped = [];
    const noops = [];
    const pending = [];
    for (const item of planUndo(manifest, rowsFrom(selected))) {
      if (item.status === "missing") {
        skipped.push(`skipped missing ${item.slug}`);
        continue;
      }
      if (item.status === "noop") {
        noops.push(`noop ${item.slug}`);
        continue;
      }
      if (!force && !tagsEqual(item.current_tags, stripTag(item.prior_tags, spell))) {
        skipped.push(`skipped changed ${item.slug}`);
        continue;
      }
      pending.push(item);
    }
    if (!apply) {
      await client.query("ROLLBACK");
      return { restored: pending.map((item) => `restore ${item.slug}`), skipped, noops };
    }
    for (const item of pending) {
      const result = await client.query(UPDATE_TAGS, [
        JSON.stringify(item.prior_tags),
        item.slug,
        JSON.stringify(item.current_tags),
      ]);
      if (Number(result?.rowCount) !== 1) throw new Error(`update did not change exactly one row: ${item.slug}`);
      restored.push(`restored ${item.slug}`);
    }
    await client.query("COMMIT");
    return { restored, skipped, noops };
  } catch (err) {
    await rollback(client);
    throw err;
  }
}

export async function retireTagUndoMain({
  argv = process.argv,
  env = process.env,
  client = null,
  cwd = process.cwd(),
} = {}) {
  const parsed = parseOpsArgs(argv);
  if (!parsed.ok) return { code: 1, lines: [parsed.message] };
  const args = parsed.args;
  if (!args.manifestExplicit || !args.manifest) return { code: 1, lines: ["--manifest is required"] };
  const spell = tagSpellings(args.tag);
  if (!spell.ok) return { code: 1, lines: [spell.message] };
  const guard = labGuard(env, { apply: args.apply });
  if (!guard.ok) return { code: guard.code, lines: [guard.message] };
  const loaded = readManifest(path.resolve(cwd, args.manifest), spell);
  if (!loaded.ok) return { code: 1, lines: [loaded.message] };

  return withClient(client, env.DATABASE_URL, async (db) => {
    try {
      const outcome = await runUndo(db, loaded.manifest, spell, { apply: args.apply, force: args.force });
      return {
        code: 0,
        lines: [
          `host-kind ${guard.label}`,
          `tag ${spell.TAG}`,
          args.apply ? "apply" : "dry-run",
          ...outcome.restored,
          ...outcome.noops,
          ...outcome.skipped,
        ],
      };
    } catch (err) {
      return { code: 1, lines: [safeMessage(err)] };
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAsMain(retireTagUndoMain);
}
