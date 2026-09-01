import { createHash, randomBytes } from "node:crypto";
import { PROMOTE_CATEGORY_IDS } from "./categories.mjs";
import {
  handleFromUrl,
  handleKey,
  hostOf,
  isGovHost,
  isOfficialGovAccountOrUrl,
  isOfficialGovHandle,
  isOfficialGovPostUrl,
  isSocialHost,
  normalizeHandle,
  parseHttpUrl,
  partitionCiteUrls,
} from "./official.mjs";
import {
  CITE_FLOOR,
  PromoteError,
  parseCiteUrls,
  parseEventDate,
  personSlug,
  validateIdentifiedPersonInput,
} from "./promote.mjs";
import {
  isEligibleNetWorthUrl,
  parseNetWorthUsd,
} from "./net-worth.mjs";
import { isEligiblePortraitUrl, isPeopleMediaHref } from "./portrait.mjs";
import { canonicalPublicUrl } from "./urls.mjs";
import {
  applyIdentifiedPerson,
  countDogComms,
  createAddRequest,
  findDogMatch,
  getAddRequest,
  insertDogComm,
  listAddRequests,
  listDogComms,
  listSourcePosts,
  lookupSourcePost,
  nextPendingAddRequest,
  promoteSourcePost,
  updateAddRequest,
} from "./store.mjs";

export class AddError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AddError";
    this.code = code;
  }
}

export const ADD_KINDS = ["person", "dog"];
export const ADD_STATUSES = ["pending", "applied", "rejected"];

export function newAddRequestId(seed = "") {
  const nonce = randomBytes(6).toString("hex");
  const hex = createHash("sha256")
    .update(`${seed}:${nonce}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  return `ar-${hex}`;
}

export function requestFingerprint(row) {
  const kind = row?.kind === "dog" ? "dog" : "person";
  if (kind === "dog") {
    return [
      "dog",
      handleKey(row.handle),
      canonicalPublicUrl(row.source_url) || "",
      String(row.posted_at || ""),
    ].join(":");
  }
  return [
    "person",
    String(row.subject || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "),
    canonicalPublicUrl(row.hint_url || row.source_url) || "",
    String(row.event_date || ""),
  ].join(":");
}

function optionalDate(raw, field) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parsed = parseEventDate(text);
  if (!parsed) {
    throw new AddError(`${field} must be YYYY-MM-DD`, "invalid_date");
  }
  return parsed;
}

function optionalUrl(raw, field) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (!canonicalPublicUrl(text)) {
    throw new AddError(`${field} is not an http(s) URL`, "invalid_url");
  }
  return text;
}

function optionalPortrait(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (isPeopleMediaHref(text)) return text;
  if (!canonicalPublicUrl(text)) {
    throw new AddError("portrait URL is not an http(s) URL", "invalid_photo");
  }
  if (!isEligiblePortraitUrl(text)) {
    throw new AddError(
      "portrait must be a Wikimedia or official government still; leave blank if none",
      "ineligible_photo",
    );
  }
  return text;
}

function optionalNetWorth(input = {}) {
  const source = String(input.net_worth_source || "").trim();
  const usdRaw = input.net_worth_usd;
  const hasUsd = usdRaw !== undefined && usdRaw !== null && String(usdRaw).trim() !== "";
  const note = String(input.net_worth_note || "").trim();
  if (source) {
    if (!canonicalPublicUrl(source)) {
      throw new AddError("net-worth source is not an http(s) URL", "invalid_net_worth_source");
    }
    if (!isEligibleNetWorthUrl(source)) {
      throw new AddError(
        "net worth must cite a published Forbes or Bloomberg estimate; leave blank if none",
        "ineligible_net_worth",
      );
    }
  }
  let usd = null;
  if (hasUsd) {
    usd = parseNetWorthUsd(usdRaw);
    if (usd === null) {
      throw new AddError(
        "net_worth_usd must be a non-negative integer USD amount",
        "invalid_net_worth_usd",
      );
    }
    if (!source) {
      throw new AddError(
        "net worth needs a Forbes or Bloomberg source URL; leave both blank if none",
        "missing_net_worth_source",
      );
    }
  }
  return {
    net_worth_usd: hasUsd ? usd : "",
    net_worth_source: source,
    net_worth_note: note,
  };
}

export function validateQueueInput(input = {}) {
  const kind = String(input.kind || "person").trim();
  if (!ADD_KINDS.includes(kind)) {
    throw new AddError("kind must be person or dog", "invalid_kind");
  }
  if (kind === "person") {
    const subject = String(input.subject || input.name || "").trim();
    if (!subject) {
      throw new AddError("name is required", "missing_subject");
    }
    const category = String(input.category || "").trim();
    if (category && !PROMOTE_CATEGORY_IDS.includes(category)) {
      throw new AddError(
        `category must be one of: ${PROMOTE_CATEGORY_IDS.join(", ")}`,
        "invalid_category",
      );
    }
    const event_date = optionalDate(input.event_date, "event_date");
    const hint_url = optionalUrl(input.hint_url || input.source_url, "hint_url");
    const photo = optionalPortrait(input.photo || input.portrait_url);
    const worth = optionalNetWorth(input);
    return {
      kind,
      subject,
      category,
      event_date,
      hint_url,
      handle: "",
      source_url: hint_url,
      posted_at: "",
      cite_urls: [],
      photo,
      photo_credit: String(input.photo_credit || "").trim(),
      ...worth,
    };
  }

  const handle = normalizeHandle(input.handle);
  const source_url = optionalUrl(input.source_url || input.post_url, "source_url");
  const posted_at = optionalDate(input.posted_at || input.event_date, "posted_at");
  if (!handle && !source_url) {
    throw new AddError(
      "official government handle or official post URL is required",
      "missing_dog_identity",
    );
  }
  if (!isOfficialGovAccountOrUrl({ handle, source_url })) {
    throw new AddError(
      "dog comms accept official government accounts only; unofficial social is rejected",
      "unofficial_social",
    );
  }
  return {
    kind,
    subject: "",
    category: "dog_comms",
    event_date: posted_at,
    hint_url: source_url,
    handle,
    source_url,
    posted_at,
    cite_urls: [],
  };
}

export function officialCiteUrls(raw) {
  let parsed;
  try {
    parsed = parseCiteUrls(raw);
  } catch (err) {
    if (err instanceof PromoteError) {
      throw new AddError(err.message, err.code);
    }
    throw err;
  }
  return partitionCiteUrls(parsed);
}

export function validateProcessPersonInput(input = {}) {
  if (!String(input.event_date || "").trim() && String(input.posted_at || "").trim()) {
    throw new AddError(
      "event_date is required as YYYY-MM-DD (calendar date, not posted_at)",
      "missing_event_date",
    );
  }
  let parsed;
  try {
    parsed = validateIdentifiedPersonInput(input);
  } catch (err) {
    if (err instanceof PromoteError) {
      throw new AddError(err.message, err.code);
    }
    throw err;
  }
  const { official, extra } = officialCiteUrls(
    Array.isArray(input.cite_urls) && input.cite_urls.length
      ? input.cite_urls
      : parsed.cite_urls.map((c) => c.raw),
  );
  if (official.length < CITE_FLOOR) {
    throw new AddError(
      `need at least ${CITE_FLOOR} published-news or official gov/news-org social cite URLs`,
      "cites_floor",
    );
  }
  return { ...parsed, cite_urls: official, extra_urls: extra };
}

export function validateProcessDogInput(input = {}) {
  const source_url = String(input.source_url || input.hint_url || "").trim();
  if (!source_url || !canonicalPublicUrl(source_url)) {
    throw new AddError(
      "official government post URL is required",
      "missing_source_url",
    );
  }
  const parsed = parseHttpUrl(source_url);
  if (!parsed) {
    throw new AddError("source_url is not an http(s) URL", "invalid_url");
  }
  if (isSocialHost(hostOf(parsed)) && !isOfficialGovPostUrl(source_url)) {
    throw new AddError(
      "dog comms accept official government accounts only; unofficial social is rejected",
      "unofficial_social",
    );
  }
  if (!isSocialHost(hostOf(parsed)) && !isGovHost(hostOf(parsed))) {
    throw new AddError(
      "dog comms accept official government accounts only; unofficial social is rejected",
      "unofficial_social",
    );
  }
  const handle = normalizeHandle(input.handle) || handleFromUrl(source_url);
  if (!handle && !isGovHost(hostOf(parsed))) {
    throw new AddError("official government handle is required", "missing_handle");
  }
  if (handle && !isOfficialGovHandle(handle) && !isGovHost(hostOf(parsed))) {
    throw new AddError(
      "dog comms accept official government accounts only; unofficial social is rejected",
      "unofficial_social",
    );
  }
  if (!isOfficialGovAccountOrUrl({ handle, source_url })) {
    throw new AddError(
      "dog comms accept official government accounts only; unofficial social is rejected",
      "unofficial_social",
    );
  }
  const posted_at = parseEventDate(input.posted_at || input.event_date);
  if (!posted_at) {
    throw new AddError(
      "posted_at is required as YYYY-MM-DD",
      "missing_event_date",
    );
  }
  return {
    handle,
    source_url,
    posted_at,
    account_name: String(input.account_name || "").trim(),
    text: String(input.text || "").trim(),
    still: String(input.still || "").trim(),
    still_credit: String(input.still_credit || "").trim(),
  };
}

export function dogRowId(handle, postedAt, sourceUrl) {
  const slug = personSlug(stripHandleSafe(handle)) || "gov";
  const dated = `${slug}-${postedAt}`;
  const hex = createHash("sha256")
    .update(canonicalPublicUrl(sourceUrl) || sourceUrl || dated)
    .digest("hex")
    .slice(0, 8);
  return `${dated}-${hex}`;
}

function stripHandleSafe(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@/, "");
}

export function mergeProcessOverlay(request, overlay = {}) {
  const citeFromOverlay = Array.isArray(overlay.cite_urls) ? overlay.cite_urls : [];
  const citeFromRequest = Array.isArray(request.cite_urls) ? request.cite_urls : [];
  return {
    ...request,
    subject: String(overlay.subject || request.subject || "").trim(),
    category: String(overlay.category || request.category || "").trim(),
    event_date: String(overlay.event_date || request.event_date || "").trim(),
    extra_urls: Array.isArray(overlay.extra_urls)
      ? overlay.extra_urls
      : request.extra_urls || [],
    hint_url: String(overlay.hint_url || request.hint_url || "").trim(),
    handle: String(overlay.handle || request.handle || "").trim(),
    source_url: String(
      overlay.source_url || request.source_url || request.hint_url || "",
    ).trim(),
    posted_at: String(overlay.posted_at || request.posted_at || "").trim(),
    account_name: String(overlay.account_name || request.account_name || "").trim(),
    text: String(overlay.text || request.text || "").trim(),
    still: String(overlay.still || request.still || "").trim(),
    still_credit: String(overlay.still_credit || request.still_credit || "").trim(),
    summary: String(overlay.summary || request.summary || "").trim(),
    role: String(overlay.role || request.role || "").trim(),
    organization: String(overlay.organization || request.organization || "").trim(),
    country: String(overlay.country || request.country || "").trim(),
    branch: String(overlay.branch || request.branch || "").trim(),
    photo: String(overlay.photo || request.photo || "").trim(),
    photo_credit: String(overlay.photo_credit || request.photo_credit || "").trim(),
    net_worth_usd:
      overlay.net_worth_usd !== undefined && overlay.net_worth_usd !== ""
        ? overlay.net_worth_usd
        : request.net_worth_usd,
    net_worth_source: String(
      overlay.net_worth_source || request.net_worth_source || "",
    ).trim(),
    net_worth_note: String(
      overlay.net_worth_note || request.net_worth_note || "",
    ).trim(),
    mediaDir: overlay.mediaDir || request.mediaDir,
    cite_urls: citeFromOverlay.length ? citeFromOverlay : citeFromRequest,
  };
}

export async function queueAddRequest(input) {
  const parsed = validateQueueInput(input);
  const pending = await listAddRequests({ status: "pending" });
  const fingerprint = requestFingerprint(parsed);
  const existing = pending.find((row) => requestFingerprint(row) === fingerprint);
  if (existing) return { request: existing, created: false };
  const request = await createAddRequest({
    id: newAddRequestId(fingerprint),
    ...parsed,
    status: "pending",
    cite_urls: [],
  });
  return { request, created: true };
}

function citeUrlList(cites) {
  return (cites || []).map((c) => (typeof c === "string" ? c : c.raw)).filter(Boolean);
}

async function snapshotFromLocalStore(sourceUrl) {
  const canonical = canonicalPublicUrl(sourceUrl);
  const dogs = await listDogComms();
  const existing = dogs.find((row) => canonicalPublicUrl(row.source_url) === canonical);
  if (existing) {
    return {
      account_name: existing.account_name || "",
      text: existing.text || "",
      still: existing.still || "",
      still_credit: existing.still_credit || "",
      snapshot: existing.snapshot || {},
    };
  }
  const posts = await listSourcePosts({});
  const post = posts.find(
    (row) =>
      row.canonical_url === canonical || canonicalPublicUrl(row.source_url) === canonical,
  );
  if (!post) {
    return { account_name: "", text: "", still: "", still_credit: "", snapshot: {} };
  }
  return {
    account_name: post.poster_name || "",
    text: post.text || "",
    still: "",
    still_credit: "",
    snapshot: {
      handle: post.poster_handle || "",
      posted_at: post.posted_at || "",
      text: post.text || "",
    },
  };
}

async function applyQueuedPerson(merged) {
  const parsed = validateProcessPersonInput(merged);
  const cite_urls = citeUrlList(parsed.cite_urls);
  const hint = String(merged.hint_url || merged.source_url || "").trim();
  const sourcePost = hint ? await lookupSourcePost({ source_url: hint }) : null;
  const extra_urls = citeUrlList(parsed.extra_urls);
  let result;
  if (sourcePost) {
    result = await promoteSourcePost({
      id: sourcePost.id,
      source_url: sourcePost.source_url,
      subject: parsed.subject,
      event_date: parsed.event_date,
      category: parsed.category,
      cite_urls,
      summary: parsed.summary,
      role: parsed.role,
      organization: parsed.organization,
      country: parsed.country,
      branch: parsed.branch,
      photo: parsed.photo,
      photo_credit: parsed.photo_credit,
      net_worth_usd: merged.net_worth_usd,
      net_worth_source: merged.net_worth_source,
      net_worth_note: merged.net_worth_note,
      mediaDir: merged.mediaDir,
    });
  } else {
    result = await applyIdentifiedPerson({
      subject: parsed.subject,
      event_date: parsed.event_date,
      category: parsed.category,
      cite_urls,
      summary: parsed.summary,
      role: parsed.role,
      organization: parsed.organization,
      country: parsed.country,
      branch: parsed.branch,
      photo: parsed.photo,
      photo_credit: parsed.photo_credit,
      net_worth_usd: merged.net_worth_usd,
      net_worth_source: merged.net_worth_source,
      net_worth_note: merged.net_worth_note,
      mediaDir: merged.mediaDir,
    });
  }
  return { ...result, extra_urls };
}

async function applyQueuedDog(merged) {
  const parsed = validateProcessDogInput(merged);
  const existing = await findDogMatch({
    handle: parsed.handle,
    source_url: parsed.source_url,
    posted_at: parsed.posted_at,
  });
  if (existing) {
    return {
      action: "annotated",
      dog: existing,
      added_cites: 0,
      dog_comms: await countDogComms(),
    };
  }
  const stored = await snapshotFromLocalStore(parsed.source_url);
  const dog = await insertDogComm({
    id: dogRowId(parsed.handle, parsed.posted_at, parsed.source_url),
    posted_at: parsed.posted_at,
    handle: parsed.handle,
    account_name: parsed.account_name || stored.account_name || parsed.handle,
    text: parsed.text || stored.text || "",
    still: parsed.still || stored.still || "",
    still_credit: parsed.still_credit || stored.still_credit || "",
    source_url: parsed.source_url,
    snapshot:
      Object.keys(stored.snapshot || {}).length > 0
        ? stored.snapshot
        : {
            handle: parsed.handle,
            posted_at: parsed.posted_at,
            text: parsed.text || stored.text || "",
          },
  });
  return {
    action: "created",
    dog,
    added_cites: 0,
    dog_comms: await countDogComms(),
  };
}

export async function processAddRequest({ id, next, overlay } = {}) {
  let request = null;
  if (id) request = await getAddRequest(id);
  else if (next) request = await nextPendingAddRequest();
  if (!request) {
    throw new AddError(
      id ? `add request not found: ${id}` : "no pending add request",
      "request_not_found",
    );
  }
  if (request.status === "applied" && request.result) {
    return { ...request.result, request, replayed: true };
  }
  const merged = mergeProcessOverlay(request, overlay || {});
  try {
    const result =
      request.kind === "dog" ? await applyQueuedDog(merged) : await applyQueuedPerson(merged);
    const updated = await updateAddRequest(request.id, {
      ...merged,
      extra_urls: result.extra_urls || merged.extra_urls || [],
      status: "applied",
      error: "",
      result: {
        action: result.action,
        person_id: result.person?.id || "",
        dog_id: result.dog?.id || "",
        added_cites: result.added_cites || 0,
        extra_urls: result.extra_urls || [],
        people: result.people,
        dog_comms: result.dog_comms,
      },
      processed_at: new Date().toISOString(),
    });
    return { ...result, request: updated };
  } catch (err) {
    await updateAddRequest(request.id, {
      status: "rejected",
      error: err.message || String(err),
      processed_at: new Date().toISOString(),
    });
    if (err instanceof AddError || err instanceof PromoteError) throw err;
    throw new AddError(err.message || String(err), err.code || "process_failed");
  }
}

