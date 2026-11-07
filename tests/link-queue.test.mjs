import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { addBody, queueBody } from "../app/lib/html.mjs";
import { createRateLimiter } from "../app/lib/rate-limit.mjs";
import { buildUpsertSql, PUBLISHED_TABLES, RENDER_ONLY_TABLES } from "../app/lib/gap-upsert.mjs";
import {
  describeEnqueue,
  enqueuePostLinks,
  linkQueueWritable,
  listLinkQueue,
  parsePostLink,
  removeLinkQueue,
  resetLinkQueueForTests,
} from "../app/lib/link-queue.mjs";
import { setPoolForTests } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("parsePostLink keeps the status and drops the tracking query", () => {
  const x = parsePostLink(
    "https://x.com/gop__ls/status/2118841658510918075?s=46&t=HZNQVyxWQbni_ff3l7tTYw",
  );
  assert.deepEqual(x, {
    platform: "x",
    statusId: "2118841658510918075",
    url: "https://x.com/gop__ls/status/2118841658510918075",
  });
  assert.equal(
    parsePostLink("https://twitter.com/Example/status/2118863959113761145").url,
    "https://x.com/Example/status/2118863959113761145",
  );
  assert.equal(
    parsePostLink("https://www.truthsocial.com/@realDonaldTrump/posts/115544/").url,
    "https://truthsocial.com/@realDonaldTrump/posts/115544",
  );
  assert.equal(
    parsePostLink("https://truthsocial.com/@realDonaldTrump/115544").url,
    "https://truthsocial.com/@realDonaldTrump/posts/115544",
  );
  assert.equal(
    parsePostLink("https://truthsocial.com/users/realDonaldTrump/statuses/115544").statusId,
    "115544",
  );
  assert.equal(parsePostLink("https://x.com/gop__ls"), null);
  assert.equal(parsePostLink("https://example.com/status/2118841658510918075"), null);
  assert.equal(parsePostLink("https://facebook.com/user/status/2118841658510918075"), null);
});

test("memory queue accepts a post once and can remove it", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  setPoolForTests(null);
  resetLinkQueueForTests();
  try {
    const first = await enqueuePostLinks(
      "https://x.com/gop__ls/status/2118841658510918075?s=46\nnot a link\nhttps://x.com/gop__ls/status/2118841658510918075",
    );
    assert.deepEqual(first, {
      queued: 1,
      duplicate: 1,
      rejected: 1,
      limited: false,
      empty: false,
    });
    assert.match(describeEnqueue(first), /Queued 1 post/);
    const rows = await listLinkQueue();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, "https://x.com/gop__ls/status/2118841658510918075");
    assert.equal(await removeLinkQueue(rows[0].id), true);
    assert.equal((await listLinkQueue()).length, 0);
    const again = await enqueuePostLinks("   ");
    assert.equal(again.empty, true);
  } finally {
    resetLinkQueueForTests();
    setPoolForTests(null);
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("queue page lists a post and the add page links to it", () => {
  const html = queueBody({
    rows: [
      {
        id: "4",
        url: "https://x.com/gop__ls/status/2118841658510918075",
        status: "pending",
        reason: "",
        createdAt: "2026-11-06T23:03:12.220Z",
      },
      {
        id: "5",
        url: "https://truthsocial.com/@realDonaldTrump/posts/115544",
        status: "processing",
        reason: "",
        createdAt: "2026-11-06T23:10:00.000Z",
      },
    ],
  });
  assert.match(html, /name="urls"/);
  assert.match(html, /form class="tui-form add-form queue-add"/);
  assert.match(html, /Submit stays available/);
  assert.match(html, /href="\/queue"/);
  assert.match(html, /2118841658510918075/);
  assert.match(html, /Queued/);
  assert.match(html, /Working/);
  assert.match(html, /name="action" value="remove"/);
  assert.equal((html.match(/name="action" value="remove"/g) || []).length, 1);
  assert.match(addBody({ mode: "person" }), /href="\/queue"/);
  assert.match(queueBody(), /The queue is empty/);
  const closed = queueBody({ writable: false });
  assert.doesNotMatch(closed, /name="urls"/);
  assert.match(closed, /does not store the post queue/);
});

test("lab and public both store the post queue", () => {
  const prev = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    assert.equal(linkQueueWritable(), true);
    process.env.DATABASE_URL = "postgres://local@127.0.0.1:5433/exittrace";
    assert.equal(linkQueueWritable(), true);
    process.env.DATABASE_URL = "postgres://local@db.example/exittrace";
    assert.equal(linkQueueWritable(), true);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("consecutive post submits are outside the add rate limit", () => {
  const prevAdd = process.env.ET_RL_ADD;
  const prevGlobal = process.env.ET_RL_GLOBAL;
  process.env.ET_RL_ADD = "5";
  process.env.ET_RL_GLOBAL = "100000";
  try {
    const lim = createRateLimiter();
    const req = { method: "POST", headers: { "cf-connecting-ip": "198.51.100.40" } };
    for (let i = 0; i < 12; i++) {
      assert.equal(lim.check(req, "/queue").allowed, true, `queue ${i + 1}`);
    }
    for (let i = 0; i < 5; i++) {
      assert.equal(lim.check(req, "/add").allowed, true, `add ${i + 1}`);
    }
    assert.equal(lim.check(req, "/add").allowed, false);
    assert.equal(lim.check(req, "/queue").allowed, true);
  } finally {
    if (prevAdd === undefined) delete process.env.ET_RL_ADD;
    else process.env.ET_RL_ADD = prevAdd;
    if (prevGlobal === undefined) delete process.env.ET_RL_GLOBAL;
    else process.env.ET_RL_GLOBAL = prevGlobal;
  }
});

test("public boot creates the post queue table", () => {
  const server = fs.readFileSync(path.join(ROOT, "app", "server.mjs"), "utf8");
  assert.match(server, /scripts", "link-queue.sql"/);
  assert.doesNotMatch(server, /if \(linkQueueWritable\(\)\) \{/);
});

test("link_queue is not a published table", () => {
  assert.equal(PUBLISHED_TABLES.includes("link_queue"), false);
  assert.equal(RENDER_ONLY_TABLES.includes("link_queue"), false);
  assert.throws(() => buildUpsertSql("link_queue", [{ id: "1" }]), /unknown/);
  const pub = fs
    .readdirSync(path.join(ROOT, "scripts"))
    .filter((name) => name.endsWith("-publication.sql"))
    .map((name) => fs.readFileSync(path.join(ROOT, "scripts", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(pub, /link_queue/);
});
