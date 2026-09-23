/** Map X mention payloads to queue bodies. Mention text is a lead, never a cite. */

import { canonicalPublicUrl } from "./urls.mjs";

const SNOWFLAKE = /^[0-9]{5,20}$/;

export function isSnowflake(raw) {
  return SNOWFLAKE.test(String(raw || "").trim());
}

export function statusUrl(id, handle = "") {
  const snow = String(id || "").trim();
  const name = String(handle || "").replace(/^@/, "").trim();
  if (name && /^[A-Za-z0-9_]{1,15}$/.test(name)) {
    return `https://x.com/${name}/status/${snow}`;
  }
  return `https://x.com/i/web/status/${snow}`;
}

function refList(input = {}) {
  const raw = input.referenced_tweets || input.referenced_json || input.referenced || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      type: String(row?.type || "").trim(),
      id: String(row?.id || "").trim(),
    }))
    .filter((row) => isSnowflake(row.id));
}

/**
 * Prefer a referenced/quoted post snowflake when one is present.
 * Quoted wins, then replied_to, then any other reference, else the mention id.
 */
export function resolveSubjectStatusId(input = {}) {
  const mention_status_id = String(
    input.mention_status_id || input.mention_id || input.id || "",
  ).trim();
  if (!isSnowflake(mention_status_id)) {
    return { ok: false, error: "invalid_mention_id" };
  }
  const refs = refList(input);
  const quoted = refs.find((row) => row.type === "quoted");
  const replied = refs.find((row) => row.type === "replied_to");
  const other = refs.find((row) => row.type !== "quoted" && row.type !== "replied_to");
  const picked = quoted || replied || other || null;
  return {
    ok: true,
    mention_status_id,
    subject_status_id: picked ? picked.id : mention_status_id,
    subject_from: picked ? picked.type || "referenced" : "mention",
    referenced_json: refs.length ? refs : null,
  };
}

export function mentionsFromApiPayload(payload = {}) {
  const users = new Map();
  for (const user of payload?.includes?.users || []) {
    if (user?.id) {
      users.set(String(user.id), {
        username: String(user.username || ""),
        name: String(user.name || "").trim(),
      });
    }
  }
  const media = new Map();
  for (const item of payload?.includes?.media || []) {
    if (item?.media_key) media.set(String(item.media_key), item);
  }
  const rows = [];
  for (const tweet of payload?.data || []) {
    const resolved = resolveSubjectStatusId({
      mention_status_id: tweet?.id,
      referenced_tweets: tweet?.referenced_tweets,
    });
    if (!resolved.ok) continue;
    const author = users.get(String(tweet.author_id || "")) || { username: "", name: "" };
    const handle = author.username || "";
    const mediaItems = [];
    for (const key of tweet?.attachments?.media_keys || []) {
      const item = media.get(String(key));
      const url = canonicalPublicUrl(item?.url || item?.preview_image_url || "");
      if (!url) continue;
      mediaItems.push({ type: String(item?.type || ""), url });
    }
    rows.push({
      mention_status_id: resolved.mention_status_id,
      subject_status_id: resolved.subject_status_id,
      subject_from: resolved.subject_from,
      author_id: String(tweet?.author_id || ""),
      author_handle: handle.replace(/^@/, ""),
      author_display_name: author.name || "",
      text: String(tweet?.note_tweet?.text || tweet?.text || ""),
      mention_url: statusUrl(resolved.mention_status_id, handle),
      subject_url: statusUrl(
        resolved.subject_status_id,
        resolved.subject_from === "mention" ? handle : "",
      ),
      media_json: mediaItems.length ? mediaItems : null,
      referenced_json: resolved.referenced_json,
    });
  }
  return rows;
}

export function sortMentionsOldestFirst(rows) {
  return rows.slice().sort((a, b) => compareSnowflake(a.mention_status_id, b.mention_status_id));
}

export function compareSnowflake(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return left.length - right.length;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
