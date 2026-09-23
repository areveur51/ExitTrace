/**
 * X mention dig. The mention is a lead, never a cite.
 * KEEP still goes through queueAddRequest + processAddRequest.
 */

import { AddError, leadRecordFields, processAddRequest, queueAddRequest } from "./add-request.mjs";
import { keepDetailPath } from "./keep-page-shot.mjs";
import { normalizeOperationTag } from "./operation.mjs";
import { CITE_FLOOR } from "./promote.mjs";
import { recordXMentionKeepAttribution } from "./request-attributions.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

export const LEAD_SOURCE_X_MENTION = "x_mention";
export const SOFT_ACK_TEXT = "Queued for ExitTrace review.";

/** Dig subjects. dog_comm is the add-request kind `dog`. No parallel kind ids. */
export function canonicalSubjectKind(raw) {
  const key = String(raw || "").trim();
  if (key === "person" || key === "operation" || key === "dog_comm") return key;
  if (key === "dog" || key === "dog_comms") return "dog_comm";
  return "";
}

/** add-request kind id the promote stack already queues. */
export function addKindForSubject(subjectKind) {
  const key = canonicalSubjectKind(subjectKind);
  if (key === "person") return "person";
  if (key === "operation") return "operation";
  if (key === "dog_comm") return "dog";
  return "";
}

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

function explicitKind(input = {}) {
  if (input.subject_kind != null && String(input.subject_kind).trim() !== "") {
    return input.subject_kind;
  }
  if (input.kind != null && String(input.kind).trim() !== "") return input.kind;
  return "";
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
  const named = explicitKind(input);
  const kind = named ? addKindForSubject(named) : "person";
  if (!kind) {
    throw new AddError("kind must be person, operation, or dog", "invalid_kind");
  }
  return queueAddRequest({
    kind,
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
    agencies: input.agencies || "",
    summary: input.summary || input.comments || input.reason || "",
    handle: input.handle || "",
    source_url: input.source_url || "",
    posted_at: input.posted_at || "",
    account_name: input.account_name || "",
    text: input.text || "",
    source: fields.source,
    subject_status_id: fields.subject_status_id,
    mention_status_id: fields.mention_status_id,
    cite_urls: [],
  });
}

function keptFromResult(result) {
  const dog = result?.dog?.id || result?.dog_id || result?.request?.result?.dog_id || "";
  const operation =
    result?.operation?.id || result?.operation_id || result?.request?.result?.operation_id || "";
  const person = result?.person?.id || result?.person_id || result?.request?.result?.person_id || "";
  if (dog) return { slug: String(dog), subject_kind: "dog_comm" };
  if (operation) return { slug: String(operation), subject_kind: "operation" };
  if (person) return { slug: String(person), subject_kind: "person" };
  return { slug: "", subject_kind: "" };
}

/**
 * Park a name lead with source=x_mention, then promote only when the caller
 * already has two official cites that are not the mention. Does not invent cites.
 */
export async function digMention(row = {}, envelope) {
  const env = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : null;
  const subject = String(env?.subject || "").trim();
  const namedKind = env && explicitKind(env);
  const subjectKind = namedKind ? canonicalSubjectKind(namedKind) : "person";
  if (namedKind && !subjectKind) {
    return { status: "fail_closed", error_reason: "invalid_kind", kept_person_slug: null, lead_id: null };
  }
  let lead = null;
  if (subject) {
    try {
      const ingested = await leadIngest({
        subject,
        subject_kind: subjectKind,
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
        agencies: env.agencies || "",
        summary: env.summary || env.comments || env.reason || "",
        handle: env.handle || "",
        source_url: env.source_url || "",
        posted_at: env.posted_at || "",
        account_name: env.account_name || "",
        text: env.text || "",
        subject_status_id: row.subject_status_id,
        mention_status_id: row.mention_status_id,
        cite_urls: [],
      });
      lead = ingested.request;
    } catch (err) {
      const code = err instanceof AddError || err?.code ? err.code : "fail_closed";
      return {
        status: "fail_closed",
        error_reason: normalizeErrorReason(code, "fail_closed"),
        kept_person_slug: null,
        lead_id: null,
      };
    }
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
  if (subjectKind !== "dog_comm" && (!subject || cites.length < CITE_FLOOR)) {
    return {
      status: "fail_closed",
      error_reason: subject ? "cites_floor" : "missing_subject",
      kept_person_slug: null,
      lead_id,
    };
  }
  if (!subject) {
    return {
      status: "fail_closed",
      error_reason: "missing_subject",
      kept_person_slug: null,
      lead_id,
    };
  }
  if (subjectKind === "operation" && !normalizeOperationTag(env.category || env.tag || "")) {
    return {
      status: "fail_closed",
      error_reason: "invalid_tag",
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
        cite_urls: subjectKind === "dog_comm" ? [] : cites,
      },
    });
    const kept = keptFromResult(result);
    if (!kept.slug) {
      return { status: "fail_closed", error_reason: "missing_slug", kept_person_slug: null, lead_id };
    }
    await recordXMentionKeepAttribution(row, result);
    return {
      status: "kept",
      kept_person_slug: kept.slug,
      subject_kind: kept.subject_kind,
      error_reason: null,
      lead_id,
      person: result.person || null,
      operation: result.operation || null,
      dog: result.dog || null,
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
  return { reply: false, reason, text: "", detail_path: "" };
}

/**
 * Final X reply only for KEEP. Plain-text confirmation plus a host screenshot
 * of detail_path on the public origin. The path is not a URL and is not the reply text.
 * fail_closed, rejected, ambiguous_subject, and dig failures stay silent.
 * priorFinal is the earlier subject that already owns this KEEP slug.
 */
export function buildReplyPlan(row, { priorFinal = false, displayName = "", detailPath = "" } = {}) {
  if (!row) return quietPlan("not_found");
  if (row.reply_final_at || priorFinal) return quietPlan("first_mentioner");
  if (row.status !== "kept") return quietPlan("no_reply");
  const text = keepReplyText(displayName, row.kept_person_slug);
  const detail_path = detailPath || keepDetailPath(row.kept_person_slug, "person");
  if (!text || !detail_path) return quietPlan("missing_label");
  return { reply: true, kind: "final", reason: "kept", text, detail_path };
}
