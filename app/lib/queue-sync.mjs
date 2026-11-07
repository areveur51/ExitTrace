/** Merge lab and public post-queue rows. Dedup key is platform + status id. */

export const QUEUE_STATUS_RANK = Object.freeze({
  pending: 0,
  processing: 1,
  held: 2,
  done: 3,
});

export function queueRowKey(row) {
  return `${row?.platform || ""}:${row?.statusId || ""}`;
}

export function normalizeQueueRow(row) {
  const status = ["pending", "processing", "held", "done"].includes(row?.status)
    ? row.status
    : "pending";
  return {
    platform: row.platform,
    statusId: String(row.statusId || ""),
    url: String(row.url || ""),
    status,
    reason: String(row.reason || ""),
    createdAt: row.createdAt || row.created_at || "",
  };
}

function rank(status) {
  const n = QUEUE_STATUS_RANK[status];
  return Number.isInteger(n) ? n : -1;
}

/** Higher status wins: done > held > processing > pending. Same rank keeps a reason and the older createdAt. */
export function pickQueueRow(left, right) {
  const a = normalizeQueueRow(left);
  const b = normalizeQueueRow(right);
  const ra = rank(a.status);
  const rb = rank(b.status);
  if (rb > ra) return b;
  if (ra > rb) return a;
  const reason = a.reason || b.reason;
  const aTime = Date.parse(a.createdAt) || Number.POSITIVE_INFINITY;
  const bTime = Date.parse(b.createdAt) || Number.POSITIVE_INFINITY;
  const older = bTime < aTime ? b : a;
  return { ...older, reason };
}

export function mergeQueueRows(left, right) {
  const map = new Map();
  for (const row of [...(left || []), ...(right || [])]) {
    const normalized = normalizeQueueRow(row);
    if (!normalized.platform || !normalized.statusId) continue;
    const key = queueRowKey(normalized);
    const prev = map.get(key);
    map.set(key, prev ? pickQueueRow(prev, normalized) : normalized);
  }
  return [...map.values()];
}

export function liveQueueRows(rows) {
  return (rows || []).filter((row) => row.status !== "done");
}

export function queuePeerOrigin() {
  const raw = String(
    process.env.ET_QUEUE_PEER_URL || process.env.EXITTRACE_PUBLIC_ORIGIN || "",
  ).trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "https://exittrace.onrender.com";
}

export function queueSyncToken() {
  return String(process.env.ET_QUEUE_SYNC_TOKEN || "").trim();
}
