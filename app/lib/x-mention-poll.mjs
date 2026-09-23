/**
 * Poll X mentions and POST them to the Render queue.
 * Probe the queue before the X GET. since_id moves only after a real enqueue ack.
 * Soft-ack defaults off. A failed soft-ack does not stop the pass or roll back since_id.
 */

import fs from "fs";
import path from "path";
import { SOFT_ACK_TEXT } from "./mention-dig.mjs";
import { pollIntervalMs } from "./mention-queue.mjs";
import { fetchMentions, postReply, xBackoffMs, X_BACKOFF_CAP_MS } from "./x-client.mjs";
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

/** Empty success stays quiet. Non-empty work, errors, preflight skips, and backoffs are logged. */
export function pollJournal(result) {
  const since = result?.since_id || "";
  if (result?.backoff) return `mention_poll backoff=${result.backoff} since=${since}`;
  if (result?.fail_closed) return `mention_poll fail_closed=${result.fail_closed} since=${since}`;
  if (result?.preflight && result.preflight !== "ok") {
    return `mention_poll preflight=${result.preflight} since=${since}`;
  }
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (!rows.length) return "";
  const errors = rows.filter((row) => row.reply_error || row.error).length;
  if (errors) return `mention_poll since=${since} results=${rows.length} errors=${errors}`;
  return `mention_poll since=${since} results=${rows.length}`;
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

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return String(headers.get(name) || headers.get(String(name).toLowerCase()) || "");
  }
  const lower = String(name).toLowerCase();
  return String(headers[name] || headers[lower] || "");
}

function looksLikeHtml(res) {
  const text = String(res?.text || "");
  if (/just a moment/i.test(text)) return true;
  const type = headerValue(res?.headers, "content-type");
  return /text\/html/i.test(type) || /<!doctype html/i.test(text) || /<html[\s>]/i.test(text);
}

function isJsonApiError(res) {
  const body = res?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (!body.error && body.ok !== false) return false;
  if (looksLikeHtml(res)) return false;
  return true;
}

/** Cloudflare Bot Fight and other HTML 403s. A JSON API 403 (blocklist) is not one. */
export function isCfChallenge(res = {}) {
  if (Number(res.status) !== 403) return false;
  if (headerValue(res.headers, "cf-mitigated")) return true;
  if (looksLikeHtml(res)) return true;
  if (isJsonApiError(res)) return false;
  return true;
}

/** Real enqueue ack: ok JSON that created a row or reported the subject duplicate. */
export function isEnqueueAck(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (body.ok !== true) return false;
  return body.created === true || body.duplicate === true;
}

export function isPreflightAck(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return body.ok === true;
}

/**
 * ok — JSON ack for this role.
 * fail_closed — JSON 401 (token/config). Log it. Do not call X and do not advance since_id.
 * backoff — unreachable, HTML challenge (including an HTML 401), or 5xx.
 * stop — any other non-ack. Do not advance since_id.
 */
export function classifyQueueHttp(res, role = "enqueue") {
  const status = Number(res?.status) || 0;
  if (status === 401) {
    if (headerValue(res?.headers, "cf-mitigated") || looksLikeHtml(res)) return "backoff";
    return "fail_closed";
  }
  if (isCfChallenge(res) || (status >= 500 && status <= 599)) return "backoff";
  const ack = role === "preflight" ? isPreflightAck(res?.body) : isEnqueueAck(res?.body);
  if (res?.ok && ack) return "ok";
  return "stop";
}

/** In-process wait for an unreachable queue, an HTML challenge, or a 5xx. Same cap as the X 402/429 helper. */
export function queueBackoffMs(status, retryAfter, attempt = 1) {
  const code = Number(status);
  const down = code === 0;
  if (!down && code !== 403 && !(code >= 500 && code <= 599)) return 0;
  const raw = String(retryAfter ?? "").trim();
  const header = Number(raw);
  if (raw && Number.isFinite(header) && header >= 0) {
    return Math.min(X_BACKOFF_CAP_MS, Math.floor(header * 1000));
  }
  const exp = 1000 * 2 ** Math.max(0, Number(attempt) - 1);
  return Math.min(X_BACKOFF_CAP_MS, exp);
}

async function postJson(fetchImpl, url, token, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, ok: false, body: {}, text: "", headers: null, retryAfter: "", thrown: true };
  }
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  return {
    status: res.status,
    ok: res.ok,
    body: payload,
    text,
    headers: res.headers,
    retryAfter: headerValue(res.headers, "retry-after"),
    thrown: false,
  };
}

async function pause(sleepImpl, ms) {
  if (!(ms > 0)) return;
  const sleep = sleepImpl || ((wait) => new Promise((resolve) => setTimeout(resolve, wait)));
  await sleep(ms);
}

function passBackoffMs(res) {
  if (res?.thrown || Number(res?.status) === 0) return queueBackoffMs(0, "", 1);
  const code = Number(res?.status) || 0;
  if (code === 403 || (code >= 500 && code <= 599)) return queueBackoffMs(code, res.retryAfter, 1);
  if (headerValue(res?.headers, "cf-mitigated") || looksLikeHtml(res)) return queueBackoffMs(403, res.retryAfter, 1);
  return 0;
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

  const probed = await postJson(
    fetchImpl,
    queueEndpoint(env.MENTION_QUEUE_URL || "", "/preflight"),
    bot,
    { probe: true },
  );
  if (probed.thrown || probed.status === 0) {
    await pause(sleepImpl, passBackoffMs(probed));
    return { since_id: sinceId, results: [], backoff: "down", preflight: "down", poll_ms: pollMs };
  }
  const preKind = classifyQueueHttp(probed, "preflight");
  if (preKind !== "ok") {
    if (preKind === "backoff") {
      await pause(sleepImpl, passBackoffMs(probed));
      return {
        since_id: sinceId,
        results: [],
        backoff: probed.status,
        preflight: String(probed.status),
        poll_ms: pollMs,
      };
    }
    if (preKind === "fail_closed") {
      return {
        since_id: sinceId,
        results: [],
        fail_closed: probed.status || 401,
        preflight: "401",
        poll_ms: pollMs,
      };
    }
    return {
      since_id: sinceId,
      results: [],
      preflight: String(probed.status || "rejected"),
      poll_ms: pollMs,
    };
  }

  let payload;
  try {
    payload = await fetchMentions({ sinceId, fetchImpl, env });
  } catch (err) {
    if (err?.status === 402 || err?.status === 429) {
      await pause(sleepImpl, xBackoffMs(err.status, err.retryAfter, 1));
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
  const done = (extra = {}) => {
    if (advanced && advanced !== sinceId) writeSinceId(file, advanced);
    return { since_id: advanced, results, poll_ms: pollMs, ...extra };
  };
  for (const mention of mentions) {
    const queued = await postJson(fetchImpl, queueUrl, bot, mention);
    const kind = queued.thrown || queued.status === 0 ? "down" : classifyQueueHttp(queued, "enqueue");
    if (kind !== "ok") {
      results.push({
        mention_status_id: mention.mention_status_id,
        status: queued.status,
        error: kind === "fail_closed" ? "unauthorized" : queued.body?.error || "enqueue_failed",
      });
      if (kind === "backoff" || kind === "down") {
        await pause(sleepImpl, passBackoffMs(queued));
        return done({ backoff: kind === "down" ? "down" : queued.status });
      }
      if (kind === "fail_closed") return done({ fail_closed: queued.status || 401 });
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
  return done();
}
