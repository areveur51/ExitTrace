/**
 * Claim the Render queue, dig fail-closed, write the lab lead, then reply.
 * A reply failure does not change queue status and does not stop the pass.
 * GitHub Actions is not this worker.
 * Empty pending and unreplied lists do no claim, dig, or reply work.
 */

import { spawn } from "node:child_process";
import { capturePublicKeepPage } from "./keep-page-shot.mjs";
import { digMention } from "./mention-dig.mjs";
import { pollIntervalMs } from "./mention-queue.mjs";
import { postReply, uploadTweetImage } from "./x-client.mjs";
import { queueEndpoint } from "./x-mention-poll.mjs";

export const COMPLETE_BODY_KEYS = Object.freeze([
  "subject_status_id",
  "claim_owner",
  "status",
  "kept_person_slug",
  "error_reason",
]);

/** Claim-next calls per worker pass. Digs stay sequential inside this cap. */
export const CLAIMS_PER_TICK = 5;

/** Under the 10–15 minute claim lease (default 12). */
export const DIG_TIMEOUT_MS = 9 * 60 * 1000;

export function workerJournal(result) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (!rows.length) return "";
  const errors = rows.filter((row) => row.reply_error || row.error).length;
  if (errors) return `mention_worker results=${rows.length} errors=${errors}`;
  return `mention_worker results=${rows.length}`;
}

const SCRUBBED = [
  "MENTION_QUEUE_BOT_TOKEN",
  "MENTION_QUEUE_WORKER_TOKEN",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
];

export function parseDigEnvelope(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("dig envelope must be an object");
  }
  return parsed;
}

export function scrubDigEnv(env = process.env) {
  const next = { ...env };
  for (const key of SCRUBBED) delete next[key];
  return next;
}

export function runDigCommand(row, { command, timeoutMs = DIG_TIMEOUT_MS, env = process.env } = {}) {
  if (!command) return Promise.reject(new Error("MENTION_DIG_COMMAND is unset"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      env: scrubDigEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("dig_timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("dig_failed"));
        return;
      }
      try {
        resolve(parseDigEnvelope(Buffer.concat(out).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.end(JSON.stringify(row));
  });
}

async function requestJson(fetchImpl, method, url, token, body) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!res.ok) {
    const error = new Error(payload.error || "queue request failed");
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function completeBody(row, dug, owner) {
  return {
    subject_status_id: row.subject_status_id,
    claim_owner: owner,
    status: dug.status,
    kept_person_slug: dug.kept_person_slug || "",
    error_reason: dug.error_reason || "",
  };
}

function plainFinalText(plan) {
  if (!plan?.reply || plan.reason !== "kept") return "";
  const text = String(plan.text || "").trim();
  if (!text || /https?:\/\//i.test(text) || /\bwww\./i.test(text)) return "";
  return text;
}

async function deliverFinal({ row, env, fetchImpl, token, base, captureImpl }) {
  const plan = await requestJson(
    fetchImpl,
    "GET",
    `${queueEndpoint(base, "/reply-plan")}?subject_status_id=${encodeURIComponent(row.subject_status_id)}`,
    token,
  );
  const text = plainFinalText(plan);
  if (!text) return { replied: false, reason: plan.reason || "no_reply" };
  const shot = await capturePublicKeepPage({
    origin: env.EXITTRACE_PUBLIC_ORIGIN,
    detailPath: plan.detail_path,
    fetchImpl,
    captureImpl,
    env,
  });
  const mediaId = await uploadTweetImage({ bytes: shot.bytes, fetchImpl, env });
  await postReply({
    inReplyTo: row.mention_status_id,
    text,
    mediaIds: [mediaId],
    fetchImpl,
    env,
  });
  await requestJson(fetchImpl, "POST", queueEndpoint(base, "/reply"), token, {
    subject_status_id: row.subject_status_id,
    kind: "final",
  });
  return { replied: true, reason: plan.reason || "" };
}

async function finishReply(row, ctx) {
  let reply_error = "";
  try {
    await deliverFinal({ row, ...ctx });
  } catch {
    reply_error = "reply_failed";
  }
  return reply_error;
}

export async function workerOnce({
  env = process.env,
  fetchImpl = globalThis.fetch,
  digImpl,
  captureImpl,
} = {}) {
  if (env.MENTION_WORKER_DATABASE !== "lab") {
    throw new Error("MENTION_WORKER_DATABASE=lab is required");
  }
  const base = env.MENTION_QUEUE_URL || "";
  const token = String(env.MENTION_QUEUE_WORKER_TOKEN || "").trim();
  const owner = String(env.MENTION_CLAIM_OWNER || "mention-worker").trim();
  if (!token) throw new Error("MENTION_QUEUE_WORKER_TOKEN is unset");
  const pollMs = pollIntervalMs(env.MENTION_WORKER_POLL_MS || env.MENTION_POLL_MS);
  const results = [];
  const work = await requestJson(fetchImpl, "GET", queueEndpoint(base, "/work"), token);
  const unrepliedRows = work.unreplied || [];
  const pendingRows = work.pending || [];
  if (!unrepliedRows.length && !pendingRows.length) {
    return { results, poll_ms: pollMs };
  }
  const ctx = { env, fetchImpl, token, base, captureImpl };
  if (unrepliedRows.length) {
    for (const row of unrepliedRows) {
      const reply_error = await finishReply(row, ctx);
      results.push({
        subject_status_id: row.subject_status_id,
        status: row.status,
        reply_error,
        swept: true,
      });
    }
  }
  if (!pendingRows.length) return { results, poll_ms: pollMs };
  if (!digImpl && !env.MENTION_DIG_COMMAND) {
    throw new Error("MENTION_DIG_COMMAND is unset");
  }
  for (let n = 0; n < CLAIMS_PER_TICK; n++) {
    let claim;
    try {
      claim = await requestJson(fetchImpl, "POST", queueEndpoint(base, "/claim"), token, {
        subject_status_id: "",
        claim_owner: owner,
      });
    } catch {
      break;
    }
    if (!claim.claimed || !claim.row) break;
    let envelope = null;
    try {
      envelope = digImpl
        ? await digImpl(claim.row)
        : await runDigCommand(claim.row, { command: env.MENTION_DIG_COMMAND, env });
    } catch (err) {
      const reason = err?.message === "dig_timeout" ? "dig_timeout" : "dig_failed";
      envelope = { outcome: "fail_closed", error_reason: reason };
    }
    // KEEP success copies this winning queue row into lab request_attributions.
    const dug = await digMention(claim.row, envelope);
    const body = completeBody(claim.row, dug, owner);
    const completed = await requestJson(
      fetchImpl,
      "POST",
      queueEndpoint(base, "/complete"),
      token,
      body,
    );
    const reply_error = await finishReply(completed.row, ctx);
    results.push({
      subject_status_id: claim.row.subject_status_id,
      status: completed.row?.status || dug.status,
      reply_error,
      swept: false,
    });
  }
  return { results, poll_ms: pollMs };
}
