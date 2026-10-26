/**
 * Worf: the bootstrap SQL a subscriber runs (stripBootDataWrites) must be valid
 * SQL on its own. A marker pair that cut a DO / BEGIN block in half would only
 * fail at boot on Render. This applies the stripped SQL to an EMPTY throwaway
 * Postgres: the CI service container in .github/workflows/test.yml.
 *
 * ET_SCRATCH_PG_URL must be a plain loopback URL (tests/scratch-pg.mjs: no query,
 * fragment or user, no routing PG* env, and the server's address, port and
 * database are checked after connect). Never lab, never Render. The test skips
 * unless that variable is set; the test job's postgres
 * service sets it (see docs/github-auto-deploy.md, "Boot on a subscriber").
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripBootDataWrites } from "../app/lib/boot-guard.mjs";
import { ensureSchema } from "../app/lib/store.mjs";
import { connectScratch, scratchPgTarget } from "./scratch-pg.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
const URL_ENV = process.env.ET_SCRATCH_PG_URL || "";

async function userTableCount(client) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
  );
  return r.rows[0].n;
}

test(
  "stripped bootstrap SQL applies to an empty Postgres (subscriber boot path), and re-runs",
  { skip: URL_ENV ? false : "ET_SCRATCH_PG_URL not set (needs the test job's postgres service)", timeout: 60_000 },
  async () => {
    const client = await connectScratch(scratchPgTarget(URL_ENV));
    try {
      assert.equal(await userTableCount(client), 0, "scratch database must start EMPTY");
      const stripped = stripBootDataWrites(BOOTSTRAP);
      assert.notEqual(stripped, BOOTSTRAP);

      await ensureSchema(client, stripped);
      const after = await userTableCount(client);
      assert.ok(after > 10, `stripped SQL created the schema (tables=${after})`);
      for (const table of ["people", "person_events", "dog_comms", "central_casting_comms", "et_meta", "epstein_flight_legs"]) {
        const r = await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${table}`]);
        assert.equal(r.rows[0].ok, true, table);
      }
      const nn = await client.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'central_casting_comms' AND column_name = 'person_id'`,
      );
      assert.equal(nn.rows[0].is_nullable, "NO");

      // Boot runs it on every start: the stripped SQL must be re-runnable.
      await ensureSchema(client, stripped);
      // The publisher path (full SQL) also applies on top.
      await ensureSchema(client, BOOTSTRAP);
    } finally {
      await client.end();
    }
  },
);
