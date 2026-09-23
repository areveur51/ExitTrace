/** Bearer routes for the Render mention queue. Bot POST only. Worker claim/complete only. */

import { MentionQueueError, mentionRole } from "./mention-queue.mjs";
import {
  claimMention,
  completeMention,
  enqueueMention,
  listPendingMentions,
  listUnrepliedMentions,
  planMentionReply,
  stampMentionReply,
} from "./mention-queue.mjs";

const COMPLETE_FIELDS = [
  "subject_status_id",
  "claim_owner",
  "status",
  "kept_person_slug",
  "error_reason",
];

export { COMPLETE_FIELDS };

function jsonBody(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new MentionQueueError("JSON object required", "invalid_json", 400);
    }
    return parsed;
  } catch (err) {
    if (err instanceof MentionQueueError) throw err;
    throw new MentionQueueError("invalid JSON", "invalid_json", 400);
  }
}

function requireRole(headers, role) {
  const got = mentionRole(headers);
  if (got !== role) throw new MentionQueueError("unauthorized", "unauthorized", 401);
  return got;
}

export async function handleMentionApi({ method, pathname, searchParams, headers, body }) {
  const verb = String(method || "GET").toUpperCase();
  if (pathname === "/api/mention-queue/preflight" && verb === "POST") {
    requireRole(headers, "bot");
    return { status: 200, body: { ok: true, probe: true } };
  }
  if (pathname === "/api/mention-queue" && verb === "POST") {
    requireRole(headers, "bot");
    const result = await enqueueMention(jsonBody(body));
    return { status: result.created ? 201 : 200, body: result };
  }
  if (pathname === "/api/mention-queue/pending" && verb === "GET") {
    requireRole(headers, "worker");
    const rows = await listPendingMentions({ limit: searchParams?.get("limit") });
    return { status: 200, body: { ok: true, rows } };
  }
  if (pathname === "/api/mention-queue/unreplied" && verb === "GET") {
    requireRole(headers, "worker");
    const rows = await listUnrepliedMentions({ limit: searchParams?.get("limit") });
    return { status: 200, body: { ok: true, rows } };
  }
  if (pathname === "/api/mention-queue/work" && verb === "GET") {
    requireRole(headers, "worker");
    const [pending, unreplied] = await Promise.all([
      listPendingMentions({ limit: searchParams?.get("pending_limit") || 5 }),
      listUnrepliedMentions({ limit: searchParams?.get("unreplied_limit") }),
    ]);
    return { status: 200, body: { ok: true, pending, unreplied } };
  }
  if (pathname === "/api/mention-queue/claim" && verb === "POST") {
    requireRole(headers, "worker");
    const result = await claimMention(jsonBody(body));
    return { status: 200, body: result };
  }
  if (pathname === "/api/mention-queue/complete" && verb === "POST") {
    requireRole(headers, "worker");
    const input = jsonBody(body);
    const extra = Object.keys(input).filter((key) => !COMPLETE_FIELDS.includes(key));
    if (extra.length) {
      throw new MentionQueueError("complete accepts queue status only", "invalid_body", 400);
    }
    const result = await completeMention(input);
    return { status: 200, body: result };
  }
  if (pathname === "/api/mention-queue/reply" && verb === "POST") {
    const input = jsonBody(body);
    const kind = input.kind === "final" ? "final" : input.kind === "soft" ? "soft" : "";
    requireRole(headers, kind === "final" ? "worker" : "bot");
    if (!kind) throw new MentionQueueError("reply kind must be soft or final", "invalid_reply", 400);
    const result = await stampMentionReply({
      subject_status_id: input.subject_status_id,
      kind,
    });
    return { status: 200, body: result };
  }
  if (pathname === "/api/mention-queue/reply-plan" && verb === "GET") {
    requireRole(headers, "worker");
    const result = await planMentionReply(searchParams?.get("subject_status_id"));
    return {
      status: 200,
      body: {
        ok: true,
        reply: result.reply,
        kind: result.kind || "",
        reason: result.reason,
        text: result.text,
        subject_status_id: result.row.subject_status_id,
      },
    };
  }
  if (pathname.startsWith("/api/mention-queue")) {
    if (verb !== "GET" && verb !== "POST") {
      return { status: 405, body: { ok: false, error: "method_not_allowed" } };
    }
    return { status: 404, body: { ok: false, error: "not_found" } };
  }
  return null;
}

export async function dispatchMentionRoute(req, res, { send, readBody }) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (!url.pathname.startsWith("/api/mention-queue")) return false;
  try {
    const raw =
      req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req, 100_000);
    const result = await handleMentionApi({
      method: req.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      headers: req.headers || {},
      body: raw,
    });
    send(res, result.status, JSON.stringify(result.body), {
      "Content-Type": "application/json; charset=utf-8",
    });
  } catch (err) {
    const status = Number(err.status) || 500;
    const code = status >= 500 ? "error" : err.code || "error";
    if (status >= 500) console.error("[mention-queue]", err.code || "error");
    send(res, status, JSON.stringify({ ok: false, error: code }), {
      "Content-Type": "application/json; charset=utf-8",
    });
  }
  return true;
}
