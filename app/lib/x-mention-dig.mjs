/**
 * Host dig for one mention_queue row.
 * The mention and the subject status are leads. Official cites come from the
 * subject post and the quote/ref chain. Names, dates, and cites are not invented.
 * This module does not read queue tokens or X tokens and does not write KEEP.
 */

import { mapLeadReason } from "./event-attrs.mjs";
import { stripMentionCites } from "./mention-dig.mjs";
import {
  handleKey,
  hostOf,
  isGovHost,
  isOfficialGovHandle,
  isOfficialNewsHandle,
  isOfficialPublisherUrl,
  isQDropUrl,
  isSocialHost,
  isWikipediaUrl,
  parseHttpUrl,
  xStatusParts,
} from "./official.mjs";
import { OPERATION_TAG_IDS } from "./operation.mjs";
import { CITE_FLOOR, parseEventDate } from "./promote.mjs";
import { canonicalPublicUrl } from "./urls.mjs";
import { isSnowflake } from "./x-mentions.mjs";

const USER_AGENT = "ExitTraceMention/1.0 (+https://github.com/areveur51/ExitTrace)";
const MAX_POSTS = 8;
const MAX_DEPTH = 4;
const MAX_EXPANDS = 8;
const FETCH_MS = 8000;

const SKIP_HOSTS = new Set([
  "pic.twitter.com",
  "pbs.twimg.com",
  "video.twimg.com",
  "abs.twimg.com",
]);

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "in", "on", "at", "to", "from", "by",
  "with", "we", "our", "his", "her", "their", "its", "this", "that", "these", "those",
  "white", "house", "department", "justice", "attorney", "office", "court", "federal",
  "district", "new", "york", "post", "times", "reuters", "associated", "press",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "today", "yesterday", "united",
  "states", "america", "american", "national", "guard", "supreme", "congress",
  "senate", "police", "breaking", "exclusive", "update", "just", "via", "says",
  "said", "former", "first", "second", "usa", "u.s", "doj", "fbi", "cia", "was",
  "were", "been", "after", "before", "about", "into", "over", "under",
]);

const TITLES = new Set([
  "president", "senator", "governor", "secretary", "director", "general", "judge",
  "representative", "hon", "dr", "mr", "mrs", "ms", "sir", "former", "rep",
]);

const MONTHS = Object.freeze({
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
});

const VERB_RE =
  /\b(resign(?:ed|s|ation)?|stepp(?:ed|ing)\s+down|retir(?:ed|es|ement)|term ended|fir(?:ed|ing)|dismiss(?:ed|al)|terminat(?:ed|ion)|ousted)\b/i;

export function syndicationStatusUrl(id) {
  const url = new URL("https://cdn.syndication.twitter.com/tweet-result");
  url.searchParams.set("id", String(id || "").trim());
  url.searchParams.set("lang", "en");
  // Public cache key for the syndication embed. Not an X API credential.
  url.searchParams.set("token", "0");
  return url.toString();
}

function fail(error_reason, extra = {}) {
  const out = { outcome: "fail_closed", error_reason };
  const subject = String(extra.subject || "").trim();
  if (subject) out.subject = subject;
  return out;
}

export function subjectIdFromRow(row = {}) {
  const fromUrl = statusIdFromUrl(row.subject_url);
  if (fromUrl) return fromUrl;
  const id = String(row.subject_status_id || "").trim();
  return isSnowflake(id) ? id : "";
}

function statusIdFromUrl(raw) {
  const parts = xStatusParts(raw);
  if (parts?.statusId && isSnowflake(parts.statusId)) return parts.statusId;
  const parsed = parseHttpUrl(raw);
  if (!parsed || hostOf(parsed) !== "x.com") return "";
  const match = parsed.pathname.match(/\/status\/(\d{5,20})/);
  return match && isSnowflake(match[1]) ? match[1] : "";
}

function urlsInText(text) {
  const found = [];
  const re = /https?:\/\/[^\s<>"'`]+/gi;
  for (const match of String(text || "").matchAll(re)) {
    const cleaned = match[0].replace(/[),.;!?]+$/g, "");
    if (cleaned) found.push(cleaned);
  }
  return found;
}

export function normalizeSyndicationTweet(json, fallbackId = "") {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const type = String(json.__typename || "");
  if (type && type !== "Tweet") return null;
  const id = String(json.id_str || json.id || fallbackId || "").trim();
  if (!isSnowflake(id)) return null;
  const user = json.user && typeof json.user === "object" ? json.user : {};
  const note =
    json.note_tweet && typeof json.note_tweet === "object"
      ? String(json.note_tweet.text || "")
      : "";
  const shortText = String(json.text || "");
  const text = note.length > shortText.length ? note : shortText;
  const urls = [];
  const shorts = new Set();
  const list = json.entities && Array.isArray(json.entities.urls) ? json.entities.urls : [];
  for (const item of list) {
    const expanded = String(item?.expanded_url || "").trim();
    const short = String(item?.url || "").trim();
    if (short) shorts.add(canonicalPublicUrl(short) || short);
    if (expanded) urls.push(expanded);
  }
  for (const found of urlsInText(text)) {
    const key = canonicalPublicUrl(found) || found;
    if (shorts.has(key)) continue;
    urls.push(found);
  }
  const quotedRaw = json.quoted_tweet || json.quoted_status || null;
  const quoted = quotedRaw ? normalizeSyndicationTweet(quotedRaw) : null;
  const replyToId = String(json.in_reply_to_status_id_str || "").trim();
  return {
    id,
    handle: handleKey(user.screen_name || ""),
    name: String(user.name || "").trim(),
    text,
    created_at: String(json.created_at || ""),
    urls,
    quoted,
    replyToId: isSnowflake(replyToId) ? replyToId : "",
  };
}

function references(row = {}) {
  const raw = row.referenced_json || row.referenced_tweets || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      type: String(item?.type || "").trim(),
      id: String(item?.id || "").trim(),
    }))
    .filter((item) => isSnowflake(item.id));
}

function locationOf(res) {
  const headers = res?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get("location") || "");
  return String(headers.location || headers.Location || "");
}

function skipHost(raw) {
  const host = hostOf(raw);
  if (!host) return true;
  if (SKIP_HOSTS.has(host)) return true;
  if (isWikipediaUrl(raw) || isQDropUrl(raw)) return true;
  return false;
}

/** Untrusted tweet links are not followed into loopback or private ranges. */
function isBlockedHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return true;
  const a = parts[0];
  const b = parts[1];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isDigCite(raw) {
  if (!isOfficialPublisherUrl(raw)) return false;
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;
  const host = hostOf(parsed);
  if (isSocialHost(host)) return Boolean(xStatusParts(raw));
  if (isGovHost(host)) return true;
  return isOfficialPublisherUrl(raw);
}

function statusCiteUrl(handle, id) {
  const key = handleKey(handle);
  if (!key || !isSnowflake(id)) return "";
  if (!isOfficialGovHandle(key) && !isOfficialNewsHandle(key)) return "";
  return `https://x.com/${key}/status/${id}`;
}

function normalizeCite(raw) {
  const parts = xStatusParts(raw);
  if (parts) {
    const official = statusCiteUrl(parts.handle, parts.statusId);
    if (official) return official;
    return "";
  }
  const canonical = canonicalPublicUrl(raw);
  return canonical && isDigCite(canonical) ? canonical : "";
}

async function defaultExpand(raw, fetchImpl, budget) {
  let current = String(raw || "").trim();
  const seen = new Set();
  for (let hop = 0; hop < 5; hop += 1) {
    const canonical = canonicalPublicUrl(current);
    if (!canonical || seen.has(canonical) || isBlockedHost(hostOf(canonical))) return "";
    seen.add(canonical);
    if (isDigCite(canonical) || xStatusParts(canonical)) return canonical;
    if (skipHost(canonical)) return "";
    if (budget.left <= 0) return "";
    budget.left -= 1;
    let res;
    try {
      res = await fetchImpl(canonical, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_MS),
      });
    } catch {
      return "";
    }
    const status = Number(res?.status || 0);
    if (status >= 300 && status < 400) {
      const loc = locationOf(res);
      if (!loc) return "";
      try {
        current = new URL(loc, canonical).toString();
      } catch {
        return "";
      }
      continue;
    }
    return "";
  }
  return "";
}

async function resolveUrl(raw, { fetchImpl, expandImpl, budget }) {
  const canonical = canonicalPublicUrl(raw);
  if (!canonical || isBlockedHost(hostOf(canonical))) return "";
  if (xStatusParts(canonical) || isDigCite(canonical)) return canonical;
  if (skipHost(canonical)) return "";
  const expanded = expandImpl
    ? await expandImpl(canonical)
    : await defaultExpand(canonical, fetchImpl, budget);
  const next = canonicalPublicUrl(expanded);
  if (!next) return "";
  if (xStatusParts(next) || isDigCite(next)) return next;
  return "";
}

async function fetchStatus(id, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(syndicationStatusUrl(id), {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_MS),
    });
  } catch {
    return null;
  }
  if (!res || !res.ok) return null;
  let json;
  try {
    json = JSON.parse(await res.text());
  } catch {
    return null;
  }
  return normalizeSyndicationTweet(json, id);
}

async function loadChain(subjectPost, row, fetchImpl, expandImpl) {
  const posts = [];
  const seen = new Set();
  const pending = [];
  const budget = { left: MAX_EXPANDS };
  const mentionId = String(row.mention_status_id || "").trim();
  const subjectId = subjectPost.id;
  const resolver = { fetchImpl, expandImpl, budget };

  function considerId(id, depth) {
    const snow = String(id || "").trim();
    if (!isSnowflake(snow)) return;
    if (snow === mentionId || snow === subjectId) return;
    if (seen.has(snow) || depth > MAX_DEPTH) return;
    pending.push({ id: snow, depth });
  }

  async function absorb(post, depth) {
    if (!post || seen.has(post.id) || posts.length >= MAX_POSTS || depth > MAX_DEPTH) return;
    seen.add(post.id);
    const resolved = [];
    for (const url of post.urls || []) {
      const next = await resolveUrl(url, resolver);
      if (!next) continue;
      resolved.push(next);
      const parts = xStatusParts(next);
      if (parts) considerId(parts.statusId, depth + 1);
    }
    post.resolved = resolved;
    posts.push(post);
    if (post.quoted) await absorb(post.quoted, depth + 1);
    considerId(post.replyToId, depth + 1);
  }

  await absorb(subjectPost, 0);
  for (const ref of references(row)) considerId(ref.id, 1);
  while (pending.length && posts.length < MAX_POSTS) {
    const next = pending.shift();
    if (!next || seen.has(next.id) || next.depth > MAX_DEPTH) continue;
    const child = await fetchStatus(next.id, fetchImpl);
    await absorb(child, next.depth);
  }
  return posts;
}

function citeUrlsFromPosts(posts, row, subjectId) {
  const mentionId = String(row.mention_status_id || "").trim();
  const raw = [];
  for (const post of posts) {
    for (const url of post.resolved || []) {
      const cite = normalizeCite(url);
      if (cite) raw.push(cite);
    }
    if (post.id === subjectId || post.id === mentionId) continue;
    const self = statusCiteUrl(post.handle, post.id);
    if (self) raw.push(self);
  }
  const stripped = stripMentionCites(raw, row);
  const out = [];
  const seen = new Set();
  for (const url of stripped) {
    const cite = normalizeCite(url);
    if (!cite || seen.has(cite)) continue;
    seen.add(cite);
    out.push(cite);
  }
  return out;
}

function plainText(text) {
  return String(text || "").replace(/https?:\/\/\S+/gi, " ");
}

function namesIn(text) {
  const word = "\\p{Lu}[\\p{L}'’.-]*";
  const initial = "\\p{Lu}\\.";
  const re = new RegExp(`\\b(${word}(?:\\s+(?:${initial}|${word})){1,3})\\b`, "gu");
  const out = [];
  for (const match of plainText(text).matchAll(re)) {
    const name = acceptName(match[1]);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function acceptName(raw) {
  let tokens = String(raw || "")
    .split(/\s+/)
    .map((token) => token.replace(/(?:'s|’s)$/i, "").replace(/\.$/, ""))
    .filter(Boolean);
  while (tokens.length && TITLES.has(tokens[0].toLowerCase())) tokens.shift();
  if (tokens.length < 2) return "";
  if (tokens.some((token) => STOP.has(token.toLowerCase()))) return "";
  return tokens.join(" ");
}

function namesAroundVerb(text) {
  const source = plainText(text);
  const match = source.match(VERB_RE);
  if (!match || match.index == null) return namesIn(source);
  const before = namesIn(source.slice(0, match.index));
  if (before.length) return before;
  return namesIn(source.slice(match.index + match[0].length));
}

const OP_TAG_PHRASES = Object.freeze([
  ["missing_kids", /\bmissing\s+(?:kids|children)\b/i],
  ["human_smuggling", /\bhuman\s+smuggling\b/i],
  ["fugitives", /\bfugitives?\b/i],
  ["cybercrime", /\bcyber\s*crime\b/i],
  ["drug_trafficking", /\bdrug\s+trafficking\b/i],
  ["violent_crime", /\bviolent\s+crime\b/i],
  ["fraud", /\bfraud\b/i],
]);

const DOG_RE = /\b(?:dogs?|k-?9s?|canines?|working dogs?)\b/i;

function isObservanceName(name, text = "") {
  const label = String(name || "").trim();
  if (!label) return true;
  if (/^central casting$/i.test(label)) return true;
  const last = label.split(/\s+/).at(-1) || "";
  if (/^days?$/i.test(last) || /^weeks?$/i.test(last)) return true;
  if (!text) return false;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\s+(?:days?|weeks?)\\b`, "i").test(text);
}

function operationNames(text) {
  const source = plainText(text);
  const out = [];
  const prefixed = /\bOperation\s+(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,4})\b/gu;
  for (const match of source.matchAll(prefixed)) {
    const name = `Operation ${String(match[1] || "").replace(/\s+/g, " ").trim()}`;
    if (name !== "Operation" && !out.includes(name)) out.push(name);
  }
  const trailing = /\b(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,4}\s+Operation)\b/gu;
  for (const match of source.matchAll(trailing)) {
    const name = String(match[1] || "").replace(/\s+/g, " ").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function operationTags(text) {
  const hits = [];
  for (const [id, re] of OP_TAG_PHRASES) {
    if (!OPERATION_TAG_IDS.includes(id)) continue;
    if (re.test(text)) hits.push(id);
  }
  return hits;
}

function personNames(text, operations) {
  const blocked = (operations || []).map((name) => name.toLowerCase());
  return namesAroundVerb(text).filter((name) => {
    if (isObservanceName(name, text) || /^operation\b/i.test(name)) return false;
    const lower = name.toLowerCase();
    return !blocked.some((op) => op === lower || op.includes(lower));
  });
}

function isDogPost(post) {
  if (!post || !DOG_RE.test(String(post.text || ""))) return false;
  return isOfficialGovHandle(post.handle);
}

function agenciesIn(text) {
  const source = plainText(text);
  const out = [];
  const re =
    /\b(?:(?:U\.S\.|United States)\s+)?Department of (?:Justice|Defense|Homeland Security|State|the Treasury)\b/gi;
  for (const match of source.matchAll(re)) {
    const agency = match[0].replace(/\s+/g, " ").trim();
    if (!out.some((item) => item.toLowerCase() === agency.toLowerCase())) out.push(agency);
  }
  if (/\bFederal Bureau of Investigation\b/i.test(source)) out.push("Federal Bureau of Investigation");
  else if (/\bFBI\b/.test(source)) out.push("FBI");
  return out;
}

function calendarDay(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso && parseEventDate(iso[1])) return iso[1];
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function dogSubject(post) {
  return String(post?.name || post?.handle || "").trim();
}

function signalsOf(post, { allowDog = true } = {}) {
  const text = String(post?.text || "");
  const operations = operationNames(text);
  return {
    post,
    text,
    operations,
    people: personNames(text, operations),
    tags: operationTags(text),
    dog: allowDog && isDogPost(post),
  };
}

function decideSignals(sig) {
  const kinds = [];
  if (sig.dog) kinds.push("dog_comm");
  if (sig.operations.length) kinds.push("operation");
  if (sig.people.length) kinds.push("person");
  if (kinds.length > 1 || sig.operations.length > 1 || sig.people.length > 1) {
    return { ambiguous: true };
  }
  if (kinds.length === 0) return {};
  if (kinds[0] === "dog_comm") {
    const subject = dogSubject(sig.post);
    if (!subject) return {};
    return { hit: { subject_kind: "dog_comm", subject, post: sig.post } };
  }
  if (kinds[0] === "operation") {
    if (sig.tags.length !== 1) return { ambiguous: true };
    return {
      hit: {
        subject_kind: "operation",
        subject: sig.operations[0],
        post: sig.post,
        category: sig.tags[0],
      },
    };
  }
  return { hit: { subject_kind: "person", subject: sig.people[0], post: sig.post } };
}

function sameHit(a, b) {
  return a.subject_kind === b.subject_kind && a.subject === b.subject;
}

/** One subject kind, or ambiguous, or nothing. Holidays are not people. */
export function classifySubject(posts) {
  const list = Array.isArray(posts) ? posts : [];
  const primary = decideSignals(signalsOf(list[0], { allowDog: true }));
  if (primary.ambiguous) return { ambiguous: true };
  if (primary.hit) return primary.hit;
  const later = [];
  for (const post of list.slice(1)) {
    const decided = decideSignals(signalsOf(post, { allowDog: false }));
    if (decided.ambiguous) return { ambiguous: true };
    if (decided.hit && !later.some((hit) => sameHit(hit, decided.hit))) later.push(decided.hit);
  }
  if (later.length > 1) return { ambiguous: true };
  if (later.length === 1) return later[0];
  return {};
}

function verbKey(text) {
  const source = plainText(text).toLowerCase();
  const keys = [];
  if (/\b(resign(?:ed|s|ation)?|stepp(?:ed|ing)\s+down|retir(?:ed|es|ement)|term ended)\b/.test(source)) {
    keys.push("resigned");
  }
  if (/\b(fir(?:ed|ing)|dismiss(?:ed|al)|terminat(?:ed|ion)|ousted)\b/.test(source)) {
    keys.push("fired");
  }
  return keys.length === 1 ? keys[0] : "";
}

function datesInText(text) {
  const found = new Set();
  const source = plainText(text);
  for (const match of source.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) {
    const parsed = parseEventDate(match[1]);
    if (parsed) found.add(parsed);
  }
  const months = Object.keys(MONTHS).join("|");
  const re = new RegExp(`\\b(${months})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, "ig");
  for (const match of source.matchAll(re)) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = String(match[2]).padStart(2, "0");
    const parsed = parseEventDate(`${match[3]}-${month}-${day}`);
    if (parsed) found.add(parsed);
  }
  return [...found];
}

function roleFromText(text) {
  const re =
    /\bas\s+([A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3})\s+(?:of|at)\s+(?:the\s+)?([A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,5})/gu;
  const matches = [...plainText(text).matchAll(re)];
  if (matches.length !== 1) return {};
  const position = String(matches[0][1] || "").trim();
  const organization = String(matches[0][2] || "").trim();
  if (!position || !organization) return {};
  return { position, organization };
}

function sentenceFor(text, subject) {
  const parts = plainText(text)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const hit = parts.find((part) => part.includes(subject));
  const sentence = hit || "";
  if (!sentence || sentence.length > 400) return "";
  return sentence;
}

function metaFromSubjectPost(post, subject) {
  if (!post) return {};
  const out = {};
  const reason = verbKey(post.text);
  const category = reason ? mapLeadReason(reason) : "";
  if (category) out.category = category;
  else if (/\bcorona\s+comms?\b/i.test(plainText(post.text))) out.category = "corona_comms";
  if (reason) out.reason = reason;
  const dates = datesInText(post.text);
  if (dates.length === 1) out.event_date = dates[0];
  const role = roleFromText(post.text);
  if (role.position) out.position = role.position;
  if (role.organization) out.organization = role.organization;
  const comments = sentenceFor(post.text, subject);
  if (comments) out.comments = comments;
  return out;
}

function metaForOperation(post, subject, category) {
  const out = { category };
  const dates = datesInText(post?.text);
  if (dates.length === 1) out.event_date = dates[0];
  const agencies = agenciesIn(post?.text);
  if (agencies.length) out.agencies = agencies;
  const comments = sentenceFor(post?.text, subject);
  if (comments) {
    out.comments = comments;
    out.summary = comments;
  }
  return out;
}

function metaForDog(post) {
  const stated = datesInText(post?.text);
  const posted_at = stated.length === 1 ? stated[0] : calendarDay(post?.created_at);
  // Catalog identity of the official post. Not placed in cite_urls.
  const source_url = statusCiteUrl(post?.handle, post?.id);
  const out = {
    handle: post?.handle || "",
    account_name: post?.name || "",
    text: String(post?.text || "").trim(),
  };
  if (source_url) out.source_url = source_url;
  if (posted_at) out.posted_at = posted_at;
  return out;
}

export async function digMentionEnvelope(row, { fetchImpl = globalThis.fetch, expandImpl } = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return fail("invalid_row");
  const subjectId = subjectIdFromRow(row);
  if (!subjectId) return fail("invalid_row");
  const subjectPost = await fetchStatus(subjectId, fetchImpl);
  if (!subjectPost) return fail("subject_unresolved");
  const posts = await loadChain(subjectPost, row, fetchImpl, expandImpl);
  const picked = classifySubject(posts);
  if (picked.ambiguous) return fail("ambiguous_subject");
  const subject = picked.subject || "";
  if (!subject || !picked.subject_kind) return fail("missing_subject");
  if (picked.subject_kind === "dog_comm") {
    return {
      subject,
      subject_kind: "dog_comm",
      ...metaForDog(picked.post),
    };
  }
  const cite_urls = citeUrlsFromPosts(posts, row, subjectId);
  if (cite_urls.length < CITE_FLOOR) return fail("cites_floor", { subject });
  const meta =
    picked.subject_kind === "operation"
      ? metaForOperation(picked.post, subject, picked.category)
      : metaFromSubjectPost(picked.post, subject);
  return {
    subject,
    subject_kind: picked.subject_kind,
    cite_urls,
    ...meta,
  };
}
