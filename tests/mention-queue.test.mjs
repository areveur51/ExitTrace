import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { handle } from "../app/server.mjs";
import { leadIngest, SOFT_ACK_TEXT, buildReplyPlan, digMention, publicFailText } from "../app/lib/mention-dig.mjs";
import {
  POLL_MAX_MS,
  POLL_MIN_MS,
  LEASE_MAX_MS,
  LEASE_MIN_MS,
  claimLeaseMs,
  claimMention,
  completeMention,
  enqueueMention,
  pollIntervalMs,
  readMentionTokens,
  resetMentionQueue,
  stampMentionReply,
  planMentionReply,
} from "../app/lib/mention-queue.mjs";
import { oauth1Authorization } from "../app/lib/x-oauth.mjs";
import { mentionsFromApiPayload, resolveSubjectStatusId } from "../app/lib/x-mentions.mjs";
import { pollOnce } from "../app/lib/x-mention-poll.mjs";
import { COMPLETE_BODY_KEYS, parseDigEnvelope, scrubDigEnv, workerOnce } from "../app/lib/x-mention-worker.mjs";
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
process.env.EXITTRACE_PUBLIC_ORIGIN = "https://exittrace.example";

const CITES = [
  "https://www.example.com/news/quota-mention-held",
  "https://www.example.net/world/quota-mention-arrest",
];

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

test("one KEEP URL and fail-closed reason only after soft-ack", async () => {
  resetMentionQueue();
  await enqueueMention(mention({ referenced_json: null, mention_status_id: "3400000000000000001" }));
  await stampMentionReply({ subject_status_id: "3400000000000000001", kind: "soft" });
  await claimMention({ subject_status_id: "3400000000000000001", claim_owner: "mention-worker" });
  await completeMention({
    subject_status_id: "3400000000000000001",
    claim_owner: "mention-worker",
    status: "fail_closed",
    error_reason: "cites_floor",
  });
  const reasoned = await planMentionReply("3400000000000000001");
  assert.equal(reasoned.reply, true);
  assert.equal(reasoned.text, publicFailText("cites_floor"));
  assert.equal(reasoned.text.includes("http"), false);

  await enqueueMention(mention({ referenced_json: null, mention_status_id: "3400000000000000002" }));
  await claimMention({ subject_status_id: "3400000000000000002", claim_owner: "mention-worker" });
  await completeMention({
    subject_status_id: "3400000000000000002",
    claim_owner: "mention-worker",
    status: "fail_closed",
    error_reason: "cites_floor",
  });
  const quiet = await planMentionReply("3400000000000000002");
  assert.equal(quiet.reply, false);

  await enqueueMention(mention({ referenced_json: null, mention_status_id: "3400000000000000003" }));
  await claimMention({ subject_status_id: "3400000000000000003", claim_owner: "mention-worker" });
  await completeMention({
    subject_status_id: "3400000000000000003",
    claim_owner: "mention-worker",
    status: "kept",
    kept_person_slug: "quota-mention",
  });
  const firstUrl = await planMentionReply("3400000000000000003");
  assert.equal(firstUrl.text, "https://exittrace.example/people/quota-mention");
  await stampMentionReply({ subject_status_id: "3400000000000000003", kind: "final" });

  await enqueueMention(mention({ referenced_json: null, mention_status_id: "3400000000000000004" }));
  await claimMention({ subject_status_id: "3400000000000000004", claim_owner: "mention-worker" });
  await completeMention({
    subject_status_id: "3400000000000000004",
    claim_owner: "mention-worker",
    status: "kept",
    kept_person_slug: "quota-mention",
  });
  const second = await planMentionReply("3400000000000000004");
  assert.equal(second.reply, false);
  assert.equal(second.reason, "one_url_per_keep");
  assert.equal(buildReplyPlan({ status: "kept", kept_person_slug: "quota-mention" }, { origin: "" }).reply, false);
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
    if (target.endsWith("/unreplied")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ ok: true, rows: [] }); } };
    }
    if (target.endsWith("/pending")) {
      return { ok: true, status: 200, async text() { return JSON.stringify({ ok: true, rows: [row] }); } };
    }
    if (target.endsWith("/claim")) {
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
          return JSON.stringify({ ok: true, reply: true, text: publicFailText("cites_floor"), reason: "fail_closed" });
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
