#!/usr/bin/env node
/**
 * Annotate-only helper for indictment event `unsealed`.
 *
 * Dry-run unless --apply. Sets unsealed true only on indictment_civilian or
 * indictment_non_civilian events whose stored cite/comment text clearly
 * states unsealed or made public, and only when the current value is not
 * already true. A stored true is not cleared.
 *
 * Patches that one boolean on people.events and person_events.
 * Does not rewrite other person fields, operations, dog rows, or stills.
 * Does not write data/seed.json.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { planUnsealedAnnotations } from "../app/lib/event-attrs.mjs";
import { databaseUrl, loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import {
  closeStore,
  ensureSchema,
  getMemory,
  getPool,
  hydrateFileMemory,
  listPeople,
  loadSeedFile,
  writeFileStore,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));
const { dataDir } = resolveRoot(ROOT);
const seedPath = path.join(dataDir, "seed.json");
const bootstrapSql = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");

function setUnsealedTrue(events, kind) {
  let changed = false;
  const next = (events || []).map((ev) => {
    if (!ev || ev.kind !== kind || ev.unsealed === true) return ev;
    changed = true;
    return { ...ev, unsealed: true };
  });
  return { events: next, changed };
}

async function applyPlans(plans) {
  const pool = await getPool();
  if (!pool) {
    const mem = getMemory();
    let patched = 0;
    for (const plan of plans) {
      const row = (mem.people || []).find((person) => person.id === plan.id);
      if (!row) continue;
      const result = setUnsealedTrue(row.events, plan.kind);
      if (!result.changed) continue;
      row.events = result.events;
      patched += 1;
    }
    return patched;
  }
  let patched = 0;
  for (const plan of plans) {
    const current = await pool.query("SELECT events FROM people WHERE id = $1", [plan.id]);
    if (!current.rows[0]) continue;
    const result = setUnsealedTrue(current.rows[0].events || [], plan.kind);
    if (!result.changed) continue;
    await pool.query("UPDATE people SET events = $2::jsonb WHERE id = $1", [
      plan.id,
      JSON.stringify(result.events),
    ]);
    await pool.query(
      `UPDATE person_events
          SET unsealed = TRUE
        WHERE person_id = $1
          AND kind = $2
          AND unsealed IS DISTINCT FROM TRUE`,
      [plan.id, plan.kind],
    );
    patched += 1;
  }
  return patched;
}

const apply = process.argv.includes("--apply");

if (databaseUrl()) {
  const pool = await getPool();
  await ensureSchema(pool, bootstrapSql);
} else {
  hydrateFileMemory(dataDir, loadSeedFile(seedPath));
}

const plans = planUnsealedAnnotations(await listPeople());
console.log(
  `unsealed annotate ${apply ? "apply" : "dry-run"} planned=${plans.length}`,
);
for (const plan of plans) {
  console.log(`  ${plan.id} ${plan.kind}`);
}

if (apply && plans.length) {
  const patched = await applyPlans(plans);
  if (!databaseUrl()) writeFileStore(dataDir, getMemory());
  console.log(`unsealed annotate patched=${patched}`);
}

await closeStore();
