import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { digMention } from "../app/lib/mention-dig.mjs";
import { enqueueMention, resetMentionQueue } from "../app/lib/mention-queue.mjs";
import {
  kindDetail,
  operationDetail,
  personDetail,
  RequestAttribution,
  requestAttributionHtml,
} from "../app/lib/html.mjs";
import {
  attributionTargetFromKeep,
  listRequestAttributions,
  recordRequestAttribution,
  recordXMentionKeepAttribution,
} from "../app/lib/request-attributions.mjs";
import { buildUpsertSql, PUBLISHED_TABLES, RENDER_ONLY_TABLES } from "../app/lib/gap-upsert.mjs";
import { getMemory, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { fetchMentions } from "../app/lib/x-client.mjs";
import { mentionsFromApiPayload } from "../app/lib/x-mentions.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/attribution-keep-held",
  "https://www.example.net/world/attribution-keep-arrest",
];

function attribution(over = {}) {
  return {
    target_kind: "person",
    target_id: "attribution-keep",
    channel: "x_mention",
    submitter_display_name: "Ada Lovelace",
    submitter_handle: "ada",
    submitter_author_id: "424242",
    submitted_at: "2026-09-23T15:30:00.000Z",
    subject_status_id: "2100000000000000001",
    mention_status_id: "1100000000000000001",
    mention_url: "https://x.com/ada/status/1100000000000000001",
    ...over,
  };
}

function personRow() {
  return {
    id: "attribution-keep",
    name: "Attribution Keep",
    category: "arrests",
    event_date: "2024-06-15",
    sources: [],
    events: [
      {
        kind: "arrests",
        event_date: "2024-06-15",
        sources: [{ url: CITES[0], publisher: "Example" }],
      },
    ],
  };
}

test("poller and enqueue store the mention author display name", async () => {
  const mapped = mentionsFromApiPayload({
    data: [
      {
        id: "1100000000000000001",
        author_id: "7",
        text: "see this",
        referenced_tweets: [{ type: "quoted", id: "2100000000000000001" }],
      },
    ],
    includes: { users: [{ id: "7", username: "ada", name: "Ada Lovelace" }] },
  });
  assert.equal(mapped[0].author_display_name, "Ada Lovelace");
  assert.equal(mapped[0].author_handle, "ada");

  let seen = "";
  await fetchMentions({
    env: {
      X_API_KEY: "k",
      X_API_SECRET: "s",
      X_ACCESS_TOKEN: "t",
      X_ACCESS_TOKEN_SECRET: "ts",
      X_USER_ID: "50",
    },
    fetchImpl: async (url) => {
      seen = String(url);
      return { ok: true, status: 200, async text() { return "{}"; } };
    },
  });
  assert.match(seen, /user\.fields=username(?:%2C|,)name/);

  resetMentionQueue();
  const first = await enqueueMention({
    mention_status_id: "1100000000000000001",
    author_id: "424242",
    author_handle: "ada",
    author_display_name: "Ada Lovelace",
    text: "look",
    mention_url: "https://x.com/ada/status/1100000000000000001",
    referenced_json: [{ type: "quoted", id: "2100000000000000001" }],
    subject_url: "https://x.com/i/web/status/2100000000000000001",
  });
  assert.equal(first.created, true);
  assert.equal(first.row.author_display_name, "Ada Lovelace");

  const again = await enqueueMention({
    mention_status_id: "1100000000000000099",
    author_id: "424242",
    author_handle: "ada",
    author_display_name: "Second Name",
    text: "again",
    mention_url: "https://x.com/ada/status/1100000000000000099",
    referenced_json: [{ type: "quoted", id: "2100000000000000001" }],
    subject_url: "https://x.com/i/web/status/2100000000000000001",
  });
  assert.equal(again.duplicate, true);
  assert.equal(again.row.author_display_name, "Ada Lovelace");
});

test("KEEP writes one attribution and a duplicate subject does not", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const row = {
    subject_status_id: "2100000000000000088",
    mention_status_id: "1100000000000000088",
    subject_url: "https://x.com/i/web/status/2100000000000000088",
    mention_url: "https://x.com/ada/status/1100000000000000088",
    author_id: "424242",
    author_handle: "ada",
    author_display_name: "Ada Lovelace",
    created_at: "2026-09-23T15:30:00.000Z",
  };
  const closed = await digMention(
    { ...row, subject_status_id: "2100000000000000077", mention_status_id: "1100000000000000077" },
    { subject: "Attribution Closed", outcome: "fail_closed" },
  );
  assert.equal(closed.status, "fail_closed");
  assert.equal(getMemory().request_attributions?.length || 0, 0);

  const kept = await digMention(row, {
    outcome: "kept",
    subject: "Attribution Keep",
    category: "arrests",
    event_date: "2024-06-15",
    cite_urls: [row.mention_url, ...CITES],
    ...NEW_PERSON_LOCK,
  });
  assert.equal(kept.status, "kept");
  const slug = kept.kept_person_slug;
  const lines = await listRequestAttributions({ target_kind: "person", target_id: slug });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].channel, "x_mention");
  assert.equal(lines[0].submitter_display_name, "Ada Lovelace");
  assert.equal(lines[0].submitter_handle, "ada");
  assert.equal(lines[0].submitter_author_id, "424242");
  assert.equal(lines[0].subject_status_id, row.subject_status_id);
  assert.equal(lines[0].mention_status_id, row.mention_status_id);
  assert.equal(lines[0].mention_url, row.mention_url);
  assert.equal(lines[0].submitted_at, "2026-09-23T15:30:00.000Z");
  assert.match(lines[0].id, /^ra-[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(kept.person.sources).includes(row.mention_status_id), false);
  assert.equal(JSON.stringify(kept.person.sources).includes("x.com/ada/status"), false);

  const replay = await recordXMentionKeepAttribution(
    { ...row, author_display_name: "Second Name", author_handle: "other" },
    { person: { id: slug } },
  );
  assert.equal(replay.created, false);
  assert.equal(replay.row.submitter_display_name, "Ada Lovelace");
  assert.equal(replay.row.id, lines[0].id);
  assert.equal(
    (await listRequestAttributions({ target_kind: "person", target_id: slug })).length,
    1,
  );
});

test("same target keeps multiple subjects oldest first", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const newer = await recordRequestAttribution(
    attribution({
      subject_status_id: "2100000000000000003",
      mention_status_id: "1100000000000000003",
      submitted_at: "2026-09-23T15:30:00.000Z",
      submitter_display_name: "Newer Submitter",
      submitter_handle: "newer",
      mention_url: "https://x.com/newer/status/1100000000000000003",
    }),
  );
  const older = await recordRequestAttribution(
    attribution({
      subject_status_id: "2100000000000000002",
      mention_status_id: "1100000000000000002",
      submitted_at: "2026-09-23T03:30:00.000Z",
      submitter_display_name: "Older Submitter",
      submitter_handle: "older",
      mention_url: "https://x.com/older/status/1100000000000000002",
    }),
  );
  assert.equal(newer.created, true);
  assert.equal(older.created, true);
  const lines = await listRequestAttributions({
    target_kind: "person",
    target_id: "attribution-keep",
  });
  assert.deepEqual(
    lines.map((row) => row.submitter_handle),
    ["older", "newer"],
  );
  const html = personDetail(personRow(), { attributions: lines });
  const titleAt = html.indexOf("detail-title");
  const olderAt = html.indexOf("Requested via X by Older Submitter @older · Sep 22, 2026 ET");
  const newerAt = html.indexOf("Requested via X by Newer Submitter @newer · Sep 23, 2026 ET");
  const citeAt = html.indexOf("cite-list");
  assert.ok(titleAt >= 0 && titleAt < olderAt && olderAt < newerAt && newerAt < citeAt);
  assert.equal(html.includes("1100000000000000002"), false);
  assert.equal(html.includes("x.com/older/status"), false);
  assert.equal((html.match(/class="meta-line request-attribution"/g) || []).length, 2);
});

test("detail pages hide the attribution line when none are stored", () => {
  const person = personDetail(personRow());
  assert.equal(person.includes("request-attribution"), false);
  assert.equal(person.includes("Requested via X"), false);
  assert.equal(requestAttributionHtml([]), "");
  assert.equal(RequestAttribution(undefined), "");

  const operation = operationDetail({
    id: "op-1",
    name: "Operation Quiet",
    event_date: "2024-08-01",
    agencies: ["Example"],
    summary: "Noted.",
    tags: ["missing_kids"],
    sources: [{ url: CITES[0] }],
  });
  assert.equal(operation.includes("Requested via X"), false);
  const operationShown = operationDetail(
    {
      id: "op-1",
      name: "Operation Quiet",
      event_date: "2024-08-01",
      agencies: ["Example"],
      summary: "Noted.",
      tags: ["missing_kids"],
      sources: [{ url: CITES[0] }],
    },
    {
      attributions: [
        attribution({
          target_kind: "operation",
          target_id: "op-1",
        }),
      ],
    },
  );
  const opTitle = operationShown.indexOf("detail-title");
  const opLine = operationShown.indexOf(
    "Requested via X by Ada Lovelace @ada · Sep 23, 2026 ET",
  );
  const opCite = operationShown.indexOf("cite-list");
  assert.ok(opTitle >= 0 && opTitle < opLine && opLine < opCite);
  assert.equal(operationShown.includes("x.com/ada/status"), false);

  const dog = kindDetail("dog", {
    id: "dog-1",
    handle: "desk",
    account_name: "Desk",
    text: "hello",
    posted_at: "2024-06-15",
    source_url: "https://x.com/desk/status/1",
  });
  assert.equal(dog.includes("Requested via X"), false);

  const shown = kindDetail(
    "red_folder",
    {
      id: "rf-1",
      handle: "desk",
      account_name: "Desk",
      text: "note",
      posted_at: "2024-06-15",
      source_url: "https://www.example.com/news/folder",
    },
    {
      attributions: [
        attribution({
          target_kind: "red_folder_comm",
          target_id: "rf-1",
        }),
      ],
    },
  );
  const headAt = shown.indexOf("cite-head");
  const lineAt = shown.indexOf("Requested via X by Ada Lovelace @ada · Sep 23, 2026 ET");
  const sourceAt = shown.indexOf("Source ·");
  assert.ok(headAt >= 0 && headAt < lineAt && lineAt < sourceAt);
  assert.equal(shown.includes("1100000000000000001"), false);
});

test("Central Casting and Corona stay on the person unless a comms row was kept", () => {
  const personLine = attribution({
    target_kind: "person",
    target_id: "casey-vale",
    submitter_display_name: "Ada Lovelace",
    submitter_handle: "ada",
  });
  const commLine = attribution({
    target_kind: "central_casting_comm",
    target_id: "clip-9",
    subject_status_id: "2100000000000000009",
    mention_status_id: "1100000000000000009",
    submitter_display_name: "Clip Submitter",
    submitter_handle: "clip",
    submitted_at: "2026-09-22T15:30:00.000Z",
  });
  const corona = personDetail(
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "corona_comms",
      event_date: "2024-07-20",
      sources: [],
      events: [
        {
          kind: "corona_comms",
          event_date: "2024-07-20",
          sources: [{ url: CITES[0], publisher: "Example" }],
        },
      ],
    },
    { attributions: [personLine, commLine] },
  );
  assert.match(corona, /Requested via X by Ada Lovelace @ada · Sep 23, 2026 ET/);
  assert.equal(corona.includes("Clip Submitter"), false);
  const casting = personDetail(
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "firings",
      event_date: "2017-05-09",
      central_casting: [CITES[0]],
      sources: [],
      events: [],
    },
    { attributions: [commLine] },
  );
  assert.equal(casting.includes("Requested via X"), false);
  assert.deepEqual(attributionTargetFromKeep({ person: { id: "casey-vale", category: "corona_comms" } }), {
    target_kind: "person",
    target_id: "casey-vale",
  });
  assert.deepEqual(
    attributionTargetFromKeep({
      person: { id: "casey-vale" },
      central_casting: { id: "clip-9" },
    }),
    { target_kind: "central_casting_comm", target_id: "clip-9" },
  );
});

test("request_attributions is published and mention_queue stays render-only", () => {
  assert.equal(PUBLISHED_TABLES.includes("request_attributions"), true);
  assert.equal(RENDER_ONLY_TABLES.includes("mention_queue"), true);
  assert.equal(PUBLISHED_TABLES.includes("mention_queue"), false);

  const planned = buildUpsertSql("request_attributions", [
    { ...attribution(), id: "ra-0123456789abcdef" },
  ]);
  assert.match(planned.sql, /INSERT INTO request_attributions/);
  assert.match(planned.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.doesNotMatch(planned.sql, /DELETE|TRUNCATE|DROP /);

  const bootstrap = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");
  const pub = fs.readFileSync(
    path.join(ROOT, "scripts", "add-request-attributions-publication.sql"),
    "utf8",
  );
  const queue = fs.readFileSync(path.join(ROOT, "scripts", "mention-queue.sql"), "utf8");
  const sync = fs.readFileSync(path.join(ROOT, "docs", "NEW_KIND_RENDER_SYNC.md"), "utf8");
  const mentionDoc = fs.readFileSync(path.join(ROOT, "docs", "X_MENTION_QUEUE.md"), "utf8");
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS request_attributions/);
  assert.match(bootstrap, /id TEXT PRIMARY KEY/);
  assert.match(
    bootstrap,
    /CREATE UNIQUE INDEX IF NOT EXISTS request_attributions_channel_subject_uidx[\s\S]*WHERE subject_status_id IS NOT NULL/,
  );
  assert.match(bootstrap, /request_attributions \(target_kind, target_id, submitted_at\)/);
  assert.doesNotMatch(bootstrap, /PRIMARY KEY \(channel, subject_status_id\)/);
  assert.match(pub, /ALTER PUBLICATION exittrace_lab_pub ADD TABLE request_attributions/);
  assert.match(pub, /copy_data = false/);
  assert.doesNotMatch(pub, /copy_data = true/);
  assert.doesNotMatch(pub, /ADD TABLE mention_queue/);
  assert.match(queue, /author_display_name TEXT DEFAULT ''/);
  assert.match(queue, /ADD COLUMN IF NOT EXISTS author_display_name TEXT DEFAULT ''/);
  assert.match(sync, /ADD TABLE request_attributions/);
  assert.match(sync, /copy_data = false/);
  assert.match(mentionDoc, /author_display_name/);
  assert.match(mentionDoc, /request_attributions/);
  assert.match(mentionDoc, /Requested via X by \{display_name\} @\{handle\}/);
  assert.match(mentionDoc, /empty backfill is OK/i);
  assert.match(sync, /Media-delta does not apply/);
});
