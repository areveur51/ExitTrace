/**
 * X mention dig. The mention is a lead, never a cite.
 * KEEP still goes through queueAddRequest + processAddRequest.
 */

import { AddError, leadRecordFields, processAddRequest, queueAddRequest } from "./add-request.mjs";
import { keepDetailPath } from "./keep-page-shot.mjs";
import { centralCastingCiteStanding } from "./kind-comms.mjs";
import { normalizeOperationTag } from "./operation.mjs";
import { CITE_FLOOR } from "./promote.mjs";
import { recordXMentionKeepAttribution } from "./request-attributions.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

export const LEAD_SOURCE_X_MENTION = "x_mention";
export const SOFT_ACK_TEXT = "Queued for ExitTrace review.";

/**
 * Dig subjects. Mapped onto existing add-request and catalog ids.
 * dog_comms → add kind `dog`. corona_comms → person category `corona_comms`.
 * red_folder → catalog kind `red_folder`. central_casting_comms → `central_casting`.
 */
const SUBJECT_KIND = Object.freeze({
  person: "person",
  operation: "operation",
  dog: "dog_comm",
  dog_comm: "dog_comm",
  dog_comms: "dog_comm",
  corona_comms: "corona_comms",
  red_folder: "red_folder",
  red_folder_comm: "red_folder",
  red_folder_comms: "red_folder",
  central_casting: "central_casting_comms",
  central_casting_comm: "central_casting_comms",
  central_casting_comms: "central_casting_comms",
});

export function canonicalSubjectKind(raw) {
  return SUBJECT_KIND[String(raw || "").trim()] || "";
}

/** add-request kind id the promote stack already queues. */
export function addKindForSubject(subjectKind) {
  const key = canonicalSubjectKind(subjectKind);
  if (key === "person" || key === "corona_comms") return "person";
  if (key === "operation") return "operation";
  if (key === "dog_comm") return "dog";
  if (key === "red_folder") return "red_folder";
  if (key === "central_casting_comms") return "central_casting";
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
  const subjectKind = named ? canonicalSubjectKind(named) : "person";
  const kind = named ? addKindForSubject(named) : "person";
  if (!kind) {
    throw new AddError(
      "kind must be person, operation, dog, red_folder, or central_casting",
      "invalid_kind",
    );
  }
  const category =
    subjectKind === "corona_comms" ? "corona_comms" : input.category || "";
  return queueAddRequest({
    kind,
    subject: input.subject,
    category,
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

function firstKeptId(...values) {
  for (const value of values) {
    if (value == null || Array.isArray(value)) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function keptFromResult(result) {
  const clip = firstKeptId(
    result?.central_casting?.id,
    result?.central_casting_id,
    result?.request?.result?.central_casting_id,
  );
  const folder = firstKeptId(
    result?.red_folder?.id,
    result?.red_folder_id,
    result?.request?.result?.red_folder_id,
  );
  const dog = firstKeptId(result?.dog?.id, result?.dog_id, result?.request?.result?.dog_id);
  const operation = firstKeptId(
    result?.operation?.id,
    result?.operation_id,
    result?.request?.result?.operation_id,
  );
  const person = firstKeptId(
    result?.person?.id,
    result?.person_id,
    result?.request?.result?.person_id,
    result?.central_casting?.person_id,
  );
  if (clip) return { slug: String(person), subject_kind: "central_casting_comms" };
  if (folder) return { slug: String(folder), subject_kind: "red_folder" };
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
  const postCatalog = subjectKind === "dog_comm" || subjectKind === "red_folder";
  const casting = subjectKind === "central_casting_comms";
  if (!postCatalog && !casting && (!subject || cites.length < CITE_FLOOR)) {
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
  if (casting) {
    const standing = centralCastingCiteStanding({
      sourceUrl: env.source_url || row.subject_url || "",
      quotedUrls: cites,
    });
    if (!standing) {
      return {
        status: "fail_closed",
        error_reason: "missing_cite",
        kept_person_slug: null,
        lead_id,
      };
    }
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
        category: subjectKind === "corona_comms" ? "corona_comms" : env.category || "",
        cite_urls: postCatalog ? [] : cites,
      },
    });
    const kept = keptFromResult(result);
    if (!kept.slug) {
      return { status: "fail_closed", error_reason: "missing_slug", kept_person_slug: null, lead_id };
    }
    const surfaced =
      subjectKind === "corona_comms" && kept.subject_kind === "person"
        ? "corona_comms"
        : kept.subject_kind;
    await recordXMentionKeepAttribution(row, result);
    return {
      status: "kept",
      kept_person_slug: kept.slug,
      subject_kind: surfaced,
      error_reason: null,
      lead_id,
      person: result.person || null,
      operation: result.operation || null,
      dog: result.dog || null,
      red_folder: result.red_folder || null,
      central_casting: Array.isArray(result.central_casting) ? null : result.central_casting || null,
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
