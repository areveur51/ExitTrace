/**
 * X mention dig. The mention is a lead, never a cite.
 * KEEP still goes through queueAddRequest + processAddRequest.
 */

import { AddError, leadRecordFields, processAddRequest, queueAddRequest } from "./add-request.mjs";
import { recordXMentionKeepAttribution } from "./request-attributions.mjs";
import { CITE_FLOOR } from "./promote.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

export const LEAD_SOURCE_X_MENTION = "x_mention";
export const SOFT_ACK_TEXT = "Queued for ExitTrace review.";

export function normalizeErrorReason(raw, fallback) {
  const text = String(raw || "").trim();
  if (/^[a-z0-9_]{1,80}$/.test(text)) return text;
  return fallback;
}

/** Display name, or a slug turned into words. URLs are dropped. */
export function plainKeepLabel(displayName, slug) {
  const named = plainWords(displayName);
  if (named) return named;
  return plainWords(String(slug || "").replace(/-/g, " "));
}

export function keepReplyText(displayName, slug) {
  const label = plainKeepLabel(displayName, slug);
  if (!label) return "";
  const text = `ExitTrace kept ${label}.`;
  if (hasUrl(text)) return "";
  return text;
}

function plainWords(raw) {
  const text = String(raw || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!text || hasUrl(text)) return "";
  return text;
}

function hasUrl(text) {
  return /https?:\/\//i.test(text) || /\bwww\./i.test(text);
}

export function mentionCiteBanList(row = {}) {
  const urls = new Set();
  for (const raw of [row.subject_url, row.mention_url]) {
    const canonical = canonicalPublicUrl(raw);
    if (canonical) urls.add(canonical);
  }
  return urls;
}

/** Drop the mention and the subject status. Those URLs are leads, not cites. */
export function stripMentionCites(cites, row = {}) {
  const banned = mentionCiteBanList(row);
  const ids = [row.subject_status_id, row.mention_status_id].filter(Boolean);
  return (Array.isArray(cites) ? cites : []).filter((raw) => {
    const canonical = canonicalPublicUrl(raw);
    if (!canonical) return false;
    if (banned.has(canonical)) return false;
    for (const id of ids) {
      if (canonical.includes(`/status/${id}`)) return false;
    }
    return true;
  });
}

export async function leadIngest(input = {}) {
  if (Array.isArray(input.cite_urls) && input.cite_urls.length) {
    throw new AddError("x mention lead cannot carry cites", "mention_not_cite");
  }
  const fields = leadRecordFields({
    source: LEAD_SOURCE_X_MENTION,
    subject_status_id: input.subject_status_id,
    mention_status_id: input.mention_status_id,
  });
  if (fields.source !== LEAD_SOURCE_X_MENTION) {
    throw new AddError("x mention lead source is required", "invalid_lead_source");
  }
  return queueAddRequest({
    kind: "person",
    subject: input.subject,
    category: input.category || "",
    event_date: input.event_date || "",
    hint_url: input.hint_url || input.subject_url || "",
    birth_date: input.birth_date || "",
    country_of_origin: input.country_of_origin || "",
    position: input.position || "",
    organization: input.organization || "",
    comments: input.comments || input.reason || "",
    reason: input.reason || "",
    branch: input.branch || "",
    military: input.military,
    source: fields.source,
    subject_status_id: fields.subject_status_id,
    mention_status_id: fields.mention_status_id,
    cite_urls: [],
  });
}

/**
 * Park a name lead with source=x_mention, then promote only when the caller
 * already has two official cites that are not the mention. Does not invent cites.
 */
export async function digMention(row = {}, envelope) {
  const env = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : null;
  const subject = String(env?.subject || "").trim();
  let lead = null;
  if (subject) {
    const ingested = await leadIngest({
      subject,
      category: env.category || "",
      event_date: env.event_date || "",
      hint_url: row.subject_url || row.mention_url || "",
      subject_url: row.subject_url || "",
      birth_date: env.birth_date || "",
      country_of_origin: env.country_of_origin || "",
      position: env.position || "",
      organization: env.organization || "",
      comments: env.comments || env.reason || "",
      reason: env.reason || "",
      branch: env.branch || "",
      military: env.military,
      subject_status_id: row.subject_status_id,
      mention_status_id: row.mention_status_id,
      cite_urls: [],
    });
    lead = ingested.request;
  }
  const lead_id = lead?.id || null;
  if (!env || env.outcome === "fail_closed" || env.outcome === "rejected") {
    if (!env) {
      return { status: "fail_closed", error_reason: "cites_floor", kept_person_slug: null, lead_id };
    }
    const status = env.outcome === "rejected" ? "rejected" : "fail_closed";
    const fallback = subject ? "cites_floor" : "missing_subject";
    return {
      status,
      error_reason: normalizeErrorReason(env.error_reason, fallback),
      kept_person_slug: null,
      lead_id,
    };
  }
  const cites = stripMentionCites(env.cite_urls, row);
  if (!subject || cites.length < CITE_FLOOR) {
    return {
      status: "fail_closed",
      error_reason: subject ? "cites_floor" : "missing_subject",
      kept_person_slug: null,
      lead_id,
    };
  }
  try {
    const result = await processAddRequest({
      id: lead.id,
      overlay: {
        ...env,
        subject,
        cite_urls: cites,
      },
    });
    const slug = result.person?.id || result.request?.result?.person_id || result.person_id || "";
    if (!slug) {
      return { status: "fail_closed", error_reason: "missing_slug", kept_person_slug: null, lead_id };
    }
    await recordXMentionKeepAttribution(row, result);
    return {
      status: "kept",
      kept_person_slug: slug,
      error_reason: null,
      lead_id,
      person: result.person || null,
    };
  } catch (err) {
    const code = err instanceof AddError || err?.code ? err.code : "fail_closed";
    return {
      status: "fail_closed",
      error_reason: normalizeErrorReason(code, "fail_closed"),
      kept_person_slug: null,
      lead_id,
    };
  }
}

function quietPlan(reason) {
  return { reply: false, reason, text: "", media: [] };
}

/**
 * Final X reply only for KEEP. One plain-text confirmation. No URL and no media.
 * fail_closed, rejected, ambiguous_subject, and dig failures stay silent.
 * priorFinal is the earlier subject that already owns this KEEP slug.
 */
export function buildReplyPlan(row, { priorFinal = false, displayName = "" } = {}) {
  if (!row) return quietPlan("not_found");
  if (row.reply_final_at || priorFinal) return quietPlan("first_mentioner");
  if (row.status !== "kept") return quietPlan("no_reply");
  const text = keepReplyText(displayName, row.kept_person_slug);
  if (!text) return quietPlan("missing_label");
  return { reply: true, kind: "final", reason: "kept", text, media: [] };
}
