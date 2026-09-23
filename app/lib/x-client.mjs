/** User-context X API calls. Tokens stay in env and are not logged. */

import { oauth1Authorization, oauthPercentEncode } from "./x-oauth.mjs";

export const X_API_BASE_DEFAULT = "https://api.x.com/2";

/** In-process wait after one failed mentions GET. This does not change the host timer. */
export const X_BACKOFF_CAP_MS = 60 * 1000;

const CREDENTIAL_NAMES = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "X_USER_ID",
];

export { CREDENTIAL_NAMES };

export function xCredentials(env = process.env) {
  const consumerKey = String(env.X_API_KEY || "").trim();
  const consumerSecret = String(env.X_API_SECRET || "").trim();
  const token = String(env.X_ACCESS_TOKEN || "").trim();
  const tokenSecret = String(env.X_ACCESS_TOKEN_SECRET || "").trim();
  const userId = String(env.X_USER_ID || "").trim();
  if (!consumerKey || !consumerSecret || !token || !tokenSecret || !userId) {
    throw new Error("X credentials are unset");
  }
  return { consumerKey, consumerSecret, token, tokenSecret, userId };
}

export function xApiBase(env = process.env) {
  const base = String(env.X_API_BASE || X_API_BASE_DEFAULT).trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("X_API_BASE must be https");
  return base;
}

function signedHeaders(method, url, params, creds) {
  const { header } = oauth1Authorization({
    method,
    url,
    params,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
    token: creds.token,
    tokenSecret: creds.tokenSecret,
  });
  return {
    Authorization: header,
    "User-Agent": "ExitTraceMention/1.0 (+https://github.com/areveur51/ExitTrace)",
  };
}

function headerValue(res, name) {
  const headers = res?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  return String(headers[name] || headers[name.toLowerCase()] || "");
}

/**
 * Retry-After is delta-seconds. Missing or non-numeric values use a short
 * exponential wait. Both are capped so a oneshot does not outlive the timer band.
 */
export function xBackoffMs(status, retryAfter, attempt = 1) {
  const code = Number(status);
  if (code !== 402 && code !== 429) return 0;
  const raw = String(retryAfter ?? "").trim();
  const header = Number(raw);
  if (raw && Number.isFinite(header) && header >= 0) {
    return Math.min(X_BACKOFF_CAP_MS, Math.floor(header * 1000));
  }
  const exp = 1000 * 2 ** Math.max(0, Number(attempt) - 1);
  return Math.min(X_BACKOFF_CAP_MS, exp);
}

/**
 * One mentions GET. Author name and handle come from this payload's user expansion.
 * Do not call /users/:id once per mention. A 402 or 429 stops the pass; the poller backs off.
 */
export async function fetchMentions({
  sinceId = "",
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const creds = xCredentials(env);
  const url = `${xApiBase(env)}/users/${encodeURIComponent(creds.userId)}/mentions`;
  const params = {
    max_results: "10",
    "tweet.fields": "author_id,created_at,referenced_tweets,note_tweet,attachments",
    expansions: "author_id,referenced_tweets.id,attachments.media_keys",
    "user.fields": "username,name",
    "media.fields": "url,preview_image_url,type",
  };
  if (sinceId) params.since_id = String(sinceId);
  const query = Object.keys(params)
    .sort()
    .map((key) => `${oauthPercentEncode(key)}=${oauthPercentEncode(params[key])}`)
    .join("&");
  const headers = signedHeaders("GET", url, params, creds);
  const res = await fetchImpl(`${url}?${query}`, { method: "GET", headers });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!res.ok) {
    const error = new Error("X mentions fetch failed");
    error.status = Number(res.status) || 0;
    error.retryAfter = headerValue(res, "retry-after");
    throw error;
  }
  return payload;
}

/** Reply text plus optional media ids. The text itself stays free of URLs. */
export function replyBody({ inReplyTo, text, mediaIds } = {}) {
  const body = {
    text: String(text ?? ""),
    reply: { in_reply_to_tweet_id: String(inReplyTo ?? "") },
  };
  const ids = [];
  for (const raw of Array.isArray(mediaIds) ? mediaIds : []) {
    const id = String(raw || "").trim();
    if (/^[0-9]{1,19}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  if (ids.length) body.media = { media_ids: ids };
  return body;
}

async function readX(res, message) {
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!res.ok) {
    const error = new Error(message);
    error.status = Number(res.status) || 0;
    throw error;
  }
  return payload;
}

function mediaIdOf(payload) {
  return String(payload?.data?.id || payload?.id || "").trim();
}

/**
 * Upload one PNG for a reply. Chunked v2 media upload.
 * Images skip processing; a pending state is polled briefly.
 */
export async function uploadTweetImage({
  bytes,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const png = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (png.length < 8 || png[0] !== 0x89 || png.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("page_shot_invalid");
  }
  const creds = xCredentials(env);
  const base = xApiBase(env);
  const initUrl = `${base}/media/upload/initialize`;
  const init = await readX(
    await fetchImpl(initUrl, {
      method: "POST",
      headers: {
        ...signedHeaders("POST", initUrl, {}, creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media_type: "image/png",
        total_bytes: png.length,
        media_category: "tweet_image",
      }),
    }),
    "X media upload failed",
  );
  const id = mediaIdOf(init);
  if (!/^[0-9]{1,19}$/.test(id)) throw new Error("X media upload failed");
  const appendUrl = `${base}/media/upload/${id}/append`;
  const boundary = `ExitTraceShot${id}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="segment_index"\r\n\r\n0\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="keep.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  await readX(
    await fetchImpl(appendUrl, {
      method: "POST",
      headers: {
        ...signedHeaders("POST", appendUrl, {}, creds),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    }),
    "X media upload failed",
  );
  const finalUrl = `${base}/media/upload/${id}/finalize`;
  let done = await readX(
    await fetchImpl(finalUrl, {
      method: "POST",
      headers: {
        ...signedHeaders("POST", finalUrl, {}, creds),
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    "X media upload failed",
  );
  for (let n = 0; n < 4; n += 1) {
    const state = done?.data?.processing_info?.state;
    if (!state || state === "succeeded") return id;
    if (state === "failed") throw new Error("X media upload failed");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const params = { command: "STATUS", media_id: id };
    const statusUrl = `${base}/media/upload`;
    const query = Object.keys(params)
      .sort()
      .map((key) => `${oauthPercentEncode(key)}=${oauthPercentEncode(params[key])}`)
      .join("&");
    done = await readX(
      await fetchImpl(`${statusUrl}?${query}`, {
        method: "GET",
        headers: signedHeaders("GET", statusUrl, params, creds),
      }),
      "X media upload failed",
    );
  }
  throw new Error("X media upload failed");
}

export async function postReply({
  inReplyTo,
  text,
  mediaIds,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const creds = xCredentials(env);
  const url = `${xApiBase(env)}/tweets`;
  const headers = {
    ...signedHeaders("POST", url, {}, creds),
    "Content-Type": "application/json",
  };
  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(replyBody({ inReplyTo, text, mediaIds })),
  });
  if (!res.ok) {
    const error = new Error("X reply failed");
    error.status = res.status;
    throw error;
  }
  return true;
}
