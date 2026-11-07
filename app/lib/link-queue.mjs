import { getPool } from "./store.mjs";

const MAX_LINKS = 100;
const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "m.twitter.com"]);
const HANDLE = "([A-Za-z0-9_]{1,30})";
const STATUS_ID = "(\\d{2,25})";

/** In-file queue when no database is configured. Tests use this path. */
const memoryRows = [];
let memorySeq = 1;

export function resetLinkQueueForTests() {
  memoryRows.length = 0;
  memorySeq = 1;
}

/** Unset DATABASE_URL is the test path. Only the lab database stores this queue. */
export function linkQueueWritable() {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return true;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  return (host === "127.0.0.1" || host === "localhost") && port === "5433";
}

export function splitPostLinks(raw) {
  return String(raw || "")
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * One X status or one Truth Social post. Tracking query is dropped.
 * The stored URL is the clean status URL. Dedup is platform + status id.
 */
export function parsePostLink(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (X_HOSTS.has(host)) {
    const match = parsed.pathname.match(new RegExp(`^/${HANDLE}/status/${STATUS_ID}/?$`));
    if (!match) return null;
    return {
      platform: "x",
      statusId: match[2],
      url: `https://x.com/${match[1]}/status/${match[2]}`,
    };
  }
  if (host === "truthsocial.com") {
    const match =
      parsed.pathname.match(new RegExp(`^/@${HANDLE}/posts/${STATUS_ID}/?$`)) ||
      parsed.pathname.match(new RegExp(`^/@${HANDLE}/${STATUS_ID}/?$`)) ||
      parsed.pathname.match(new RegExp(`^/users/${HANDLE}/statuses/${STATUS_ID}/?$`));
    if (!match) return null;
    return {
      platform: "truth",
      statusId: match[2],
      url: `https://truthsocial.com/@${match[1]}/posts/${match[2]}`,
    };
  }
  return null;
}

export function describeEnqueue(result) {
  const parts = [];
  const queued = Number(result?.queued) || 0;
  const duplicate = Number(result?.duplicate) || 0;
  const rejected = Number(result?.rejected) || 0;
  if (queued === 1) parts.push("Queued 1 post.");
  else if (queued > 1) parts.push(`Queued ${queued} posts.`);
  if (duplicate === 1) parts.push("1 post was already queued.");
  else if (duplicate > 1) parts.push(`${duplicate} posts were already queued.`);
  if (rejected === 1) parts.push("1 link is not an X or Truth Social post.");
  else if (rejected > 1) parts.push(`${rejected} links are not X or Truth Social posts.`);
  if (result?.limited) parts.push("100 posts is the limit for one submit.");
  return parts.join(" ");
}

function mapRow(row) {
  return {
    id: String(row.id),
    platform: row.platform,
    statusId: row.status_id || row.statusId,
    url: row.url,
    status: row.status,
    reason: row.reason || "",
    createdAt: row.created_at || row.createdAt || "",
  };
}

export async function listLinkQueue() {
  const pool = await getPool();
  if (!pool) return memoryRows.map(mapRow);
  const result = await pool.query(
    `SELECT id, platform, status_id, url, status, reason, created_at
     FROM link_queue
     ORDER BY created_at ASC, id ASC`,
  );
  return result.rows.map(mapRow);
}

export async function enqueuePostLinks(raw) {
  const pieces = splitPostLinks(raw);
  if (!pieces.length) {
    return { queued: 0, duplicate: 0, rejected: 0, limited: false, empty: true };
  }
  const limited = pieces.length > MAX_LINKS;
  const seen = new Set();
  const accepted = [];
  let duplicate = 0;
  let rejected = 0;
  for (const piece of pieces.slice(0, MAX_LINKS)) {
    const link = parsePostLink(piece);
    if (!link) {
      rejected += 1;
      continue;
    }
    const key = `${link.platform}:${link.statusId}`;
    if (seen.has(key)) {
      duplicate += 1;
      continue;
    }
    seen.add(key);
    accepted.push(link);
  }
  const pool = await getPool();
  let queued = 0;
  if (!pool) {
    for (const link of accepted) {
      const exists = memoryRows.some(
        (row) => row.platform === link.platform && row.statusId === link.statusId,
      );
      if (exists) {
        duplicate += 1;
        continue;
      }
      memoryRows.push({
        id: memorySeq++,
        platform: link.platform,
        statusId: link.statusId,
        url: link.url,
        status: "pending",
        reason: "",
        created_at: new Date().toISOString(),
      });
      queued += 1;
    }
    return { queued, duplicate, rejected, limited, empty: false };
  }
  for (const link of accepted) {
    const result = await pool.query(
      `INSERT INTO link_queue (platform, status_id, url)
       VALUES ($1, $2, $3)
       ON CONFLICT (platform, status_id) DO NOTHING
       RETURNING id`,
      [link.platform, link.statusId, link.url],
    );
    if (result.rowCount) queued += 1;
    else duplicate += 1;
  }
  return { queued, duplicate, rejected, limited, empty: false };
}

export async function removeLinkQueue(rawId) {
  const id = String(rawId || "").trim();
  if (!/^\d+$/.test(id)) return false;
  const pool = await getPool();
  if (!pool) {
    const index = memoryRows.findIndex(
      (row) => String(row.id) === id && row.status !== "processing",
    );
    if (index < 0) return false;
    memoryRows.splice(index, 1);
    return true;
  }
  const result = await pool.query(
    `DELETE FROM link_queue
     WHERE id = $1::bigint AND status IN ('pending', 'held')
     RETURNING id`,
    [id],
  );
  return result.rowCount > 0;
}
