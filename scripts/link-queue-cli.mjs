#!/usr/bin/env node
/**
 * Lab-only reader for /queue. list, claim, done, hold.
 * Refuses any database that is not 127.0.0.1 or localhost on port 5433.
 * Does not print the connection string.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STALE_HOURS = 6;

function loadDatabaseUrl() {
  const file = path.join(ROOT, ".env");
  const text = fs.readFileSync(file, "utf8");
  let url = "";
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\r/g, "").trim();
    if (!line || line.startsWith("#") || !line.startsWith("DATABASE_URL=")) continue;
    url = line.slice("DATABASE_URL=".length).trim();
    if (
      (url.startsWith('"') && url.endsWith('"')) ||
      (url.startsWith("'") && url.endsWith("'"))
    ) {
      url = url.slice(1, -1);
    }
  }
  if (!url) throw new Error("lab database is not configured");
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port;
  if (!["127.0.0.1", "localhost"].includes(host) || port !== "5433") {
    throw new Error("lab database only");
  }
  return url;
}

function rowOut(row) {
  return {
    id: String(row.id),
    platform: row.platform,
    statusId: row.status_id,
    url: row.url,
    status: row.status,
    reason: row.reason || "",
    createdAt: row.created_at,
  };
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    if (cmd === "list") {
      const result = await client.query(
        `SELECT id, platform, status_id, url, status, reason, created_at
         FROM link_queue
         ORDER BY created_at ASC, id ASC`,
      );
      process.stdout.write(`${JSON.stringify(result.rows.map(rowOut))}\n`);
      return;
    }
    if (cmd === "claim") {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE link_queue
         SET status = 'processing', claimed_at = now(), reason = ''
         WHERE id = (
           SELECT id FROM link_queue
           WHERE status = 'pending'
              OR (status = 'processing' AND claimed_at < now() - ($1::text || ' hours')::interval)
           ORDER BY created_at ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING id, platform, status_id, url, status, reason, created_at`,
        [String(STALE_HOURS)],
      );
      await client.query("COMMIT");
      if (!result.rowCount) {
        process.stdout.write("empty\n");
        return;
      }
      process.stdout.write(`${JSON.stringify(rowOut(result.rows[0]))}\n`);
      return;
    }
    if (cmd === "done") {
      if (!/^\d+$/.test(String(arg || ""))) throw new Error("done needs a queue id");
      const result = await client.query(
        `DELETE FROM link_queue WHERE id = $1::bigint AND status = 'processing' RETURNING id`,
        [arg],
      );
      if (!result.rowCount) throw new Error("queue row was not claimed");
      process.stdout.write("done\n");
      return;
    }
    if (cmd === "hold") {
      if (!/^\d+$/.test(String(arg || ""))) throw new Error("hold needs a queue id");
      const reason = rest.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
      if (!reason) throw new Error("hold needs a reason");
      const result = await client.query(
        `UPDATE link_queue
         SET status = 'held', reason = $2, claimed_at = NULL
         WHERE id = $1::bigint AND status = 'processing'
         RETURNING id`,
        [arg, reason],
      );
      if (!result.rowCount) throw new Error("queue row was not claimed");
      process.stdout.write("held\n");
      return;
    }
    throw new Error("usage: list | claim | done <id> | hold <id> <reason>");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* no open transaction */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message || "queue command failed"}\n`);
  process.exit(1);
});
