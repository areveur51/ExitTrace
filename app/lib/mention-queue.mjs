/**
 * Render-only X mention queue.
 * excluded from exittrace_lab_pub / publication SQL / NEW_KIND_RENDER_SYNC checklist.
 * Uniqueness is subject_status_id. First mention for that subject wins.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { getPool } from "./store.mjs";
import { canonicalPublicUrl } from "./urls.mjs";
import { buildReplyPlan } from "./mention-dig.mjs";
import { isSnowflake, resolveSubjectStatusId, statusUrl } from "./x-mentions.mjs";

export const MENTION_STATUSES = Object.freeze([
  "pending",
  "processing",
  "kept",
  "fail_closed",
  "rejected",
]);

export const POLL_MIN_MS = 5 * 60 * 1000;
export const POLL_MAX_MS = 15 * 60 * 1000;
export const LEASE_MIN_MS = 10 * 60 * 1000;
export const LEASE_MAX_MS = 15 * 60 * 1000;

const TERMINAL = new Set(["kept", "fail_closed", "rejected"]);

export class MentionQueueError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "MentionQueueError";
    this.code = code;
    this.status = status;
  }
}

let memory = [];

export function resetMentionQueue() {
  memory = [];
}

export function clampRange(raw, min, max, fallback) {
  const n = Number(raw);
  const value = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(max, Math.max(min, value));
}

export function pollIntervalMs(raw = process.env.MENTION_POLL_MS) {
  return clampRange(raw, POLL_MIN_MS, POLL_MAX_MS, 10 * 60 * 1000);
}

export function claimLeaseMs(raw = process.env.MENTION_CLAIM_LEASE_MS) {
  return clampRange(raw, LEASE_MIN_MS, LEASE_MAX_MS, 12 * 60 * 1000);
}

export function authorWindowMs(raw = process.env.MENTION_AUTHOR_WINDOW_MS) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 60 * 60 * 1000;
  return n;
}

export function authorMax(raw = process.env.MENTION_AUTHOR_MAX) {
  if (raw === undefined || raw === "") return 5;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 5;
  return n;
}

export function blocklist(raw = process.env.MENTION_BLOCKLIST) {
  const set = new Set();
  for (const part of String(raw || "").split(",")) {
    const text = part.trim().replace(/^@/, "").toLowerCase();
    if (text) set.add(text);
  }
  return set;
}

export function isBlocked(row, list = blocklist()) {
  const id = String(row?.author_id || "").trim().toLowerCase();
  const handle = String(row?.author_handle || "").trim().replace(/^@/, "").toLowerCase();
  return (id && list.has(id)) || (handle && list.has(handle));
}

function tokenEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function readMentionTokens(env = process.env) {
  const bot = String(env.MENTION_QUEUE_BOT_TOKEN || "").trim();
  const worker = String(env.MENTION_QUEUE_WORKER_TOKEN || "").trim();
  if (!bot || !worker || bot === worker) {
    return { bot: "", worker: "", misconfigured: true };
  }
  return { bot, worker, misconfigured: false };
}

export function bearerToken(header) {
  const text = String(header || "");
  const match = text.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : "";
}

export function mentionRole(headers = {}, env = process.env) {
  const tokens = readMentionTokens(env);
  if (tokens.misconfigured) {
    throw new MentionQueueError("unauthorized", "unauthorized", 401);
  }
  const got = bearerToken(headers.authorization || headers.Authorization);
  if (!got) throw new MentionQueueError("unauthorized", "unauthorized", 401);
  if (tokenEqual(got, tokens.bot)) return "bot";
  if (tokenEqual(got, tokens.worker)) return "worker";
  throw new MentionQueueError("unauthorized", "unauthorized", 401);
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function jsonValue(value, field) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    throw new MentionQueueError(`${field} must be JSON`, "invalid_json", 400);
  }
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new MentionQueueError(`${field} must be JSON`, "invalid_json", 400);
  }
  if (encoded.length > 20_000) {
    throw new MentionQueueError(`${field} is too large`, "invalid_json", 400);
  }
  return value;
}

function assertStatusUrl(raw, id, field) {
  const canonical = canonicalPublicUrl(raw);
  if (!canonical || !canonical.includes(`/status/${id}`)) {
    throw new MentionQueueError(`${field} must be the status URL`, "invalid_url", 400);
  }
  return canonical;
}

export function normalizeEnqueueInput(input = {}) {
  const resolved = resolveSubjectStatusId(input);
  if (!resolved.ok) {
    throw new MentionQueueError("mention_status_id is required", "invalid_mention_id", 400);
  }
  const givenSubject = String(input.subject_status_id || "").trim();
  if (givenSubject && givenSubject !== resolved.subject_status_id) {
    throw new MentionQueueError(
      "subject_status_id does not match the referenced post",
      "subject_mismatch",
      400,
    );
  }
  const author_id = String(input.author_id || "").trim();
  if (!isSnowflake(author_id)) {
    throw new MentionQueueError("author_id is required", "invalid_author", 400);
  }
  const author_handle = String(input.author_handle || "").trim().replace(/^@/, "");
  if (author_handle && !/^[A-Za-z0-9_]{1,15}$/.test(author_handle)) {
    throw new MentionQueueError("author_handle is invalid", "invalid_author", 400);
  }
  const author_display_name = String(input.author_display_name || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
  const text = String(input.text || "");
  if (text.length > 10_000) {
    throw new MentionQueueError("text is too long", "invalid_text", 400);
  }
  const subject_url = assertStatusUrl(
    input.subject_url || statusUrl(resolved.subject_status_id, resolved.subject_from === "mention" ? author_handle : ""),
    resolved.subject_status_id,
    "subject_url",
  );
  const mention_url = assertStatusUrl(
    input.mention_url || statusUrl(resolved.mention_status_id, author_handle),
    resolved.mention_status_id,
    "mention_url",
  );
  return {
    subject_status_id: resolved.subject_status_id,
    mention_status_id: resolved.mention_status_id,
    subject_from: resolved.subject_from,
    subject_url,
    mention_url,
    author_id,
    author_handle,
    author_display_name,
    text,
    media_json: jsonValue(input.media_json, "media_json"),
    referenced_json: jsonValue(
      input.referenced_json == null ? resolved.referenced_json : input.referenced_json,
      "referenced_json",
    ),
  };
}

function publicRow(row) {
  if (!row) return null;
  return {
    subject_status_id: row.subject_status_id,
    mention_status_id: row.mention_status_id,
    subject_url: row.subject_url,
    mention_url: row.mention_url,
    author_id: row.author_id,
    author_handle: row.author_handle,
    author_display_name: row.author_display_name || "",
    text: row.text,
    media_json: row.media_json,
    referenced_json: row.referenced_json,
    status: row.status,
    claim_owner: row.claim_owner,
    claim_until: row.claim_until,
    kept_person_slug: row.kept_person_slug,
    reply_soft_at: row.reply_soft_at,
    reply_final_at: row.reply_final_at,
    error_reason: row.error_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPg(row) {
  if (!row) return null;
  return publicRow({
    ...row,
    claim_until: iso(row.claim_until),
    reply_soft_at: iso(row.reply_soft_at),
    reply_final_at: iso(row.reply_final_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    media_json: row.media_json,
    referenced_json: row.referenced_json,
    claim_owner: row.claim_owner || null,
    kept_person_slug: row.kept_person_slug || null,
    error_reason: row.error_reason || null,
    author_handle: row.author_handle || "",
    author_display_name: row.author_display_name || "",
    text: row.text || "",
  });
}

function authorMatch(row, author_id, author_handle) {
  if (author_id && row.author_id === author_id) return true;
  const handle = String(author_handle || "").toLowerCase();
  return Boolean(handle) && String(row.author_handle || "").toLowerCase() === handle;
}

function claimable(row, now) {
  if (row.status === "pending") return true;
  if (row.status !== "processing") return false;
  if (!row.claim_until) return true;
  return new Date(row.claim_until).getTime() <= now.getTime();
}

function needsFinalReply(row) {
  if (row.reply_final_at) return false;
  if (row.status === "kept") return true;
  if ((row.status === "fail_closed" || row.status === "rejected") && row.reply_soft_at) return true;
  return false;
}

export async function enqueueMention(input, { now = new Date() } = {}) {
  const row = normalizeEnqueueInput(input);
  const p = await getPool();
  if (p) return enqueuePg(p, row, now);
  const existing = memory.find((item) => item.subject_status_id === row.subject_status_id);
  if (existing) return { ok: true, created: false, duplicate: true, row: publicRow(existing) };
  if (isBlocked(row)) throw new MentionQueueError("blocked", "blocked", 403);
  const windowStart = now.getTime() - authorWindowMs();
  const recent = memory.filter(
    (item) =>
      new Date(item.created_at).getTime() >= windowStart &&
      authorMatch(item, row.author_id, row.author_handle),
  );
  if (recent.length >= authorMax()) {
    throw new MentionQueueError("rate limited", "rate_limited", 429);
  }
  const stored = {
    ...row,
    status: "pending",
    claim_owner: null,
    claim_until: null,
    kept_person_slug: null,
    reply_soft_at: null,
    reply_final_at: null,
    error_reason: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  delete stored.subject_from;
  memory.push(stored);
  return { ok: true, created: true, duplicate: false, row: publicRow(stored) };
}

async function enqueuePg(p, row, now) {
  const client = await p.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT * FROM mention_queue WHERE subject_status_id = $1",
      [row.subject_status_id],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      committed = true;
      return { ok: true, created: false, duplicate: true, row: mapPg(existing.rows[0]) };
    }
    if (isBlocked(row)) throw new MentionQueueError("blocked", "blocked", 403);
    const windowStart = new Date(now.getTime() - authorWindowMs());
    const count = await client.query(
      `SELECT count(*)::int AS n FROM mention_queue
        WHERE created_at >= $1
          AND (($2 <> '' AND author_id = $2) OR ($3 <> '' AND lower(author_handle) = lower($3)))`,
      [windowStart.toISOString(), row.author_id, row.author_handle],
    );
    if (count.rows[0].n >= authorMax()) {
      throw new MentionQueueError("rate limited", "rate_limited", 429);
    }
    const inserted = await client.query(
       `INSERT INTO mention_queue (
         subject_status_id, mention_status_id, subject_url, mention_url,
         author_id, author_handle, author_display_name, text, media_json, referenced_json, status,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'pending',$11,$11
       )
       ON CONFLICT (subject_status_id) DO NOTHING
       RETURNING *`,
      [
        row.subject_status_id,
        row.mention_status_id,
        row.subject_url,
        row.mention_url,
        row.author_id,
        row.author_handle,
        row.author_display_name,
        row.text,
        row.media_json == null ? null : JSON.stringify(row.media_json),
        row.referenced_json == null ? null : JSON.stringify(row.referenced_json),
        now.toISOString(),
      ],
    );
    await client.query("COMMIT");
    committed = true;
    if (!inserted.rows[0]) {
      const again = await p.query(
        "SELECT * FROM mention_queue WHERE subject_status_id = $1",
        [row.subject_status_id],
      );
      return { ok: true, created: false, duplicate: true, row: mapPg(again.rows[0]) };
    }
    return { ok: true, created: true, duplicate: false, row: mapPg(inserted.rows[0]) };
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getMention(subjectStatusId) {
  const id = String(subjectStatusId || "").trim();
  if (!isSnowflake(id)) return null;
  const p = await getPool();
  if (!p) return publicRow(memory.find((row) => row.subject_status_id === id) || null);
  const q = await p.query("SELECT * FROM mention_queue WHERE subject_status_id = $1", [id]);
  return mapPg(q.rows[0]);
}

export async function listPendingMentions({ limit = 10, now = new Date() } = {}) {
  const cap = clampLimit(limit);
  const p = await getPool();
  if (!p) {
    return memory
      .filter((row) => claimable(row, now))
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, cap)
      .map(publicRow);
  }
  const q = await p.query(
    `SELECT * FROM mention_queue
      WHERE status = 'pending'
         OR (status = 'processing' AND (claim_until IS NULL OR claim_until <= $1))
      ORDER BY created_at ASC
      LIMIT $2`,
    [now.toISOString(), cap],
  );
  return q.rows.map(mapPg);
}

export async function listUnrepliedMentions({ limit = 10 } = {}) {
  const cap = clampLimit(limit);
  const p = await getPool();
  if (!p) {
    return memory
      .filter(needsFinalReply)
      .slice()
      .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))
      .slice(0, cap)
      .map(publicRow);
  }
  const q = await p.query(
    `SELECT * FROM mention_queue
      WHERE reply_final_at IS NULL
        AND (
          status = 'kept'
          OR (status IN ('fail_closed', 'rejected') AND reply_soft_at IS NOT NULL)
        )
      ORDER BY updated_at ASC
      LIMIT $1`,
    [cap],
  );
  return q.rows.map(mapPg);
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.min(25, Math.floor(n));
}

export async function claimMention({
  subject_status_id,
  claim_owner,
  now = new Date(),
  leaseMs,
} = {}) {
  const owner = String(claim_owner || "").trim();
  if (!owner || owner.length > 80) {
    throw new MentionQueueError("claim_owner is required", "missing_owner", 400);
  }
  const until = new Date(now.getTime() + (leaseMs || claimLeaseMs())).toISOString();
  const p = await getPool();
  if (p) return claimPg(p, { subject_status_id, owner, now, until });
  let row;
  if (subject_status_id) {
    row = memory.find((item) => item.subject_status_id === String(subject_status_id));
    if (!row) throw new MentionQueueError("not found", "not_found", 404);
  } else {
    row = memory
      .filter((item) => claimable(item, now))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    if (!row) return { ok: true, claimed: false, row: null };
  }
  if (TERMINAL.has(row.status)) {
    throw new MentionQueueError("already finished", "already_finished", 409);
  }
  const leaseOpen =
    row.status === "processing" &&
    row.claim_until &&
    new Date(row.claim_until).getTime() > now.getTime();
  if (leaseOpen && row.claim_owner !== owner) {
    throw new MentionQueueError("claimed", "claimed", 409);
  }
  if (leaseOpen && row.claim_owner === owner) {
    return { ok: true, claimed: true, replayed: true, row: publicRow(row) };
  }
  row.status = "processing";
  row.claim_owner = owner;
  row.claim_until = until;
  row.updated_at = now.toISOString();
  return { ok: true, claimed: true, replayed: false, row: publicRow(row) };
}

async function claimPg(p, { subject_status_id, owner, now, until }) {
  const client = await p.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    let id = String(subject_status_id || "").trim();
    if (!id) {
      const next = await client.query(
        `SELECT subject_status_id FROM mention_queue
          WHERE status = 'pending'
             OR (status = 'processing' AND (claim_until IS NULL OR claim_until <= $1))
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [now.toISOString()],
      );
      if (!next.rows[0]) {
        await client.query("COMMIT");
        committed = true;
        return { ok: true, claimed: false, row: null };
      }
      id = next.rows[0].subject_status_id;
    }
    const current = await client.query(
      "SELECT * FROM mention_queue WHERE subject_status_id = $1 FOR UPDATE",
      [id],
    );
    const row = current.rows[0];
    if (!row) throw new MentionQueueError("not found", "not_found", 404);
    if (TERMINAL.has(row.status)) {
      throw new MentionQueueError("already finished", "already_finished", 409);
    }
    const leaseOpen =
      row.status === "processing" &&
      row.claim_until &&
      new Date(row.claim_until).getTime() > now.getTime();
    if (leaseOpen && row.claim_owner !== owner) {
      throw new MentionQueueError("claimed", "claimed", 409);
    }
    if (leaseOpen && row.claim_owner === owner) {
      await client.query("COMMIT");
      committed = true;
      return { ok: true, claimed: true, replayed: true, row: mapPg(row) };
    }
    const updated = await client.query(
      `UPDATE mention_queue
          SET status = 'processing', claim_owner = $2, claim_until = $3, updated_at = $4
        WHERE subject_status_id = $1
          AND (
            status = 'pending'
            OR (status = 'processing' AND (claim_until IS NULL OR claim_until <= $4 OR claim_owner = $2))
          )
        RETURNING *`,
      [id, owner, until, now.toISOString()],
    );
    if (!updated.rows[0]) throw new MentionQueueError("claimed", "claimed", 409);
    await client.query("COMMIT");
    committed = true;
    return { ok: true, claimed: true, replayed: false, row: mapPg(updated.rows[0]) };
  } catch (err) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function completeMention({
  subject_status_id,
  claim_owner,
  status,
  kept_person_slug,
  error_reason,
  now = new Date(),
} = {}) {
  const owner = String(claim_owner || "").trim();
  const id = String(subject_status_id || "").trim();
  if (!isSnowflake(id)) throw new MentionQueueError("subject_status_id is required", "invalid_subject", 400);
  if (!owner) throw new MentionQueueError("claim_owner is required", "missing_owner", 400);
  if (!TERMINAL.has(status)) {
    throw new MentionQueueError("status must be kept, fail_closed, or rejected", "invalid_status", 400);
  }
  let slug = String(kept_person_slug || "").trim();
  let reason = error_reason == null ? "" : String(error_reason).trim();
  if (status === "kept") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new MentionQueueError("kept_person_slug is required", "missing_slug", 400);
    }
    reason = "";
  } else {
    slug = "";
    if (!/^[a-z0-9_]{1,80}$/.test(reason) || /https?:/i.test(reason)) {
      throw new MentionQueueError("error_reason must be a short code", "invalid_reason", 400);
    }
  }
  const p = await getPool();
  if (!p) {
    const row = memory.find((item) => item.subject_status_id === id);
    if (!row) throw new MentionQueueError("not found", "not_found", 404);
    if (TERMINAL.has(row.status)) {
      const same =
        row.status === status &&
        (row.kept_person_slug || "") === slug &&
        (row.error_reason || "") === reason;
      if (!same) throw new MentionQueueError("already finished", "already_finished", 409);
      return { ok: true, replayed: true, row: publicRow(row) };
    }
    if (row.status !== "processing" || row.claim_owner !== owner) {
      throw new MentionQueueError("claim required", "claim_required", 409);
    }
    if (row.claim_until && new Date(row.claim_until).getTime() <= now.getTime()) {
      throw new MentionQueueError("claim expired", "claim_expired", 409);
    }
    row.status = status;
    row.kept_person_slug = slug || null;
    row.error_reason = reason || null;
    row.updated_at = now.toISOString();
    return { ok: true, replayed: false, row: publicRow(row) };
  }
  const current = await p.query("SELECT * FROM mention_queue WHERE subject_status_id = $1", [id]);
  const row = current.rows[0];
  if (!row) throw new MentionQueueError("not found", "not_found", 404);
  if (TERMINAL.has(row.status)) {
    const same =
      row.status === status &&
      (row.kept_person_slug || "") === slug &&
      (row.error_reason || "") === reason;
    if (!same) throw new MentionQueueError("already finished", "already_finished", 409);
    return { ok: true, replayed: true, row: mapPg(row) };
  }
  const updated = await p.query(
    `UPDATE mention_queue
        SET status = $2,
            kept_person_slug = $3,
            error_reason = $4,
            updated_at = $5
      WHERE subject_status_id = $1
        AND status = 'processing'
        AND claim_owner = $6
        AND (claim_until IS NULL OR claim_until > $5)
      RETURNING *`,
    [id, status, slug || null, reason || null, now.toISOString(), owner],
  );
  if (!updated.rows[0]) throw new MentionQueueError("claim required", "claim_required", 409);
  return { ok: true, replayed: false, row: mapPg(updated.rows[0]) };
}

export async function stampMentionReply({ subject_status_id, kind, now = new Date() } = {}) {
  const id = String(subject_status_id || "").trim();
  if (!isSnowflake(id)) throw new MentionQueueError("subject_status_id is required", "invalid_subject", 400);
  if (kind !== "soft" && kind !== "final") {
    throw new MentionQueueError("reply kind must be soft or final", "invalid_reply", 400);
  }
  const column = kind === "soft" ? "reply_soft_at" : "reply_final_at";
  const p = await getPool();
  if (!p) {
    const row = memory.find((item) => item.subject_status_id === id);
    if (!row) throw new MentionQueueError("not found", "not_found", 404);
    if (!row[column]) {
      row[column] = now.toISOString();
      row.updated_at = now.toISOString();
    }
    return { ok: true, row: publicRow(row) };
  }
  const updated = await p.query(
    `UPDATE mention_queue
        SET ${column} = COALESCE(${column}, $2),
            updated_at = CASE WHEN ${column} IS NULL THEN $2 ELSE updated_at END
      WHERE subject_status_id = $1
      RETURNING *`,
    [id, now.toISOString()],
  );
  if (!updated.rows[0]) throw new MentionQueueError("not found", "not_found", 404);
  return { ok: true, row: mapPg(updated.rows[0]) };
}

export async function planMentionReply(subjectStatusId, { origin, now = new Date() } = {}) {
  const row = await getMention(subjectStatusId);
  if (!row) throw new MentionQueueError("not found", "not_found", 404);
  let priorFinal = Boolean(row.reply_final_at);
  if (row.status === "kept" && row.kept_person_slug && !priorFinal) {
    const p = await getPool();
    const siblings = p
      ? (
          await p.query(
            `SELECT subject_status_id, reply_final_at FROM mention_queue
              WHERE kept_person_slug = $1 AND subject_status_id <> $2 AND reply_final_at IS NOT NULL
              LIMIT 1`,
            [row.kept_person_slug, row.subject_status_id],
          )
        ).rows
      : memory.filter(
          (item) =>
            item.kept_person_slug === row.kept_person_slug &&
            item.subject_status_id !== row.subject_status_id &&
            item.reply_final_at,
        );
    priorFinal = siblings.length > 0;
  }
  void now;
  const publicOrigin = origin || process.env.EXITTRACE_PUBLIC_ORIGIN || "";
  return { ok: true, row, ...buildReplyPlan(row, { origin: publicOrigin, priorFinal }) };
}
