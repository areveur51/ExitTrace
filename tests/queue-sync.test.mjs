import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyQueueRows,
  linkQueueWritable,
  listLinkQueue,
  resetLinkQueueForTests,
} from "../app/lib/link-queue.mjs";
import { mergeQueueRows, pickQueueRow } from "../app/lib/queue-sync.mjs";
import { setPoolForTests } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("mergeQueueRows: public pending lands on lab, done wins, held keeps the reason", () => {
  const merged = mergeQueueRows(
    [
      {
        platform: "x",
        statusId: "1",
        url: "https://x.com/a/status/1",
        status: "pending",
        reason: "",
        createdAt: "2026-11-07T12:00:00.000Z",
      },
      {
        platform: "x",
        statusId: "2",
        url: "https://x.com/a/status/2",
        status: "processing",
        reason: "",
        createdAt: "2026-11-07T12:01:00.000Z",
      },
    ],
    [
      {
        platform: "x",
        statusId: "1",
        url: "https://x.com/a/status/1",
        status: "pending",
        reason: "",
        createdAt: "2026-11-07T12:00:00.000Z",
      },
      {
        platform: "x",
        statusId: "3",
        url: "https://x.com/b/status/3",
        status: "pending",
        reason: "",
        createdAt: "2026-11-07T12:02:00.000Z",
      },
      {
        platform: "x",
        statusId: "2",
        url: "https://x.com/a/status/2",
        status: "done",
        reason: "",
        createdAt: "2026-11-07T12:01:00.000Z",
      },
      {
        platform: "truth",
        statusId: "9",
        url: "https://truthsocial.com/@a/posts/9",
        status: "held",
        reason: "Two named people.",
        createdAt: "2026-11-07T12:03:00.000Z",
      },
    ],
  );
  const byId = Object.fromEntries(merged.map((row) => [row.statusId, row]));
  assert.equal(byId["1"].status, "pending");
  assert.equal(byId["2"].status, "done");
  assert.equal(byId["3"].status, "pending");
  assert.equal(byId["9"].status, "held");
  assert.equal(byId["9"].reason, "Two named people.");
});

test("pickQueueRow prefers done over pending", () => {
  const picked = pickQueueRow(
    { platform: "x", statusId: "1", url: "https://x.com/a/status/1", status: "pending" },
    { platform: "x", statusId: "1", url: "https://x.com/a/status/1", status: "done" },
  );
  assert.equal(picked.status, "done");
});

test("memory apply writes remote pending and hides done from the page list", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  setPoolForTests(null);
  resetLinkQueueForTests();
  try {
    await applyQueueRows([
      {
        platform: "x",
        statusId: "2118841658510918075",
        url: "https://x.com/gop__ls/status/2118841658510918075",
        status: "pending",
      },
    ]);
    assert.equal((await listLinkQueue()).length, 1);
    await applyQueueRows([
      {
        platform: "x",
        statusId: "2118841658510918075",
        url: "https://x.com/gop__ls/status/2118841658510918075",
        status: "done",
      },
    ]);
    assert.equal((await listLinkQueue()).length, 0);
    assert.equal((await listLinkQueue({ includeDone: true })).length, 1);
    assert.equal((await listLinkQueue({ includeDone: true }))[0].status, "done");
  } finally {
    resetLinkQueueForTests();
    setPoolForTests(null);
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
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

test("public boot creates the post queue table", () => {
  const server = fs.readFileSync(path.join(ROOT, "app", "server.mjs"), "utf8");
  assert.match(server, /scripts", "link-queue.sql"/);
  assert.doesNotMatch(server, /if \(linkQueueWritable\(\)\) \{/);
});

test("link_queue stays off the catalog publication", () => {
  const sql = fs.readFileSync(path.join(ROOT, "scripts", "link-queue.sql"), "utf8");
  assert.match(sql, /not in/);
  assert.match(sql, /'done'/);
});
