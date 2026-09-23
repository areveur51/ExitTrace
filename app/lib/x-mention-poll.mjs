/**
 * Poll X mentions and POST them to the Render queue.
 * Soft-ack defaults off. A failed soft-ack does not stop the pass or the since_id cursor.
 */

import fs from "fs";
import path from "path";
import { SOFT_ACK_TEXT } from "./mention-dig.mjs";
import { pollIntervalMs } from "./mention-queue.mjs";
import { fetchMentions, postReply } from "./x-client.mjs";
import { compareSnowflake, mentionsFromApiPayload, sortMentionsOldestFirst } from "./x-mentions.mjs";

export { SOFT_ACK_TEXT };

export function softAckEnabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.MENTION_SOFT_ACK || ""));
}

/** Soft-ack only a newly created queue row. Duplicates and an unset flag skip it. */
export function shouldSoftAck(env, body) {
  if (!softAckEnabled(env)) return false;
  if (!body || body.duplicate || body.created !== true) return false;
  if (body.row?.reply_soft_at) return false;
  return true;
}

/** Empty passes stay out of the journal. A 402/429 backoff is one line, not a success line. */
export function pollJournal(result) {
  const since = result?.since_id || "";
  if (result?.backoff) return `mention_poll backoff=${result.backoff} since=${since}`;
  const count = Array.isArray(result?.results) ? result.results.length : 0;
  if (!count) return "";
  return `mention_poll since=${since} results=${count}`;
}

export function queueEndpoint(base, suffix = "") {
  const trimmed = String(base || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error("MENTION_QUEUE_URL must be https");
  }
  const marker = "/api/mention-queue";
  const root = trimmed.endsWith(marker) ? trimmed.slice(0, -marker.length) : trimmed;
  return `${root}/api/mention-queue${suffix}`;
}

export function readSinceId(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const id = String(raw.since_id || "");
    return /^[0-9]{5,20}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

export function writeSinceId(file, sinceId) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ since_id: sinceId || "" })}\n`);
  fs.renameSync(tmp, file);
}

async function postJson(fetchImpl, url, token, body) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  return { status: res.status, ok: res.ok, body: payload };
}

export async function pollOnce({
  env = process.env,
  fetchImpl = globalThis.fetch,
  statePath,
  sleepImpl,
} = {}) {
  const queueUrl = queueEndpoint(env.MENTION_QUEUE_URL || "");
  const bot = String(env.MENTION_QUEUE_BOT_TOKEN || "").trim();
  if (!bot) throw new Error("MENTION_QUEUE_BOT_TOKEN is unset");
  const file = statePath || env.MENTION_STATE_PATH || path.join("var", "x-mention-since.json");
  const sinceId = readSinceId(file);
  const pollMs = pollIntervalMs(env.MENTION_POLL_MS);
  let payload;
  try {
    payload = await fetchMentions({ sinceId, fetchImpl, env, sleepImpl });
  } catch (err) {
    if (err?.status === 402 || err?.status === 429) {
      return { since_id: sinceId, results: [], backoff: err.status, poll_ms: pollMs };
    }
    throw err;
  }
  const ownId = String(env.X_USER_ID || "");
  const mentions = sortMentionsOldestFirst(mentionsFromApiPayload(payload)).filter(
    (row) => row.author_id && row.author_id !== ownId,
  );
  let advanced = sinceId;
  const results = [];
  for (const mention of mentions) {
    let queued;
    try {
      queued = await postJson(fetchImpl, queueUrl, bot, mention);
    } catch {
      results.push({
        mention_status_id: mention.mention_status_id,
        status: 0,
        error: "enqueue_failed",
      });
      break;
    }
    if (!queued.ok) {
      results.push({
        mention_status_id: mention.mention_status_id,
        status: queued.status,
        error: queued.body?.error || "enqueue_failed",
      });
      break;
    }
    if (!advanced || compareSnowflake(mention.mention_status_id, advanced) > 0) {
      advanced = mention.mention_status_id;
    }
    let reply_error = "";
    if (shouldSoftAck(env, queued.body)) {
      try {
        await postReply({
          inReplyTo: mention.mention_status_id,
          text: SOFT_ACK_TEXT,
          fetchImpl,
          env,
        });
        const stamped = await postJson(
          fetchImpl,
          queueEndpoint(env.MENTION_QUEUE_URL, "/reply"),
          bot,
          {
            subject_status_id: queued.body.row.subject_status_id,
            kind: "soft",
          },
        );
        if (!stamped.ok) reply_error = "reply_failed";
      } catch {
        reply_error = "reply_failed";
      }
    }
    results.push({
      mention_status_id: mention.mention_status_id,
      subject_status_id: queued.body?.row?.subject_status_id || mention.subject_status_id,
      duplicate: Boolean(queued.body?.duplicate),
      reply_error,
    });
  }
  if (advanced && advanced !== sinceId) writeSinceId(file, advanced);
  return { since_id: advanced, results, poll_ms: pollMs };
}
