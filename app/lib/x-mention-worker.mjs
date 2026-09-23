/**
 * Claim the Render queue, dig fail-closed, write the lab lead, then reply.
 * A reply failure does not change queue status.
 * GitHub Actions is not this worker.
 */

import { spawn } from "node:child_process";
import { digMention } from "./mention-dig.mjs";
import { pollIntervalMs } from "./mention-queue.mjs";
import { postReply } from "./x-client.mjs";
import { queueEndpoint } from "./x-mention-poll.mjs";

export const COMPLETE_BODY_KEYS = Object.freeze([
  "subject_status_id",
  "claim_owner",
  "status",
  "kept_person_slug",
  "error_reason",
]);

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

export function runDigCommand(row, { command, timeoutMs = 9 * 60 * 1000, env = process.env } = {}) {
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

async function deliverFinal({ row, env, fetchImpl, token, base }) {
  const plan = await requestJson(
    fetchImpl,
    "GET",
    `${queueEndpoint(base, "/reply-plan")}?subject_status_id=${encodeURIComponent(row.subject_status_id)}`,
    token,
  );
  if (!plan.reply || !plan.text) return { replied: false, reason: plan.reason || "" };
  await postReply({
    inReplyTo: row.mention_status_id,
    text: plan.text,
    fetchImpl,
    env,
  });
  await requestJson(fetchImpl, "POST", queueEndpoint(base, "/reply"), token, {
    subject_status_id: row.subject_status_id,
    kind: "final",
  });
  return { replied: true, reason: plan.reason || "" };
}

export async function workerOnce({
  env = process.env,
  fetchImpl = globalThis.fetch,
  digImpl,
} = {}) {
  if (env.MENTION_WORKER_DATABASE !== "lab") {
    throw new Error("MENTION_WORKER_DATABASE=lab is required");
  }
  const base = env.MENTION_QUEUE_URL || "";
  const token = String(env.MENTION_QUEUE_WORKER_TOKEN || "").trim();
  const owner = String(env.MENTION_CLAIM_OWNER || "mention-worker").trim();
  if (!token) throw new Error("MENTION_QUEUE_WORKER_TOKEN is unset");
  if (!digImpl && !env.MENTION_DIG_COMMAND) {
    throw new Error("MENTION_DIG_COMMAND is unset");
  }
  const results = [];
  const unreplied = await requestJson(
    fetchImpl,
    "GET",
    queueEndpoint(base, "/unreplied"),
    token,
  );
  for (const row of unreplied.rows || []) {
    let reply_error = "";
    try {
      await deliverFinal({ row, env, fetchImpl, token, base });
    } catch {
      reply_error = "reply_failed";
    }
    results.push({
      subject_status_id: row.subject_status_id,
      status: row.status,
      reply_error,
      swept: true,
    });
  }
  const pending = await requestJson(fetchImpl, "GET", queueEndpoint(base, "/pending"), token);
  for (const item of pending.rows || []) {
    const claim = await requestJson(fetchImpl, "POST", queueEndpoint(base, "/claim"), token, {
      subject_status_id: item.subject_status_id,
      claim_owner: owner,
    });
    if (!claim.claimed || !claim.row) continue;
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
    let reply_error = "";
    try {
      await deliverFinal({ row: completed.row, env, fetchImpl, token, base });
    } catch {
      reply_error = "reply_failed";
    }
    results.push({
      subject_status_id: claim.row.subject_status_id,
      status: completed.row?.status || dug.status,
      reply_error,
      swept: false,
    });
  }
  return { results, poll_ms: pollIntervalMs(env.MENTION_WORKER_POLL_MS || env.MENTION_POLL_MS) };
}
