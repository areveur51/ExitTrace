import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { handle } from "../app/server.mjs";
import { capturePublicKeepPage, keepDetailPath, publicKeepPageUrl } from "../app/lib/keep-page-shot.mjs";
import { leadIngest, SOFT_ACK_TEXT, buildReplyPlan, digMention, keepReplyText } from "../app/lib/mention-dig.mjs";
import {
  POLL_MAX_MS,
  POLL_MIN_MS,
  LEASE_MAX_MS,
  LEASE_MIN_MS,
  claimLeaseMs,
  claimMention,
  completeMention,
  enqueueMention,
  listUnrepliedMentions,
  pollIntervalMs,
  readMentionTokens,
  resetMentionQueue,
  stampMentionReply,
  planMentionReply,
} from "../app/lib/mention-queue.mjs";
import { oauth1Authorization } from "../app/lib/x-oauth.mjs";
import { mentionsFromApiPayload, resolveSubjectStatusId } from "../app/lib/x-mentions.mjs";
import {
  classifyQueueHttp,
  isCfChallenge,
  isEnqueueAck,
  pollJournal,
  pollOnce,
  queueBackoffMs,
  shouldSoftAck,
} from "../app/lib/x-mention-poll.mjs";
import { replyBody, xBackoffMs } from "../app/lib/x-client.mjs";
import {
  CLAIMS_PER_TICK,
  COMPLETE_BODY_KEYS,
  DIG_TIMEOUT_MS,
  parseDigEnvelope,
  scrubDigEnv,
  workerJournal,
  workerOnce,
} from "../app/lib/x-mention-worker.mjs";
import { callWarmDig, serveWarmDig } from "../app/lib/x-mention-dig-warm.mjs";
import {
  ALL_UPSERT_TABLES,
  PUBLISHED_TABLES,
  RENDER_ONLY_TABLES,
  buildUpsertSql,
  normalizePayload,
} from "../app/lib/gap-upsert.mjs";
import { PLACE_STEPS } from "../scripts/prove-new-kind-render-sync.mjs";
import { countPeople, getAddRequest, listAddRequests, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOT = "bot-token-test";
const WORKER = "worker-token-test";

process.env.MENTION_QUEUE_BOT_TOKEN = BOT;
process.env.MENTION_QUEUE_WORKER_TOKEN = WORKER;
delete process.env.EXITTRACE_PUBLIC_ORIGIN;

const CITES = [
  "https://www.example.com/news/quota-mention-held",
  "https://www.example.net/world/quota-mention-arrest",
];
const PUBLIC_ORIGIN = "https://exittrace.example";
const MEDIA_ID = "1880028106020515840";
const SHOT_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function glassPage(url) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/html; charset=utf-8" },
    async text() {
      return `<!DOCTYPE html><html lang="en" data-theme="glass"><body>${url}</body></html>`;
    },
  };
}

function mediaUploadResponse(target) {
  if (String(target).endsWith("/media/upload/initialize")) {
    return jsonResponse(200, { data: { id: MEDIA_ID, media_key: `3_${MEDIA_ID}` } });
  }
  if (/\/media\/upload\/\d+\/append$/.test(String(target))) return jsonResponse(200, { data: {} });
  if (/\/media\/upload\/\d+\/finalize$/.test(String(target))) return jsonResponse(200, { data: { id: MEDIA_ID } });
  return null;
}

function executableSql(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function mention(over = {}) {
  const mention_status_id = over.mention_status_id || "1000000000000000001";
  const quoted = over.quoted_id || "2000000000000000002";
  return {
    mention_status_id,
    author_id: over.author_id || "424242",
    author_handle: over.author_handle || "reader",
    text: over.text || "look at this post",
    mention_url: `https://x.com/reader/status/${mention_status_id}`,
    referenced_json:
      over.referenced_json === null
        ? null
        : over.referenced_json || [{ type: "quoted", id: quoted }],
    subject_url:
      over.subject_url ||
      `https://x.com/i/web/status/${over.referenced_json === null ? mention_status_id : quoted}`,
    ...over,
    mention_status_id,
  };
}

function requestPage(pathname, { method = "GET", body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : String(body);
    const headers = { host: "127.0.0.1" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (payload) headers["content-type"] = "application/json";
    const req = {
      method,
      url: pathname,
      headers,
      body: payload,
      async *[Symbol.asyncIterator]() {
        if (payload) yield Buffer.from(payload);
      },
    };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status;
        this.headersSent = true;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        resolve({
          status: this.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("subject id prefers quoted, then replied_to, else the mention", () => {
  const quoted = resolveSubjectStatusId({
    mention_status_id: "1111111111111111111",
    referenced_tweets: [
      { type: "replied_to", id: "2222222222222222222" },
      { type: "quoted", id: "3333333333333333333" },
      { type: "retweeted", id: "4444444444444444444" },
    ],
  });
  assert.equal(quoted.subject_status_id, "3333333333333333333");
  assert.equal(quoted.subject_from, "quoted");

  const reply = resolveSubjectStatusId({
    id: "1111111111111111111",
    referenced_tweets: [{ type: "replied_to", id: "2222222222222222222" }],
  });
  assert.equal(reply.subject_status_id, "2222222222222222222");
  assert.equal(reply.subject_from, "replied_to");

  const alone = resolveSubjectStatusId({ mention_status_id: "1111111111111111111" });
  assert.equal(alone.subject_status_id, "1111111111111111111");
  assert.equal(alone.subject_from, "mention");
});

test("api payload keeps quoted subject and does not invent media", () => {
  const rows = mentionsFromApiPayload({
    data: [
      {
        id: "1000000000000000001",
        author_id: "7",
        text: "see quoted",
        referenced_tweets: [{ type: "quoted", id: "2000000000000000002" }],
      },
    ],
    includes: { users: [{ id: "7", username: "reader" }] },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject_status_id, "2000000000000000002");
  assert.equal(rows[0].mention_status_id, "1000000000000000001");
  assert.equal(rows[0].media_json, null);
  assert.equal(rows[0].author_handle, "reader");
});

test("enqueue is idempotent on subject_status_id and prefers the quoted id", async () => {
  resetMentionQueue();
  const first = await enqueueMention(mention());
  assert.equal(first.created, true);
  assert.equal(first.row.subject_status_id, "2000000000000000002");
  assert.equal(first.row.mention_status_id, "1000000000000000001");
  assert.equal(first.row.status, "pending");

  const again = await enqueueMention(
    mention({
      mention_status_id: "1000000000000000099",
      text: "second mention of the same subject",
    }),
  );
  assert.equal(again.created, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.row.mention_status_id, "1000000000000000001");
  assert.equal(again.row.text, "look at this post");
  assert.equal(again.row.status, "pending");
});

test("subject_status_id that ignores a quoted post is rejected", async () => {
  resetMentionQueue();
  await assert.rejects(
    () =>
      enqueueMention(
        mention({
          subject_status_id: "1000000000000000001",
          subject_url: "https://x.com/reader/status/1000000000000000001",
        }),
      ),
    (err) => err.code === "subject_mismatch",
  );
});

test("blocklist and per-author rate limit do not insert", async () => {
  resetMentionQueue();
  const prevList = process.env.MENTION_BLOCKLIST;
  const prevMax = process.env.MENTION_AUTHOR_MAX;
  process.env.MENTION_BLOCKLIST = "spamhandle,999001";
  process.env.MENTION_AUTHOR_MAX = "1";
  try {
    await assert.rejects(
      () =>
        enqueueMention(
          mention({
            referenced_json: null,
            mention_status_id: "3000000000000000001",
            author_handle: "spamhandle",
            author_id: "55555",
          }),
        ),
      (err) => err.code === "blocked",
    );
    await assert.rejects(
      () =>
        enqueueMention(
          mention({
            referenced_json: null,
            mention_status_id: "3000000000000000002",
            author_id: "999001",
            author_handle: "other",
          }),
        ),
      (err) => err.code === "blocked",
    );
    const ok = await enqueueMention(
      mention({
        referenced_json: null,
            mention_status_id: "3000000000000000003",
            author_id: "77777",
            author_handle: "reader",
      }),
    );
    assert.equal(ok.created, true);
    await assert.rejects(
      () =>
        enqueueMention(
          mention({
            referenced_json: null,
            mention_status_id: "3000000000000000004",
            author_id: "77777",
            author_handle: "reader",
          }),
        ),
      (err) => err.code === "rate_limited",
    );
  } finally {
    if (prevList === undefined) delete process.env.MENTION_BLOCKLIST;
    else process.env.MENTION_BLOCKLIST = prevList;
    if (prevMax === undefined) delete process.env.MENTION_AUTHOR_MAX;
    else process.env.MENTION_AUTHOR_MAX = prevMax;
  }
});

test("duplicate subject is not rate limited again", async () => {
  resetMentionQueue();
  const prevMax = process.env.MENTION_AUTHOR_MAX;
  process.env.MENTION_AUTHOR_MAX = "1";
  try {
    await enqueueMention(mention({ referenced_json: null, mention_status_id: "3100000000000000001" }));
    const again = await enqueueMention(
      mention({ referenced_json: null, mention_status_id: "3100000000000000001" }),
    );
    assert.equal(again.duplicate, true);
  } finally {
    if (prevMax === undefined) delete process.env.MENTION_AUTHOR_MAX;
    else process.env.MENTION_AUTHOR_MAX = prevMax;
  }
});

test("bot and worker tokens are separate and fail closed", async () => {
  resetMentionQueue();
  const body = JSON.stringify(mention());
  const missing = await requestPage("/api/mention-queue", { method: "POST", body });
  assert.equal(missing.status, 401);
  assert.deepEqual(JSON.parse(missing.body), { ok: false, error: "unauthorized" });
  assert.doesNotMatch(missing.body, /<!doctype html|<html|Just a moment/i);

  const botEnqueue = await requestPage("/api/mention-queue", {
    method: "POST",
    body,
    token: BOT,
  });
  assert.equal(botEnqueue.status, 201);

  const workerEnqueue = await requestPage("/api/mention-queue", {
    method: "POST",
    body: JSON.stringify(
      mention({ referenced_json: null, mention_status_id: "3200000000000000001" }),
    ),
    token: WORKER,
  });
  assert.equal(workerEnqueue.status, 401);

  const botPending = await requestPage("/api/mention-queue/pending", { token: BOT });
  assert.equal(botPending.status, 401);
  const botComplete = await requestPage("/api/mention-queue/complete", {
    method: "POST",
    token: BOT,
    body: JSON.stringify({
      subject_status_id: "2000000000000000002",
      claim_owner: "mention-worker",
      status: "fail_closed",
      error_reason: "cites_floor",
    }),
  });
  assert.equal(botComplete.status, 401);
  const workerSoft = await requestPage("/api/mention-queue/reply", {
    method: "POST",
    token: WORKER,
    body: JSON.stringify({ subject_status_id: "2000000000000000002", kind: "soft" }),
  });
  assert.equal(workerSoft.status, 401);
  const workerPending = await requestPage("/api/mention-queue/pending", { token: WORKER });
  assert.equal(workerPending.status, 200);
  assert.equal(JSON.parse(workerPending.body).rows.length, 1);
  const botWork = await requestPage("/api/mention-queue/work", { token: BOT });
  assert.equal(botWork.status, 401);
  const workerWork = await requestPage("/api/mention-queue/work", { token: WORKER });
  assert.equal(workerWork.status, 200);
  const probe = await requestPage("/api/mention-queue/preflight", {
    method: "POST",
    token: BOT,
    body: JSON.stringify({ probe: true }),
  });
  assert.equal(probe.status, 200);
  assert.deepEqual(JSON.parse(probe.body), { ok: true, probe: true });
  const workerProbe = await requestPage("/api/mention-queue/preflight", {
    method: "POST",
    token: WORKER,
    body: "{}",
  });
  assert.equal(workerProbe.status, 401);
  const pendingAfterProbe = await requestPage("/api/mention-queue/pending", { token: WORKER });
  assert.equal(JSON.parse(pendingAfterProbe.body).rows.length, 1);
  const workBody = JSON.parse(workerWork.body);
  assert.equal(workBody.pending.length, 1);
  assert.ok(Array.isArray(workBody.unreplied));

  const savedBot = process.env.MENTION_QUEUE_BOT_TOKEN;
  process.env.MENTION_QUEUE_BOT_TOKEN = WORKER;
  try {
    assert.equal(readMentionTokens().misconfigured, true);
    const closed = await requestPage("/api/mention-queue/pending", { token: WORKER });
    assert.equal(closed.status, 401);
  } finally {
    process.env.MENTION_QUEUE_BOT_TOKEN = savedBot;
  }
});

test("complete does not write a person; reply failure is separate from status", async () => {
  resetMentionQueue();
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const before = await countPeople();
  await enqueueMention(mention({ referenced_json: null, mention_status_id: "3300000000000000001" }));
  const claimed = await claimMention({
    subject_status_id: "3300000000000000001",
    claim_owner: "mention-worker",
  });
  assert.equal(claimed.row.status, "processing");
  const done = await completeMention({
    subject_status_id: "3300000000000000001",
    claim_owner: "mention-worker",
    status: "kept",
    kept_person_slug: "quota-mention",
  });
  assert.equal(done.row.status, "kept");
  assert.equal(await countPeople(), before);

  const replay = await completeMention({
    subject_status_id: "3300000000000000001",
    claim_owner: "mention-worker",
    status: "kept",
    kept_person_slug: "quota-mention",
  });
  assert.equal(replay.replayed, true);
});

async function finishMention(subject_status_id, fields, now) {
  await claimMention({ subject_status_id, claim_owner: "mention-worker", now });
  return completeMention({
    subject_status_id,
    claim_owner: "mention-worker",
    now,
    ...fields,
  });
}

test("KEEP final is one plain reply to the first mentioner", async () => {
  resetMentionQueue();
  const seed = loadSeedFile(path.join(ROOT, "data", "seed.json"));
  setMemory({
    ...seed,
    people: [...seed.people, { id: "quota-mention", name: "Quota Mention", category: "arrests" }],
    operations: [
      ...(seed.operations || []),
      {
        id: "restore-justice",
        name: "Restore Justice",
        event_date: "2024-01-02",
        agencies: ["FBI"],
        summary: "A federal operation.",
      },
    ],
    dog_comms: [
      ...(seed.dog_comms || []),
      {
        id: "fbi-k9",
        posted_at: "2024-06-15",
        handle: "@FBI",
        account_name: "FBI",
        text: "Military working dog.",
        source_url: "https://x.com/fbi/status/4000000000000000099",
      },
    ],
    red_folder_comms: [
      ...(seed.red_folder_comms || []),
      {
        id: "reuters-folder",
        posted_at: "2024-06-15",
        handle: "@Reuters",
        account_name: "Reuters",
        text: "Official red folder note.",
        source_url: "https://x.com/Reuters/status/4000000000000000104",
      },
    ],
  });
  const quoted = "2000000000000000099";
  const first = await enqueueMention(
    mention({
      mention_status_id: "3400000000000000003",
      author_id: "1110000000000000001",
      author_handle: "firstauthor",
      quoted_id: quoted,
    }),
    { now: new Date("2026-09-23T22:00:00.000Z") },
  );
  const duplicate = await enqueueMention(
    mention({
      mention_status_id: "3400000000000000009",
      author_id: "2220000000000000002",
      author_handle: "laterauthor",
      quoted_id: quoted,
    }),
    { now: new Date("2026-09-23T22:01:00.000Z") },
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.row.mention_status_id, first.row.mention_status_id);
  assert.equal(duplicate.row.author_id, first.row.author_id);
  await finishMention(quoted, { status: "kept", kept_person_slug: "quota-mention" });

  const posts = [];
  const shots = [];
  const fetchImpl = async (url, opts) => {
    const target = String(url);
    if (target.endsWith("/work")) {
      return jsonResponse(200, { ok: true, pending: [], unreplied: await listUnrepliedMentions() });
    }
    if (target.includes("/reply-plan")) {
      const id = new URL(target).searchParams.get("subject_status_id");
      return jsonResponse(200, await planMentionReply(id));
    }
    if (target.startsWith(`${PUBLIC_ORIGIN}/`)) return glassPage(target);
    const uploaded = mediaUploadResponse(target);
    if (uploaded) return uploaded;
    if (target.includes("/tweets")) {
      posts.push(JSON.parse(opts.body));
      return jsonResponse(201, {});
    }
    if (target.endsWith("/reply")) {
      const body = JSON.parse(opts.body);
      assert.equal(body.kind, "final");
      await stampMentionReply({ subject_status_id: body.subject_status_id, kind: "final" });
      return jsonResponse(200, { ok: true });
    }
    throw new Error(`unexpected ${target}`);
  };
  const env = {
    MENTION_WORKER_DATABASE: "lab",
    MENTION_QUEUE_URL: "https://queue.example",
    MENTION_QUEUE_WORKER_TOKEN: WORKER,
    EXITTRACE_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    X_API_KEY: "k",
    X_API_SECRET: "s",
    X_ACCESS_TOKEN: "t",
    X_ACCESS_TOKEN_SECRET: "ts",
    X_USER_ID: "50",
  };
  const once = await workerOnce({
    env,
    fetchImpl,
    captureImpl: async (pageUrl) => {
      shots.push(pageUrl);
      return SHOT_PNG;
    },
  });
  assert.equal(once.results.length, 1);
  assert.equal(once.results[0].reply_error, "");
  assert.equal(posts.length, 1);
  assert.deepEqual(shots, [`${PUBLIC_ORIGIN}/people/quota-mention`]);
  assert.equal(posts[0].text, "ExitTrace kept Quota Mention.");
  assert.equal(posts[0].text.includes("http"), false);
  assert.equal(/https?:\/\//i.test(posts[0].text), false);
  assert.equal(JSON.stringify(posts[0]).includes("http"), false);
  assert.equal(JSON.stringify(posts[0]).includes("exittrace.example"), false);
  assert.deepEqual(posts[0].media, { media_ids: [MEDIA_ID] });
  assert.equal(posts[0].attachments, undefined);
  assert.equal(posts[0].reply.in_reply_to_tweet_id, first.row.mention_status_id);
  assert.deepEqual(
    posts[0],
    replyBody({ inReplyTo: first.row.mention_status_id, text: posts[0].text, mediaIds: [MEDIA_ID] }),
  );

  const again = await workerOnce({ env, fetchImpl });
  assert.equal(again.results.length, 0);
  assert.equal(posts.length, 1);
  const stamped = await planMentionReply(quoted);
  assert.equal(stamped.reply, false);
  assert.equal(stamped.reason, "first_mentioner");

  const opSubject = "2000000000000000088";
  await enqueueMention(
    mention({
      mention_status_id: "3400000000000000088",
      author_id: "3330000000000000003",
      author_handle: "opauthor",
      quoted_id: opSubject,
    }),
    { now: new Date("2026-09-23T22:02:00.000Z") },
  );
  await finishMention(opSubject, { status: "kept", kept_person_slug: "restore-justice" });
  const opPlan = await planMentionReply(opSubject);
  assert.equal(opPlan.text, "ExitTrace kept Restore Justice.");
  assert.equal(opPlan.detail_path, "/operations/restore-justice");
  assert.equal(opPlan.detail_path.includes("http"), false);
  assert.equal(/https?:\/\//i.test(opPlan.text), false);

  const dogSubject = "2000000000000000089";
  await enqueueMention(
    mention({
      mention_status_id: "3400000000000000089",
      author_id: "3330000000000000004",
      author_handle: "dogauthor",
      quoted_id: dogSubject,
    }),
    { now: new Date("2026-09-23T22:03:00.000Z") },
  );
  await finishMention(dogSubject, { status: "kept", kept_person_slug: "fbi-k9" });
  const dogPlan = await planMentionReply(dogSubject);
  assert.equal(dogPlan.text, "ExitTrace kept FBI.");
  assert.equal(dogPlan.detail_path, "/dog-comms/fbi-k9");
  assert.equal(dogPlan.detail_path.includes("http"), false);
  assert.equal(/https?:\/\//i.test(dogPlan.text), false);
  assert.equal(publicKeepPageUrl(PUBLIC_ORIGIN, dogPlan.detail_path), `${PUBLIC_ORIGIN}/dog-comms/fbi-k9`);

  const folderSubject = "2000000000000000090";
  await enqueueMention(
    mention({
      mention_status_id: "3400000000000000090",
      author_id: "3330000000000000005",
      author_handle: "folderauthor",
      quoted_id: folderSubject,
    }),
    { now: new Date("2026-09-23T22:04:00.000Z") },
  );
  await finishMention(folderSubject, { status: "kept", kept_person_slug: "reuters-folder" });
  const folderPlan = await planMentionReply(folderSubject);
  assert.equal(folderPlan.text, "ExitTrace kept Reuters.");
  assert.equal(folderPlan.detail_path, "/red-folder-comms/reuters-folder");
  assert.equal(/https?:\/\//i.test(folderPlan.text), false);
  assert.equal(
    publicKeepPageUrl(PUBLIC_ORIGIN, folderPlan.detail_path),
    `${PUBLIC_ORIGIN}/red-folder-comms/reuters-folder`,
  );

  const castSubject = "2000000000000000091";
  await enqueueMention(
    mention({
      mention_status_id: "3400000000000000091",
      author_id: "3330000000000000006",
      author_handle: "castauthor",
      quoted_id: castSubject,
    }),
    { now: new Date("2026-09-23T22:05:00.000Z") },
  );
  await finishMention(castSubject, { status: "kept", kept_person_slug: "james-comey" });
  const castPlan = await planMentionReply(castSubject);
  assert.equal(castPlan.text, "ExitTrace kept James Comey.");
  assert.equal(castPlan.detail_path, "/people/james-comey");
  assert.equal(castPlan.detail_path, keepDetailPath("james-comey", "corona_comms"));
  assert.equal(castPlan.detail_path, keepDetailPath("james-comey", "central_casting_comms"));
  assert.equal(/https?:\/\//i.test(castPlan.text), false);
  assert.equal(keepReplyText("", "plain-slug"), "ExitTrace kept plain slug.");
  assert.equal(keepReplyText("https://example.com/people/plain-slug", "plain-slug"), "ExitTrace kept plain slug.");
  assert.equal(publicKeepPageUrl(PUBLIC_ORIGIN, "/people/quota-mention"), `${PUBLIC_ORIGIN}/people/quota-mention`);
  assert.equal(publicKeepPageUrl("http://exittrace.example", "/people/quota-mention"), "");
  assert.equal(publicKeepPageUrl("https://localhost", "/people/quota-mention"), "");
  assert.equal(publicKeepPageUrl("https://127.0.0.1", "/people/quota-mention"), "");
  assert.equal(publicKeepPageUrl("https://exittrace.example:5220", "/people/quota-mention"), "");
  assert.equal(publicKeepPageUrl("https://lab-auth.example", "/people/quota-mention"), "");
  assert.equal(publicKeepPageUrl("https://admin.example", "/people/quota-mention"), "");
  assert.equal(publicKeepPageUrl("file:///tmp/keep.html", "/people/quota-mention"), "");
  assert.equal(publicKeepPageUrl("https://user:secret@exittrace.example", "/people/quota-mention"), "");
  await assert.rejects(
    () =>
      capturePublicKeepPage({
        origin: "https://127.0.0.1:5220",
        detailPath: "/people/quota-mention",
        fetchImpl: async () => {
          throw new Error("private page was fetched");
        },
        captureImpl: async () => SHOT_PNG,
      }),
    (err) => err.code === "public_page_required",
  );
});

test("fail_closed and ambiguous digs send no reply", async () => {
  resetMentionQueue();
  const cases = [
    ["3400000000000000001", "fail_closed", "cites_floor"],
    ["3400000000000000002", "fail_closed", "ambiguous_subject"],
    ["3400000000000000005", "fail_closed", "dig_failed"],
    ["3400000000000000006", "rejected", "rejected"],
  ];
  for (const [id, status, error_reason] of cases) {
    await enqueueMention(mention({ referenced_json: null, mention_status_id: id }));
    await stampMentionReply({ subject_status_id: id, kind: "soft" });
    await finishMention(id, { status, error_reason });
    const plan = await planMentionReply(id);
    assert.equal(plan.reply, false, id);
    assert.equal(plan.text, "");
    assert.equal(plan.reason, "no_reply");
  }
  assert.deepEqual(await listUnrepliedMentions(), []);
  const keptPlan = buildReplyPlan(
    { status: "kept", kept_person_slug: "quota-mention" },
    { displayName: "Quota Mention" },
  );
  assert.equal(keptPlan.text, "ExitTrace kept Quota Mention.");
  assert.equal(keptPlan.detail_path, "/people/quota-mention");
  assert.equal(keptPlan.text.includes("http"), false);
  assert.equal(buildReplyPlan({ status: "fail_closed", error_reason: "ambiguous_subject", reply_soft_at: "t" }).reply, false);
});

test("a later mentioner of the same subject and a shared KEEP slug stay silent", async () => {
  resetMentionQueue();
  const quoted = "2000000000000000070";
  const first = await enqueueMention(
    mention({
      mention_status_id: "3400000000000000071",
      author_id: "1110000000000000001",
      author_handle: "firstauthor",
      quoted_id: quoted,
    }),
    { now: new Date("2026-09-23T22:00:00.000Z") },
  );
  const secondMention = await enqueueMention(
    mention({
      mention_status_id: "3400000000000000079",
      author_id: "2220000000000000002",
      author_handle: "secondauthor",
      quoted_id: quoted,
    }),
    { now: new Date("2026-09-23T22:01:00.000Z") },
  );
  assert.equal(secondMention.duplicate, true);
  assert.equal(secondMention.row.subject_status_id, first.row.subject_status_id);
  await finishMention(quoted, { status: "kept", kept_person_slug: "quota-mention" });

  const otherSubject = "2000000000000000072";
  await enqueueMention(
    mention({
      mention_status_id: "3400000000000000072",
      author_id: "3330000000000000003",
      author_handle: "othersubject",
      quoted_id: otherSubject,
    }),
    { now: new Date("2026-09-23T22:05:00.000Z") },
  );
  await finishMention(otherSubject, { status: "kept", kept_person_slug: "quota-mention" });

  const winner = await planMentionReply(quoted);
  const later = await planMentionReply(otherSubject);
  assert.equal(winner.reply, true);
  assert.equal(winner.row.mention_status_id, first.row.mention_status_id);
  assert.equal(later.reply, false);
  assert.equal(later.reason, "first_mentioner");
  assert.equal(later.text, "");
  const unreplied = await listUnrepliedMentions();
  assert.deepEqual(unreplied.map((row) => row.subject_status_id), [quoted]);

  await stampMentionReply({ subject_status_id: quoted, kind: "final" });
  const after = await planMentionReply(otherSubject);
  assert.equal(after.reply, false);
  assert.deepEqual(await listUnrepliedMentions(), []);
});

test("cadence clamps sit in the locked bands", () => {
  assert.equal(pollIntervalMs(1000), POLL_MIN_MS);
  assert.equal(pollIntervalMs(60 * 60 * 1000), POLL_MAX_MS);
  assert.equal(pollIntervalMs(10 * 60 * 1000), 10 * 60 * 1000);
  assert.equal(claimLeaseMs(1000), LEASE_MIN_MS);
  assert.equal(claimLeaseMs(20 * 60 * 1000), LEASE_MAX_MS);
  assert.equal(claimLeaseMs(12 * 60 * 1000), 12 * 60 * 1000);
});

test("mention_queue is excluded from publication and gap-upsert", () => {
  const phrase = "excluded from exittrace_lab_pub / publication SQL / NEW_KIND_RENDER_SYNC checklist";
  const migration = fs.readFileSync(path.join(ROOT, "scripts", "mention-queue.sql"), "utf8");
  const bootstrap = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "app", "server.mjs"), "utf8");
  const doc = fs.readFileSync(path.join(ROOT, "docs", "NEW_KIND_RENDER_SYNC.md"), "utf8");
  assert.match(migration, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(migration, /subject_status_id TEXT PRIMARY KEY/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS mention_queue_subject_status_id_uidx/);
  assert.match(bootstrap, /mention_queue is excluded from exittrace_lab_pub/);
  assert.match(doc, /mention_queue` is excluded from exittrace_lab_pub/);
  assert.match(PLACE_STEPS, /mention_queue is Render-only and is excluded from exittrace_lab_pub/);
  assert.match(server, /mention-queue\.sql/);
  assert.doesNotMatch(executableSql(migration), /exittrace_lab_pub/i);
  assert.doesNotMatch(executableSql(migration), /ADD TABLE/i);
  assert.doesNotMatch(executableSql(bootstrap), /CREATE TABLE IF NOT EXISTS mention_queue/);
  for (const name of fs.readdirSync(path.join(ROOT, "scripts"))) {
    if (!name.endsWith(".sql")) continue;
    const sql = executableSql(fs.readFileSync(path.join(ROOT, "scripts", name), "utf8"));
    assert.doesNotMatch(sql, /ADD TABLE\s+mention_queue/i, name);
    assert.doesNotMatch(sql, /exittrace_lab_pub[\s\S]{0,80}mention_queue/i, name);
  }
  assert.deepEqual([...RENDER_ONLY_TABLES], ["mention_queue"]);
  for (const table of RENDER_ONLY_TABLES) {
    assert.equal(PUBLISHED_TABLES.includes(table), false);
    assert.equal(ALL_UPSERT_TABLES.includes(table), false);
  }
  const dropped = normalizePayload({ mention_queue: [{ subject_status_id: "1" }], people: [] });
  assert.equal("mention_queue" in dropped, false);
  assert.throws(() => buildUpsertSql("mention_queue", [{ subject_status_id: "1" }]), /unknown/);
});

test("x mention lead never carries cites and dig fail-closes without two official cites", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const before = await countPeople();
  const row = {
    subject_status_id: "2000000000000000002",
    mention_status_id: "1000000000000000001",
    subject_url: "https://x.com/i/web/status/2000000000000000002",
    mention_url: "https://x.com/reader/status/1000000000000000001",
  };
  await assert.rejects(
    () => leadIngest({ subject: "Quota Mention", cite_urls: CITES, ...row }),
    (err) => err.code === "mention_not_cite",
  );
  const closed = await digMention(row, { subject: "Quota Mention", outcome: "fail_closed" });
  assert.equal(closed.status, "fail_closed");
  assert.equal(closed.error_reason, "cites_floor");
  assert.equal(await countPeople(), before);
  const lead = await getAddRequest(closed.lead_id);
  assert.equal(lead.source, "x_mention");
  assert.deepEqual(lead.cite_urls, []);
  assert.equal(lead.subject_status_id, row.subject_status_id);

  const stripped = await digMention(row, {
    subject: "Quota Mention Two",
    outcome: "kept",
    cite_urls: [row.mention_url, row.subject_url, CITES[0]],
    ...NEW_PERSON_LOCK,
    category: "arrests",
    event_date: "2024-06-15",
  });
  assert.equal(stripped.status, "fail_closed");
  assert.equal(stripped.error_reason, "cites_floor");
  assert.equal(await countPeople(), before);
});

test("dig keeps through the existing promote path and does not cite the mention", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const before = await countPeople();
  const row = {
    subject_status_id: "2000000000000000088",
    mention_status_id: "1000000000000000088",
    subject_url: "https://x.com/i/web/status/2000000000000000088",
    mention_url: "https://x.com/reader/status/1000000000000000088",
  };
  const kept = await digMention(row, {
    outcome: "kept",
    subject: "Quota Mention",
    category: "arrests",
    event_date: "2024-06-15",
    cite_urls: [row.mention_url, ...CITES],
    ...NEW_PERSON_LOCK,
  });
  assert.equal(kept.status, "kept");
  assert.equal(kept.kept_person_slug, "quota-mention");
  assert.equal(await countPeople(), before + 1);
  const person = kept.person;
  const blob = JSON.stringify(person.sources);
  assert.equal(blob.includes("2000000000000000088"), false);
  assert.equal(blob.includes("1000000000000000088"), false);
  const lead = await getAddRequest(kept.lead_id);
  assert.equal(lead.source, "x_mention");
  assert.equal(JSON.stringify(lead.cite_urls).includes("/status/"), false);
  const pending = (await listAddRequests({ status: "pending" })).filter((item) => item.source === "x_mention");
  assert.equal(pending.length, 0);
});

test("oauth1 signs the published status example", () => {
  const signed = oauth1Authorization({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json",
    params: {
      include_entities: "true",
      status: "Hello Ladies + Gentlemen, a signed OAuth request!",
    },
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    timestamp: "1318622958",
  });
  assert.equal(signed.signature, "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
});

test("poller posts the quoted subject and soft-acks with the fixed line", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-"));
  const statePath = path.join(dir, "since.json");
  const calls = [];
  const env = {
    X_API_KEY: "k",
    X_API_SECRET: "s",
    X_ACCESS_TOKEN: "t",
    X_ACCESS_TOKEN_SECRET: "ts",
    X_USER_ID: "50",
    MENTION_QUEUE_URL: "https://queue.example",
    MENTION_QUEUE_BOT_TOKEN: BOT,
    MENTION_SOFT_ACK: "1",
  };
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body, headers: opts.headers });
    if (String(url).endsWith("/api/mention-queue/preflight")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ ok: true, probe: true }); } };
    }
    if (String(url).includes("/mentions")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            data: [
              {
                id: "1000000000000000001",
                author_id: "7",
                text: "quoted lead",
                referenced_tweets: [{ type: "quoted", id: "2000000000000000002" }],
              },
            ],
            includes: { users: [{ id: "7", username: "reader" }] },
          });
        },
      };
    }
    if (String(url).endsWith("/api/mention-queue")) {
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            ok: true,
            created: true,
            row: { subject_status_id: "2000000000000000002", reply_soft_at: null },
          });
        },
      };
    }
    if (String(url).includes("/tweets")) {
      return { ok: true, status: 201, async text() { return "{}"; } };
    }
    if (String(url).endsWith("/reply")) {
      return { ok: true, status: 200, async text() { return "{\"ok\":true}"; } };
    }
    throw new Error(`unexpected ${url}`);
  };
  const result = await pollOnce({ env, fetchImpl, statePath });
  assert.equal(result.since_id, "1000000000000000001");
  const enqueue = calls.find((call) => call.url.endsWith("/api/mention-queue"));
  const posted = JSON.parse(enqueue.body);
  assert.equal(posted.subject_status_id, "2000000000000000002");
  assert.equal(posted.mention_status_id, "1000000000000000001");
  const reply = calls.find((call) => String(call.url).includes("/tweets"));
  assert.equal(JSON.parse(reply.body).text, SOFT_ACK_TEXT);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, "1000000000000000001");
});

test("worker reply failure does not send a second complete", async () => {
  const calls = [];
  const row = {
    subject_status_id: "3500000000000000001",
    mention_status_id: "3500000000000000002",
    subject_url: "https://x.com/i/web/status/3500000000000000001",
    mention_url: "https://x.com/reader/status/3500000000000000002",
    status: "pending",
    text: "lead",
  };
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, body: opts.body });
    const target = String(url);
    if (target.endsWith("/work")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, pending: [row], unreplied: [] });
        },
      };
    }
    if (target.endsWith("/claim")) {
      const body = JSON.parse(opts.body);
      assert.equal(body.subject_status_id, "");
      if (calls.filter((call) => String(call.url).endsWith("/claim")).length > 1) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ ok: true, claimed: false, row: null });
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, claimed: true, row: { ...row, status: "processing" } });
        },
      };
    }
    if (target.endsWith("/complete")) {
      const body = JSON.parse(opts.body);
      assert.deepEqual(Object.keys(body).sort(), [...COMPLETE_BODY_KEYS].sort());
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            row: { ...row, status: "fail_closed", error_reason: "cites_floor", reply_soft_at: "2026-01-01T00:00:00.000Z" },
          });
        },
      };
    }
    if (target.includes("/reply-plan")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, reply: true, text: "ExitTrace kept Quota Mention.", reason: "kept" });
        },
      };
    }
    if (target.includes("/tweets")) {
      return { ok: false, status: 500, async text() { return ""; } };
    }
    throw new Error(`unexpected ${target}`);
  };
  const result = await workerOnce({
    env: {
      MENTION_WORKER_DATABASE: "lab",
      MENTION_QUEUE_URL: "https://queue.example",
      MENTION_QUEUE_WORKER_TOKEN: WORKER,
      MENTION_DIG_COMMAND: "true",
      X_API_KEY: "k",
      X_API_SECRET: "s",
      X_ACCESS_TOKEN: "t",
      X_ACCESS_TOKEN_SECRET: "ts",
      X_USER_ID: "50",
    },
    fetchImpl,
    digImpl: async () => ({ outcome: "fail_closed", error_reason: "cites_floor" }),
  });
  assert.equal(result.results[0].status, "fail_closed");
  assert.equal(result.results[0].reply_error, "reply_failed");
  assert.equal(calls.filter((call) => call.url.endsWith("/complete")).length, 1);
  assert.equal(scrubDigEnv({ MENTION_QUEUE_BOT_TOKEN: "x", OK: "1" }).MENTION_QUEUE_BOT_TOKEN, undefined);
  assert.equal(parseDigEnvelope('{"outcome":"fail_closed"}').outcome, "fail_closed");
});

test("mention scripts do not publish the queue or require Actions for dig", () => {
  const poll = fs.readFileSync(path.join(ROOT, "app/lib/x-mention-poll.mjs"), "utf8");
  const worker = fs.readFileSync(path.join(ROOT, "app/lib/x-mention-worker.mjs"), "utf8");
  const doc = fs.readFileSync(path.join(ROOT, "docs/X_MENTION_QUEUE.md"), "utf8");
  assert.equal(poll.includes("store.mjs"), false);
  assert.equal(poll.includes("queueAddRequest"), false);
  assert.match(worker, /digMention/);
  assert.match(worker, /does not change queue status|does not roll back|reply failure/i);
  assert.match(doc, /MENTION_QUEUE_BOT_TOKEN/);
  assert.match(doc, /MENTION_QUEUE_WORKER_TOKEN/);
  assert.match(doc, /X_API_KEY/);
  assert.match(doc, /Worf before merge/);
  assert.match(doc, /excluded from `exittrace_lab_pub`/);
  assert.match(doc, /GitHub Actions does not run the dig/);
});

test("help and unit install do not print secrets", async () => {
  const poll = await runNode("scripts/x-mention-poll.mjs", ["--help"]);
  assert.equal(poll.code, 0);
  assert.match(poll.stdout, /MENTION_QUEUE_BOT_TOKEN/);
  assert.doesNotMatch(poll.stdout, new RegExp(BOT));
  const worker = await runNode("scripts/x-mention-worker.mjs", ["--help"]);
  assert.equal(worker.code, 0);
  assert.match(worker.stdout, /MENTION_WORKER_DATABASE/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-units-"));
  const filled = await runNode("scripts/install-mention-units.mjs", ["--out", dir], {
    MENTION_INSTALL_PREFIX: dir,
  });
  assert.equal(filled.code, 0);
  const unit = fs.readFileSync(path.join(dir, "exittrace-mention-poll.service"), "utf8");
  assert.match(unit, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(unit.includes("__INSTALL_PREFIX__"), false);
});

const X_ENV = {
  X_API_KEY: "k",
  X_API_SECRET: "s",
  X_ACCESS_TOKEN: "t",
  X_ACCESS_TOKEN_SECRET: "ts",
  X_USER_ID: "50",
  MENTION_QUEUE_URL: "https://queue.example",
  MENTION_QUEUE_BOT_TOKEN: BOT,
  MENTION_POLL_MS: "",
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "" },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function mentionPayload(rows) {
  return {
    data: rows,
    includes: { users: [{ id: "7", username: "reader", name: "Reader" }] },
  };
}

test("soft-ack failure still advances since_id and continues the poll", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-ack-"));
  const statePath = path.join(dir, "since.json");
  fs.writeFileSync(statePath, `${JSON.stringify({ since_id: "1000000000000000000" })}\n`);
  const calls = [];
  let tweets = 0;
  const env = { ...X_ENV, MENTION_SOFT_ACK: "1" };
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body });
    const target = String(url);
    if (target.endsWith("/api/mention-queue/preflight")) return jsonResponse(200, { ok: true, probe: true });
    if (target.includes("/mentions")) {
      return jsonResponse(200, mentionPayload([
        {
          id: "1000000000000000002",
          author_id: "7",
          text: "newer",
          referenced_tweets: [{ type: "quoted", id: "2000000000000000004" }],
        },
        {
          id: "1000000000000000001",
          author_id: "7",
          text: "older",
          referenced_tweets: [{ type: "quoted", id: "2000000000000000003" }],
        },
      ]));
    }
    if (target.endsWith("/api/mention-queue")) {
      const posted = JSON.parse(opts.body);
      return jsonResponse(201, {
        ok: true,
        created: true,
        duplicate: false,
        row: { subject_status_id: posted.subject_status_id, reply_soft_at: null },
      });
    }
    if (target.includes("/tweets")) {
      tweets += 1;
      if (tweets === 1) return jsonResponse(500, {});
      return jsonResponse(201, {});
    }
    if (target.endsWith("/reply")) return jsonResponse(200, { ok: true });
    throw new Error(`unexpected ${target}`);
  };
  const result = await pollOnce({ env, fetchImpl, statePath });
  assert.equal(result.since_id, "1000000000000000002");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].reply_error, "reply_failed");
  assert.equal(result.results[0].mention_status_id, "1000000000000000001");
  assert.equal(result.results[1].reply_error, "");
  assert.equal(calls.filter((call) => call.url.endsWith("/api/mention-queue")).length, 2);
  assert.equal(calls.filter((call) => call.url.includes("/mentions")).length, 1);
  const mentionUrl = calls.find((call) => call.url.includes("/mentions")).url;
  assert.match(mentionUrl, /since_id=/);
  assert.match(mentionUrl, /max_results=10/);
  assert.equal(calls.some((call) => /\/users\/\d+$/.test(String(call.url).split("?")[0])), false);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, "1000000000000000002");
  assert.equal(result.poll_ms, 10 * 60 * 1000);
});

test("soft-ack is skipped for duplicates and when the flag is off", async () => {
  assert.equal(shouldSoftAck({}, { created: true, duplicate: false }), false);
  assert.equal(shouldSoftAck({ MENTION_SOFT_ACK: "1" }, { created: false, duplicate: true }), false);
  assert.equal(
    shouldSoftAck({ MENTION_SOFT_ACK: "1" }, { created: true, duplicate: false, row: { reply_soft_at: null } }),
    true,
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-dup-"));
  const statePath = path.join(dir, "since.json");
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(String(url));
    const target = String(url);
    if (target.endsWith("/api/mention-queue/preflight")) return jsonResponse(200, { ok: true, probe: true });
    if (target.includes("/mentions")) {
      return jsonResponse(200, mentionPayload([
        { id: "1000000000000000011", author_id: "7", text: "again" },
      ]));
    }
    if (target.endsWith("/api/mention-queue")) {
      return jsonResponse(200, {
        ok: true,
        created: false,
        duplicate: true,
        row: { subject_status_id: "1000000000000000011", reply_soft_at: null },
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  const result = await pollOnce({
    env: { ...X_ENV, MENTION_SOFT_ACK: "1" },
    fetchImpl,
    statePath,
  });
  assert.equal(result.results[0].duplicate, true);
  assert.equal(result.results[0].reply_error, "");
  assert.equal(result.since_id, "1000000000000000011");
  assert.equal(calls.some((url) => url.includes("/tweets")), false);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, "1000000000000000011");
});

test("429 backs off in-process and does not shrink the poll interval", async () => {
  assert.equal(xBackoffMs(429, "2", 1), 2000);
  assert.equal(xBackoffMs(402, "", 1), 1000);
  assert.equal(xBackoffMs(500, "2", 1), 0);
  assert.ok(xBackoffMs(429, "99999", 1) <= 60 * 1000);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-backoff-"));
  const statePath = path.join(dir, "since.json");
  fs.writeFileSync(statePath, `${JSON.stringify({ since_id: "1000000000000000090" })}\n`);
  const sleeps = [];
  const mentionUrls = [];
  let hits = 0;
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/mention-queue/preflight")) return jsonResponse(200, { ok: true, probe: true });
    if (target.includes("/mentions")) {
      hits += 1;
      mentionUrls.push(target);
      if (hits === 1) {
        return { ok: false, status: 429, headers: { get: () => "1" }, async text() { return ""; } };
      }
      if (hits === 2) {
        return { ok: false, status: 429, headers: { get: () => "" }, async text() { return ""; } };
      }
      return { ok: false, status: 429, headers: { get: () => "1" }, async text() { return ""; } };
    }
    throw new Error(`unexpected ${target}`);
  };
  const result = await pollOnce({
    env: X_ENV,
    fetchImpl,
    statePath,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(result.backoff, 429);
  assert.equal(result.results.length, 0);
  assert.equal(result.since_id, "1000000000000000090");
  assert.equal(result.poll_ms, 10 * 60 * 1000);
  assert.equal(hits, 1);
  assert.deepEqual(sleeps, [1000]);
  assert.match(mentionUrls[0], /max_results=10/);
  assert.equal(mentionUrls.every((url) => url.includes("since_id=1000000000000000090")), true);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, "1000000000000000090");
  assert.match(pollJournal(result), /^mention_poll backoff=429 /);
  assert.equal(pollJournal({ since_id: "1000000000000000090", results: [] }), "");
});

function htmlChallenge() {
  return {
    ok: false,
    status: 403,
    headers: {
      get(name) {
        const key = String(name || "").toLowerCase();
        if (key === "content-type") return "text/html; charset=UTF-8";
        if (key === "cf-mitigated") return "challenge";
        return "";
      },
    },
    async text() {
      return "<!DOCTYPE html><html><title>Just a moment...</title><body>Cloudflare</body></html>";
    },
  };
}

test("queue preflight failure skips the X mentions GET", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-preflight-"));
  const statePath = path.join(dir, "since.json");
  const since = "1000000000000000091";
  fs.writeFileSync(statePath, `${JSON.stringify({ since_id: since })}\n`);
  let mentions = 0;
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/mention-queue/preflight")) {
      throw new Error("connect ECONNREFUSED");
    }
    if (target.includes("/mentions")) {
      mentions += 1;
      return jsonResponse(200, mentionPayload([]));
    }
    throw new Error(`unexpected ${target}`);
  };
  const sleeps = [];
  const result = await pollOnce({
    env: X_ENV,
    fetchImpl,
    statePath,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(mentions, 0);
  assert.equal(result.preflight, "down");
  assert.equal(result.backoff, "down");
  assert.equal(result.since_id, since);
  assert.equal(result.results.length, 0);
  assert.equal(result.poll_ms, 10 * 60 * 1000);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(queueBackoffMs(0, "", 1), 1000);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, since);
  assert.match(pollJournal(result), new RegExp(`^mention_poll backoff=down since=${since}$`));
});

test("401 on the queue is fail-closed and does not advance since_id", async () => {
  const since = "1000000000000000092";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-401-"));
  const statePath = path.join(dir, "since.json");
  fs.writeFileSync(statePath, `${JSON.stringify({ since_id: since })}\n`);
  let mentions = 0;
  const sleeps = [];
  const preflightDenied = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/mention-queue/preflight")) {
      return jsonResponse(401, { ok: false, error: "unauthorized" });
    }
    if (target.includes("/mentions")) {
      mentions += 1;
      return jsonResponse(200, mentionPayload([{ id: "1000000000000000093", author_id: "7", text: "lead" }]));
    }
    throw new Error(`unexpected ${target}`);
  };
  const denied = await pollOnce({
    env: X_ENV,
    fetchImpl: preflightDenied,
    statePath,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(mentions, 0);
  assert.equal(denied.fail_closed, 401);
  assert.equal(denied.since_id, since);
  assert.equal(denied.backoff, undefined);
  assert.deepEqual(sleeps, []);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, since);
  assert.match(pollJournal(denied), /fail_closed=401/);
  assert.doesNotMatch(pollJournal(denied), /results=/);

  const htmlDir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-401-html-"));
  const htmlState = path.join(htmlDir, "since.json");
  fs.writeFileSync(htmlState, `${JSON.stringify({ since_id: since })}\n`);
  const htmlSleeps = [];
  let htmlMentions = 0;
  const htmlDenied = await pollOnce({
    env: X_ENV,
    statePath: htmlState,
    sleepImpl: async (ms) => {
      htmlSleeps.push(ms);
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith("/api/mention-queue/preflight")) {
        return {
          ok: false,
          status: 401,
          headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "text/html" : "") },
          async text() {
            return "<!DOCTYPE html><html><title>Just a moment...</title></html>";
          },
        };
      }
      if (target.includes("/mentions")) {
        htmlMentions += 1;
        return jsonResponse(200, mentionPayload([]));
      }
      throw new Error(`unexpected ${target}`);
    },
  });
  assert.equal(htmlMentions, 0);
  assert.equal(htmlDenied.fail_closed, undefined);
  assert.equal(htmlDenied.backoff, 401);
  assert.equal(htmlDenied.since_id, since);
  assert.deepEqual(htmlSleeps, [1000]);
  assert.equal(JSON.parse(fs.readFileSync(htmlState, "utf8")).since_id, since);

  const enqueueDir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-401-enqueue-"));
  const enqueueState = path.join(enqueueDir, "since.json");
  fs.writeFileSync(enqueueState, `${JSON.stringify({ since_id: since })}\n`);
  const calls = [];
  const enqueueDenied = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith("/api/mention-queue/preflight")) return jsonResponse(200, { ok: true, probe: true });
    if (target.includes("/mentions")) {
      return jsonResponse(200, mentionPayload([{ id: "1000000000000000093", author_id: "7", text: "lead" }]));
    }
    if (target.endsWith("/api/mention-queue")) return jsonResponse(401, { ok: false, error: "unauthorized" });
    throw new Error(`unexpected ${target}`);
  };
  const queued = await pollOnce({ env: X_ENV, fetchImpl: enqueueDenied, statePath: enqueueState });
  assert.equal(queued.fail_closed, 401);
  assert.equal(queued.since_id, since);
  assert.equal(queued.results[0].error, "unauthorized");
  assert.equal(JSON.parse(fs.readFileSync(enqueueState, "utf8")).since_id, since);
  assert.equal(calls.some((url) => url.includes("/mentions")), true);
  assert.equal(calls.some((url) => url.includes("/tweets")), false);
  assert.ok(calls.findIndex((url) => url.endsWith("/preflight")) < calls.findIndex((url) => url.includes("/mentions")));
});

test("403 challenge and 5xx back off without advancing since_id", async () => {
  assert.equal(queueBackoffMs(401, "2", 1), 0);
  assert.equal(queueBackoffMs(403, "", 1), 1000);
  assert.equal(queueBackoffMs(500, "2", 1), 2000);
  assert.ok(queueBackoffMs(503, "99999", 1) <= 60 * 1000);
  assert.equal(isCfChallenge(htmlChallenge()), true);
  assert.equal(
    isCfChallenge({ status: 403, text: "<html>Just a moment...</html>", body: {} }),
    true,
  );
  assert.equal(
    isCfChallenge({ status: 403, body: { ok: false, error: "blocked" }, text: "{\"ok\":false,\"error\":\"blocked\"}" }),
    false,
  );
  assert.equal(
    classifyQueueHttp({ status: 403, ok: false, body: { ok: false, error: "blocked" }, text: "{\"ok\":false,\"error\":\"blocked\"}" }),
    "stop",
  );
  assert.equal(classifyQueueHttp(htmlChallenge()), "backoff");
  assert.equal(classifyQueueHttp({ status: 500, ok: false, body: { ok: false, error: "error" }, text: "{}" }), "backoff");
  assert.equal(classifyQueueHttp({ status: 401, ok: false, body: { ok: false, error: "unauthorized" }, text: "{\"ok\":false,\"error\":\"unauthorized\"}" }), "fail_closed");
  assert.equal(
    classifyQueueHttp({ status: 401, ok: false, body: {}, text: "<html>Just a moment...</html>" }),
    "backoff",
  );

  const since = "1000000000000000094";
  const challengeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-cf-"));
  const challengeState = path.join(challengeDir, "since.json");
  fs.writeFileSync(challengeState, `${JSON.stringify({ since_id: since })}\n`);
  const challengeSleeps = [];
  let challengeMentions = 0;
  const challenge = await pollOnce({
    env: X_ENV,
    statePath: challengeState,
    sleepImpl: async (ms) => {
      challengeSleeps.push(ms);
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith("/api/mention-queue/preflight")) return htmlChallenge();
      if (target.includes("/mentions")) {
        challengeMentions += 1;
        return jsonResponse(200, mentionPayload([]));
      }
      throw new Error(`unexpected ${target}`);
    },
  });
  assert.equal(challengeMentions, 0);
  assert.equal(challenge.backoff, 403);
  assert.equal(challenge.since_id, since);
  assert.deepEqual(challengeSleeps, [1000]);
  assert.equal(challenge.poll_ms, 10 * 60 * 1000);
  assert.equal(JSON.parse(fs.readFileSync(challengeState, "utf8")).since_id, since);
  assert.match(pollJournal(challenge), /^mention_poll backoff=403 /);

  const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-5xx-"));
  const serverState = path.join(serverDir, "since.json");
  fs.writeFileSync(serverState, `${JSON.stringify({ since_id: since })}\n`);
  const serverSleeps = [];
  let enqueues = 0;
  const server = await pollOnce({
    env: X_ENV,
    statePath: serverState,
    sleepImpl: async (ms) => {
      serverSleeps.push(ms);
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith("/api/mention-queue/preflight")) return jsonResponse(200, { ok: true, probe: true });
      if (target.includes("/mentions")) {
        return jsonResponse(200, mentionPayload([
          { id: "1000000000000000095", author_id: "7", text: "one" },
          { id: "1000000000000000096", author_id: "7", text: "two" },
        ]));
      }
      if (target.endsWith("/api/mention-queue")) {
        enqueues += 1;
        return {
          ok: false,
          status: 503,
          headers: { get: (name) => (String(name).toLowerCase() === "retry-after" ? "2" : "") },
          async text() {
            return JSON.stringify({ ok: false, error: "error" });
          },
        };
      }
      throw new Error(`unexpected ${target}`);
    },
  });
  assert.equal(enqueues, 1);
  assert.equal(server.backoff, 503);
  assert.equal(server.since_id, since);
  assert.deepEqual(serverSleeps, [2000]);
  assert.equal(server.results[0].error, "error");
  assert.equal(JSON.parse(fs.readFileSync(serverState, "utf8")).since_id, since);
  assert.equal(isEnqueueAck({ ok: true }), false);

  const partialDir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-partial-"));
  const partialState = path.join(partialDir, "since.json");
  const partialSince = "1000000000000000080";
  fs.writeFileSync(partialState, `${JSON.stringify({ since_id: partialSince })}\n`);
  const enqueuedIds = [];
  const partial = await pollOnce({
    env: X_ENV,
    statePath: partialState,
    sleepImpl: async () => {},
    fetchImpl: async (url, opts) => {
      const target = String(url);
      if (target.endsWith("/api/mention-queue/preflight")) return jsonResponse(200, { ok: true, probe: true });
      if (target.includes("/mentions")) {
        return jsonResponse(200, mentionPayload([
          { id: "1000000000000000082", author_id: "7", text: "newer" },
          { id: "1000000000000000081", author_id: "7", text: "older" },
        ]));
      }
      if (target.endsWith("/api/mention-queue")) {
        const posted = JSON.parse(opts.body);
        enqueuedIds.push(posted.mention_status_id);
        if (posted.mention_status_id === "1000000000000000081") {
          return jsonResponse(201, {
            ok: true,
            created: true,
            duplicate: false,
            row: { subject_status_id: posted.subject_status_id, reply_soft_at: null },
          });
        }
        return jsonResponse(503, { ok: false, error: "error" });
      }
      throw new Error(`unexpected ${target}`);
    },
  });
  assert.deepEqual(enqueuedIds, ["1000000000000000081", "1000000000000000082"]);
  assert.equal(partial.since_id, "1000000000000000081");
  assert.equal(partial.backoff, 503);
  assert.notEqual(partial.since_id, "1000000000000000082");
  assert.equal(JSON.parse(fs.readFileSync(partialState, "utf8")).since_id, "1000000000000000081");
  assert.equal(partial.results.filter((row) => row.error).length, 1);
  assert.equal(partial.results.filter((row) => !row.error).length, 1);
});

test("since_id advances only after an ok enqueue ack", async () => {
  const since = "1000000000000000097";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-poll-ack-only-"));
  const statePath = path.join(dir, "since.json");
  fs.writeFileSync(statePath, `${JSON.stringify({ since_id: since })}\n`);
  let mode = "bare";
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith("/api/mention-queue/preflight")) return jsonResponse(200, { ok: true, probe: true });
    if (target.includes("/mentions")) {
      return jsonResponse(200, mentionPayload([
        { id: "1000000000000000098", author_id: "7", text: "lead" },
      ]));
    }
    if (target.endsWith("/api/mention-queue")) {
      const posted = JSON.parse(opts.body);
      assert.equal(posted.mention_status_id, "1000000000000000098");
      if (mode === "bare") return jsonResponse(200, { ok: true });
      if (mode === "created") {
        return jsonResponse(201, {
          ok: true,
          created: true,
          duplicate: false,
          row: { subject_status_id: posted.subject_status_id, reply_soft_at: null },
        });
      }
      return jsonResponse(200, {
        ok: true,
        created: false,
        duplicate: true,
        row: { subject_status_id: posted.subject_status_id, reply_soft_at: null },
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  const bare = await pollOnce({ env: X_ENV, fetchImpl, statePath });
  assert.equal(bare.since_id, since);
  assert.equal(bare.results[0].error, "enqueue_failed");
  assert.equal(bare.fail_closed, undefined);
  assert.equal(bare.backoff, undefined);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, since);
  assert.equal(calls.filter((url) => url.includes("/mentions")).length, 1);
  assert.equal(calls.some((url) => url.includes("/tweets")), false);

  mode = "created";
  const created = await pollOnce({ env: X_ENV, fetchImpl, statePath });
  assert.equal(created.since_id, "1000000000000000098");
  assert.equal(created.results[0].error, undefined);
  assert.equal(created.results[0].reply_error, "");
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).since_id, "1000000000000000098");
  assert.equal(calls.filter((url) => url.includes("/tweets")).length, 0);

  mode = "duplicate";
  const duplicate = await pollOnce({ env: X_ENV, fetchImpl, statePath });
  assert.equal(duplicate.since_id, "1000000000000000098");
  assert.equal(duplicate.results[0].duplicate, true);
  assert.equal(duplicate.results[0].reply_error, "");
  const perf = fs.readFileSync(path.join(ROOT, "docs/X_MENTION_PERF.md"), "utf8");
  const queueDoc = fs.readFileSync(path.join(ROOT, "docs/X_MENTION_QUEUE.md"), "utf8");
  assert.match(perf, /Ops checklist/);
  assert.match(perf, /\/api\/mention-queue/);
  assert.match(perf, /Soft-ack stays OFF/);
  assert.match(perf, /preflight/i);
  assert.match(queueDoc, /since_id/);
  assert.match(queueDoc, /created: true/);
  assert.match(queueDoc, /duplicate: true/);
  assert.match(queueDoc, /## Ops checklist/);
  assert.match(queueDoc, /CF Skip on `\/api\/mention-queue`/);
  assert.match(queueDoc, /MENTION_QUEUE_BOT_TOKEN` ≠ `MENTION_QUEUE_WORKER_TOKEN/);
  assert.match(queueDoc, /Soft-ack is `0`/);
  assert.match(queueDoc, /MENTION_STATE_PATH` is a durable host file/);
  assert.match(queueDoc, /x-mention-dig-warm\.mjs/);
  assert.match(queueDoc, /401 is JSON/);
});

test("empty mention queue skips dig, claim, and reply", async () => {
  const urls = [];
  let digs = 0;
  const fetchImpl = async (url) => {
    const target = String(url);
    urls.push(target);
    if (target.endsWith("/work")) {
      return jsonResponse(200, { ok: true, pending: [], unreplied: [] });
    }
    throw new Error(`unexpected ${target}`);
  };
  const result = await workerOnce({
    env: {
      MENTION_WORKER_DATABASE: "lab",
      MENTION_QUEUE_URL: "https://queue.example",
      MENTION_QUEUE_WORKER_TOKEN: WORKER,
    },
    fetchImpl,
    digImpl: async () => {
      digs += 1;
      return { outcome: "fail_closed", error_reason: "missing_subject" };
    },
  });
  assert.equal(result.results.length, 0);
  assert.equal(digs, 0);
  assert.equal(urls.filter((url) => url.endsWith("/work")).length, 1);
  assert.equal(urls.some((url) => url.endsWith("/claim")), false);
  assert.equal(urls.some((url) => url.includes("/reply")), false);
  assert.equal(urls.some((url) => url.includes("/tweets")), false);
  assert.equal(workerJournal(result), "");
});

test("worker claim-next stops at five and a failed reply does not stop the batch", async () => {
  assert.equal(CLAIMS_PER_TICK, 5);
  let claims = 0;
  let digs = 0;
  let active = 0;
  let maxActive = 0;
  let tweets = 0;
  const fetchImpl = async (url, opts) => {
    const target = String(url);
    if (target.endsWith("/work")) {
      return jsonResponse(200, {
        ok: true,
        pending: [{ subject_status_id: "pending-gate" }],
        unreplied: [
          {
            subject_status_id: "7100000000000000001",
            mention_status_id: "7100000000000000002",
            status: "kept",
          },
          {
            subject_status_id: "7100000000000000003",
            mention_status_id: "7100000000000000004",
            status: "fail_closed",
          },
        ],
      });
    }
    if (target.includes("/reply-plan")) {
      return jsonResponse(200, {
        ok: true,
        reply: true,
        text: "ExitTrace kept Quota Mention.",
        reason: "kept",
        detail_path: "/people/quota-mention",
      });
    }
    if (target.startsWith(`${PUBLIC_ORIGIN}/`)) return glassPage(target);
    const uploaded = mediaUploadResponse(target);
    if (uploaded) return uploaded;
    if (target.includes("/tweets")) {
      tweets += 1;
      return jsonResponse(500, {});
    }
    if (target.endsWith("/reply")) return jsonResponse(200, { ok: true });
    if (target.endsWith("/claim")) {
      const body = JSON.parse(opts.body);
      assert.equal(body.subject_status_id, "");
      claims += 1;
      const n = String(claims);
      return jsonResponse(200, {
        ok: true,
        claimed: true,
        row: {
          subject_status_id: `720000000000000000${n}`,
          mention_status_id: `730000000000000000${n}`,
          status: "processing",
          text: "lead",
        },
      });
    }
    if (target.endsWith("/complete")) {
      return jsonResponse(200, {
        ok: true,
        row: { status: "fail_closed", error_reason: "missing_subject", reply_soft_at: null },
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  const result = await workerOnce({
    env: {
      MENTION_WORKER_DATABASE: "lab",
      MENTION_QUEUE_URL: "https://queue.example",
      MENTION_QUEUE_WORKER_TOKEN: WORKER,
      MENTION_DIG_COMMAND: "true",
      EXITTRACE_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
      ...X_ENV,
    },
    fetchImpl,
    captureImpl: async () => SHOT_PNG,
    digImpl: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      active -= 1;
      digs += 1;
      return { outcome: "fail_closed", error_reason: "missing_subject" };
    },
  });
  assert.equal(claims, CLAIMS_PER_TICK);
  assert.equal(digs, CLAIMS_PER_TICK);
  assert.equal(maxActive, 1);
  assert.equal(result.results.filter((row) => row.swept).length, 2);
  assert.equal(result.results.filter((row) => row.swept && row.reply_error === "reply_failed").length, 2);
  assert.equal(result.results.filter((row) => !row.swept).length, CLAIMS_PER_TICK);
  assert.equal(result.results.filter((row) => !row.swept && row.reply_error === "reply_failed").length, CLAIMS_PER_TICK);
  assert.ok(tweets >= 2);
});

test("quiet journal path and staggered 10 minute timers", () => {
  assert.equal(pollJournal({ since_id: "1", results: [] }), "");
  assert.equal(workerJournal({ results: [] }), "");
  assert.match(pollJournal({ since_id: "1", results: [{}] }), /results=1/);
  assert.match(workerJournal({ results: [{}] }), /results=1/);
  const pollScript = fs.readFileSync(path.join(ROOT, "scripts/x-mention-poll.mjs"), "utf8");
  const workerScript = fs.readFileSync(path.join(ROOT, "scripts/x-mention-worker.mjs"), "utf8");
  assert.match(pollScript, /pollJournal/);
  assert.match(workerScript, /workerJournal/);
  assert.match(pollScript, /if \(line\) console\.log\(line\)/);
  assert.match(workerScript, /if \(line\) console\.log\(line\)/);
  const pollTimer = fs.readFileSync(path.join(ROOT, "ops/systemd/exittrace-mention-poll.timer"), "utf8");
  const workerTimer = fs.readFileSync(path.join(ROOT, "ops/systemd/exittrace-mention-worker.timer"), "utf8");
  assert.match(pollTimer, /OnBootSec=5min/);
  assert.match(pollTimer, /OnUnitActiveSec=10min/);
  assert.match(workerTimer, /OnBootSec=8min/);
  assert.match(workerTimer, /OnUnitActiveSec=10min/);
  assert.match(workerTimer, /3 minutes/);
  const stamp = fs.readFileSync(path.join(ROOT, "docs/X_MENTION_PERF.md"), "utf8");
  assert.match(stamp, /exittrace_lab_pub/);
  assert.match(stamp, /at most 5 claims/);
  assert.match(stamp, /OnUnitActiveSec=10min/);
  const queueDoc = fs.readFileSync(path.join(ROOT, "docs/X_MENTION_QUEUE.md"), "utf8");
  const queueSql = fs.readFileSync(path.join(ROOT, "app/lib/mention-queue.mjs"), "utf8");
  assert.match(queueDoc, /Worf before merge/);
  assert.match(queueDoc, /Hub runbook note/);
  assert.match(queueDoc, /created: true/);
  assert.match(queueDoc, /x-mention-dig-warm\.mjs/);
  assert.match(queueSql, /FOR UPDATE SKIP LOCKED/);
  assert.equal(DIG_TIMEOUT_MS, 9 * 60 * 1000);
  assert.ok(DIG_TIMEOUT_MS < LEASE_MIN_MS);
  assert.equal(POLL_MIN_MS, 5 * 60 * 1000);
  assert.match(pollJournal({ since_id: "1", results: [{ error: "enqueue_failed" }] }), /errors=1/);
  assert.match(workerJournal({ results: [{ reply_error: "reply_failed" }] }), /errors=1/);
});

test("zero pending skips claim and dig; an unreplied row still gets a reply sweep", async () => {
  const urls = [];
  let digs = 0;
  const fetchImpl = async (url) => {
    const target = String(url);
    urls.push(target);
    if (target.endsWith("/work")) {
      return jsonResponse(200, {
        ok: true,
        pending: [],
        unreplied: [
          {
            subject_status_id: "7400000000000000001",
            mention_status_id: "7400000000000000002",
            status: "kept",
          },
        ],
      });
    }
    if (target.includes("/reply-plan")) {
      return jsonResponse(200, { ok: true, reply: false, reason: "kept" });
    }
    throw new Error(`unexpected ${target}`);
  };
  const result = await workerOnce({
    env: {
      MENTION_WORKER_DATABASE: "lab",
      MENTION_QUEUE_URL: "https://queue.example",
      MENTION_QUEUE_WORKER_TOKEN: WORKER,
    },
    fetchImpl,
    digImpl: async () => {
      digs += 1;
      return { outcome: "fail_closed", error_reason: "missing_subject" };
    },
  });
  assert.equal(digs, 0);
  assert.equal(urls.some((url) => url.endsWith("/claim")), false);
  assert.equal(urls.some((url) => url.includes("/reply-plan")), true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].swept, true);
  assert.equal(result.results[0].reply_error, "");
});

test("warm helper stays idle until a row is sent and digs one at a time", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-warm-"));
  const socketPath = path.join(dir, "dig.sock");
  const log = path.join(dir, "log");
  const inner = path.join(dir, "inner.mjs");
  fs.writeFileSync(
    inner,
    `import fs from "fs";
const log = ${JSON.stringify(log)};
fs.appendFileSync(log, "start\\n");
setTimeout(() => {
  fs.appendFileSync(log, "end\\n");
  process.stdout.write(JSON.stringify({ outcome: "fail_closed", error_reason: "missing_subject" }));
  process.exit(0);
}, 40);
`,
  );
  const command = `${process.execPath} ${inner}`;
  const helper = await serveWarmDig({ socketPath, command, timeoutMs: 5000 });
  assert.equal(helper.started, 0);
  assert.equal(fs.existsSync(log), false);
  const [first, second] = await Promise.all([
    callWarmDig({ socketPath, row: { subject_status_id: "1" } }),
    callWarmDig({ socketPath, row: { subject_status_id: "2" } }),
  ]);
  assert.equal(first.error_reason, "missing_subject");
  assert.equal(second.error_reason, "missing_subject");
  assert.equal(helper.started, 2);
  assert.equal(fs.readFileSync(log, "utf8"), "start\nend\nstart\nend\n");
  await helper.close();
});

function runNode(script, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, script), ...args], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: "", ...env },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
