/** OAuth 1.0a HMAC-SHA1 for user-context X calls. No secrets are logged. */

import { createHmac, randomBytes } from "node:crypto";

export function oauthPercentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauth1Authorization({
  method,
  url,
  params = {},
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000),
} = {}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: token,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const encoded = Object.keys(all)
    .sort()
    .map((key) => `${oauthPercentEncode(key)}=${oauthPercentEncode(all[key])}`)
    .join("&");
  const base = [
    String(method || "GET").toUpperCase(),
    oauthPercentEncode(url),
    oauthPercentEncode(encoded),
  ].join("&");
  const signingKey = `${oauthPercentEncode(consumerSecret)}&${oauthPercentEncode(tokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(base).digest("base64");
  const headerPairs = { ...oauth, oauth_signature: signature };
  const header =
    "OAuth " +
    Object.keys(headerPairs)
      .sort()
      .map((key) => `${oauthPercentEncode(key)}="${oauthPercentEncode(headerPairs[key])}"`)
      .join(", ");
  return { header, signature, base };
}
