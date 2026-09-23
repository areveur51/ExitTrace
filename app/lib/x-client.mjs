/** User-context X API calls. Tokens stay in env and are not logged. */

import { oauth1Authorization, oauthPercentEncode } from "./x-oauth.mjs";

export const X_API_BASE_DEFAULT = "https://api.x.com/2";

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

export async function fetchMentions({ sinceId = "", fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const creds = xCredentials(env);
  const url = `${xApiBase(env)}/users/${encodeURIComponent(creds.userId)}/mentions`;
  const params = {
    max_results: "10",
    "tweet.fields": "author_id,created_at,referenced_tweets,note_tweet,attachments",
    expansions: "author_id,referenced_tweets.id,attachments.media_keys",
    "user.fields": "username",
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
    error.status = res.status;
    throw error;
  }
  return payload;
}

export async function postReply({
  inReplyTo,
  text,
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
    body: JSON.stringify({
      text,
      reply: { in_reply_to_tweet_id: String(inReplyTo) },
    }),
  });
  if (!res.ok) {
    const error = new Error("X reply failed");
    error.status = res.status;
    throw error;
  }
  return true;
}
