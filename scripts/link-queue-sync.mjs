#!/usr/bin/env node
/**
 * Merge the lab post queue with the public copy. Lab database only.
 * Does not print the connection string.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyQueueRows } from "../app/lib/link-queue.mjs";
import { setPoolForTests } from "../app/lib/store.mjs";
import {
  mergeQueueRows,
  queuePeerOrigin,
  queueSyncToken,
} from "../app/lib/queue-sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (compatible; exittrace-check/1.0)";

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
    platform: row.platform,
    statusId: row.status_id || row.statusId,
    url: row.url,
    status: row.status,
    reason: row.reason || "",
    createdAt: row.created_at || row.createdAt || "",
  };
}

async function fetchPeerRows(origin) {
  const res = await fetch(`${origin}/api/queue`, {
    headers: { "Cache-Control": "no-store", "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`peer queue HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body?.rows) ? body.rows : [];
}

async function pushPeerRows(origin, token, rows) {
  const res = await fetch(`${origin}/api/queue/sync`, {
    method: "POST",
    headers: {
      "Cache-Control": "no-store",
      "User-Agent": UA,
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`peer sync HTTP ${res.status}`);
  return res.json();
}

async function fallbackPush(origin, localRows, remoteRows) {
  const remoteLive = new Map(
    remoteRows
      .filter((row) => row.status !== "done")
      .map((row) => [`${row.platform}:${row.statusId}`, row]),
  );
  const urls = [];
  for (const row of localRows) {
    if (row.status === "done") continue;
    const key = `${row.platform}:${row.statusId}`;
    if (!remoteLive.has(key)) urls.push(row.url);
  }
  if (urls.length) {
    const body = new URLSearchParams();
    body.set("urls", urls.join("\n"));
    const res = await fetch(`${origin}/queue`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new Error(`peer enqueue HTTP ${res.status}`);
  }
  for (const remote of remoteRows) {
    if (remote.status === "done") continue;
    const local = localRows.find(
      (row) => row.platform === remote.platform && row.statusId === remote.statusId,
    );
    if (local && local.status === "done" && remote.id) {
      const body = new URLSearchParams();
      body.set("action", "remove");
      body.set("id", String(remote.id));
      await fetch(`${origin}/queue`, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    }
  }
}

async function main() {
  const url = loadDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  setPoolForTests(client);
  const origin = queuePeerOrigin();
  try {
    const local = await client.query(
      `SELECT id, platform, status_id, url, status, reason, created_at
         FROM link_queue
        ORDER BY created_at ASC, id ASC`,
    );
    const localRows = local.rows.map(rowOut);
    const remoteRows = (await fetchPeerRows(origin)).map((row) => ({
      platform: row.platform,
      statusId: row.statusId,
      url: row.url,
      status: row.status,
      reason: row.reason || "",
      createdAt: row.createdAt || "",
      id: row.id,
    }));
    const merged = mergeQueueRows(localRows, remoteRows);
    const applied = await applyQueueRows(merged);
    const token = queueSyncToken();
    if (token) {
      await pushPeerRows(origin, token, merged);
    } else {
      await fallbackPush(origin, merged, remoteRows);
    }
    await client.query(
      `DELETE FROM link_queue
        WHERE status = 'done' AND created_at < now() - interval '7 days'`,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, local: localRows.length, remote: remoteRows.length, merged: merged.length, applied: applied.applied })}\n`,
    );
  } finally {
    setPoolForTests(null);
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message || "queue sync failed"}\n`);
  process.exit(1);
});
