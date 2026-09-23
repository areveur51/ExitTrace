import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { digMention } from "../app/lib/mention-dig.mjs";
import { countPeople, getAddRequest, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { parseDigEnvelope } from "../app/lib/x-mention-worker.mjs";
import {
  digMentionEnvelope,
  normalizeSyndicationTweet,
  syndicationStatusUrl,
} from "../app/lib/x-mention-dig.mjs";

const PLANT_NODE = "/o" + "pt/" + "Grok" + "Build" + "/tools/node/bin/node";
const PLANT_PREFIX = "/o" + "pt/" + "Grok" + "Build" + "/projects/ExitTrace";
const PLANT_COMMAND = `${PLANT_NODE} ${PLANT_PREFIX}/scripts/x-mention-dig.mjs`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUBJECT = "2000000000000000002";
const MENTION = "1000000000000000001";
const QUOTE = "3000000000000000003";
const FBI = "4000000000000000004";
const REUTERS = "https://www.reuters.com/world/casey-vale-resigns-2024-06-15/";
const JUSTICE = "https://www.justice.gov/opa/pr/casey-vale-2024-06-15";
const REUTERS_CITE = "https://reuters.com/world/casey-vale-resigns-2024-06-15";
const JUSTICE_CITE = "https://justice.gov/opa/pr/casey-vale-2024-06-15";
const TRIB = "https://trib.al/casey";
const WIKI = "https://en.wikipedia.org/wiki/Casey_Vale";
const BLOG = "https://example.com/blog/casey";
const DECOY = "https://www.nytimes.com/2024/06/15/us/not-the-cite.html";

function statusUrl(handle, id) {
  return `https://x.com/${handle}/status/${id}`;
}

function tweet({ id, handle, name, text, urls = [], created_at = "1999-05-05T00:00:00.000Z" }) {
  return {
    __typename: "Tweet",
    id_str: id,
    text,
    created_at,
    user: { screen_name: handle, name: name || handle },
    entities: {
      urls: urls.map((expanded) => ({ url: "https://t.co/short", expanded_url: expanded })),
    },
  };
}

function row(over = {}) {
  return {
    subject_status_id: SUBJECT,
    mention_status_id: MENTION,
    subject_url: statusUrl("someone", SUBJECT),
    mention_url: statusUrl("reader", MENTION),
    author_handle: "reader",
    author_display_name: "Riley Chen",
    text: `see ${DECOY}`,
    subject: "Injected Name",
    referenced_json: [
      { type: "quoted", id: SUBJECT },
      { type: "replied_to", id: FBI },
    ],
    media_json: null,
    ...over,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function redirect(location) {
  return {
    ok: false,
    status: 302,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "location" ? location : "";
      },
    },
    async text() {
      return "";
    },
  };
}

function harness(byId) {
  const calls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("cdn.syndication.twitter.com")) {
      const id = new URL(target).searchParams.get("id");
      if (!byId[id]) return jsonResponse("", 404);
      return jsonResponse(byId[id]);
    }
    if (target === TRIB) return redirect(JUSTICE);
    return jsonResponse("", 404);
  };
  return { calls, fetchImpl };
}

function happyPosts() {
  return {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Riley Chen",
      text: "Casey Vale resigned as Director of the Census Bureau on 2024-06-15.",
      urls: [
        statusUrl("reader", MENTION),
        statusUrl("someone", SUBJECT),
        REUTERS,
        TRIB,
        statusUrl("BarackObama", QUOTE),
        WIKI,
        BLOG,
      ],
    }),
    [QUOTE]: tweet({
      id: QUOTE,
      handle: "BarackObama",
      name: "Barack Obama",
      text: "Family note without another person.",
    }),
    [FBI]: tweet({
      id: FBI,
      handle: "FBI",
      name: "FBI",
      text: "Staff note.",
    }),
  };
}

test("syndication url is public and is not an X credential", () => {
  const url = new URL(syndicationStatusUrl(SUBJECT));
  assert.equal(url.hostname, "cdn.syndication.twitter.com");
  assert.equal(url.searchParams.get("token"), "0");
  assert.equal(url.searchParams.get("id"), SUBJECT);
  const tombstone = normalizeSyndicationTweet({ __typename: "TweetTombstone", id_str: SUBJECT });
  assert.equal(tombstone, null);
  const parsed = normalizeSyndicationTweet(happyPosts()[SUBJECT]);
  assert.equal(parsed.id, SUBJECT);
  assert.equal(parsed.handle, "someone");
  assert.equal(parsed.urls.includes(REUTERS), true);
  assert.equal(parsed.created_at.includes("1999-05-05"), true);
});

test("happy path keeps official chain cites and drops leads", async () => {
  const { calls, fetchImpl } = harness(happyPosts());
  const envelope = await digMentionEnvelope(row(), { fetchImpl });
  const parsed = parseDigEnvelope(JSON.stringify(envelope));
  assert.equal(typeof parsed.subject, "string");
  assert.equal(Array.isArray(parsed.cite_urls), true);
  assert.equal(parsed.outcome, undefined);
  assert.equal(parsed.subject, "Casey Vale");
  assert.equal(parsed.author_display_name, undefined);
  assert.deepEqual(parsed.cite_urls, [
    REUTERS_CITE,
    JUSTICE_CITE,
    statusUrl("barackobama", QUOTE),
    statusUrl("fbi", FBI),
  ]);
  const blob = JSON.stringify(parsed);
  assert.equal(blob.includes(MENTION), false);
  assert.equal(blob.includes(SUBJECT), false);
  assert.equal(blob.includes("wikipedia.org"), false);
  assert.equal(blob.includes("example.com"), false);
  assert.equal(blob.includes("nytimes.com"), false);
  assert.equal(blob.includes("trib.al"), false);
  assert.equal(blob.includes("Injected Name"), false);
  assert.equal(blob.includes("Riley Chen"), false);
  assert.equal(parsed.category, "resignations");
  assert.equal(parsed.event_date, "2024-06-15");
  assert.equal(parsed.event_date === "1999-05-05", false);
  assert.equal(parsed.position, "Director");
  assert.equal(parsed.organization, "Census Bureau");
  assert.equal(parsed.reason, "resigned");
  assert.match(parsed.comments, /Casey Vale resigned/);
  assert.equal(calls.some((url) => url.includes("nytimes.com")), false);
  assert.equal(calls.some((url) => url.includes("wikipedia.org")), false);
  assert.equal(calls.some((url) => url.includes(`/status/${MENTION}`)), false);
  assert.equal(calls.filter((url) => url.includes("id=" + QUOTE)).length, 1);
  assert.equal(calls.filter((url) => url.includes("id=" + FBI)).length, 1);
});

test("fail_closed when the chain has no official cites", async () => {
  const posts = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Riley Chen",
      text: "Casey Vale resigned as Director of the Census Bureau on 2024-06-15.",
      urls: [statusUrl("reader", MENTION), statusUrl("someone", SUBJECT), WIKI, BLOG],
    }),
  };
  const { fetchImpl } = harness(posts);
  const envelope = await digMentionEnvelope(
    row({ referenced_json: [{ type: "quoted", id: SUBJECT }] }),
    { fetchImpl },
  );
  assert.equal(parseDigEnvelope(JSON.stringify(envelope)).outcome, "fail_closed");
  assert.equal(envelope.outcome, "fail_closed");
  assert.equal(envelope.error_reason, "cites_floor");
  assert.equal(envelope.subject, "Casey Vale");
  assert.equal(envelope.cite_urls, undefined);
});

test("subject status and mention url are stripped even when official", async () => {
  const posts = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "Reuters",
      name: "Reuters",
      text: "Casey Vale resigned as Director of the Census Bureau on 2024-06-15.",
      urls: [statusUrl("reuters", SUBJECT), statusUrl("reader", MENTION), REUTERS],
    }),
  };
  const { fetchImpl } = harness(posts);
  const envelope = await digMentionEnvelope(
    row({
      subject_url: statusUrl("reuters", SUBJECT),
      referenced_json: [{ type: "quoted", id: SUBJECT }],
    }),
    { fetchImpl },
  );
  assert.equal(envelope.outcome, "fail_closed");
  assert.equal(envelope.error_reason, "cites_floor");
  assert.equal(JSON.stringify(envelope).includes(SUBJECT), false);
  assert.equal(JSON.stringify(envelope).includes(MENTION), false);
});

test("missing, ambiguous, and unresolved subjects fail closed", async () => {
  const cited = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Riley Chen",
      text: "Links only.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const missing = await digMentionEnvelope(row({ referenced_json: null }), {
    fetchImpl: harness(cited).fetchImpl,
  });
  assert.deepEqual(missing, { outcome: "fail_closed", error_reason: "missing_subject" });

  const both = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Riley Chen",
      text: "Casey Vale and Riley Chen resigned.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const ambiguous = await digMentionEnvelope(row({ referenced_json: null }), {
    fetchImpl: harness(both).fetchImpl,
  });
  assert.deepEqual(ambiguous, { outcome: "fail_closed", error_reason: "ambiguous_subject" });

  const unresolved = await digMentionEnvelope(row(), {
    fetchImpl: harness({}).fetchImpl,
  });
  assert.deepEqual(unresolved, { outcome: "fail_closed", error_reason: "subject_unresolved" });
  assert.deepEqual(await digMentionEnvelope(null), {
    outcome: "fail_closed",
    error_reason: "invalid_row",
  });
});

test("subject_url wins over a different subject_status_id", async () => {
  const fromUrl = "2100000000000000011";
  const fromField = "2200000000000000022";
  const posts = {
    [fromUrl]: tweet({
      id: fromUrl,
      handle: "someone",
      name: "Other",
      text: "Casey Vale resigned as Director of the Census Bureau on 2024-06-15.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const { calls, fetchImpl } = harness(posts);
  const envelope = await digMentionEnvelope(
    row({
      subject_url: `https://x.com/i/web/status/${fromUrl}`,
      subject_status_id: fromField,
      mention_url: statusUrl("reader", MENTION),
      referenced_json: null,
    }),
    { fetchImpl },
  );
  assert.equal(envelope.subject, "Casey Vale");
  assert.deepEqual(envelope.cite_urls, [REUTERS_CITE, JUSTICE_CITE]);
  assert.equal(calls.some((url) => url.includes(fromField)), false);
  assert.equal(calls.some((url) => url.includes(fromUrl)), true);
});

test("private hosts in the chain are not fetched", async () => {
  const loopback = "http://127.0.0.1/secret";
  const posts = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Riley Chen",
      text: "Casey Vale resigned as Director of the Census Bureau on 2024-06-15.",
      urls: [REUTERS, JUSTICE, loopback],
    }),
  };
  const { calls, fetchImpl } = harness(posts);
  const envelope = await digMentionEnvelope(row({ referenced_json: null }), { fetchImpl });
  assert.deepEqual(envelope.cite_urls, [REUTERS_CITE, JUSTICE_CITE]);
  assert.equal(calls.some((url) => url.includes("127.0.0.1")), false);
});

test("posted_at is not copied when the text has no calendar date", async () => {
  const posts = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Riley Chen",
      text: "Casey Vale resigned as Director of the Census Bureau.",
      urls: [REUTERS, JUSTICE],
      created_at: "1999-05-05T12:00:00.000Z",
    }),
  };
  const envelope = await digMentionEnvelope(row({ referenced_json: null }), {
    fetchImpl: harness(posts).fetchImpl,
  });
  assert.equal(envelope.subject, "Casey Vale");
  assert.equal(envelope.event_date, undefined);
  assert.equal(JSON.stringify(envelope).includes("1999-05-05"), false);
});

test("digMention accepts the envelope and still does not cite the mention", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const before = await countPeople();
  const { fetchImpl } = harness(happyPosts());
  const envelope = await digMentionEnvelope(row(), { fetchImpl });
  const dug = await digMention(row(), envelope);
  assert.equal(dug.status, "fail_closed");
  assert.equal(dug.error_reason, "missing_origin_country");
  assert.equal(await countPeople(), before);
  const lead = await getAddRequest(dug.lead_id);
  assert.equal(lead.source, "x_mention");
  assert.deepEqual(lead.cite_urls, []);
  assert.equal(lead.subject, "Casey Vale");
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
});

test("docs plant the absolute dig command and the prefix template", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "X_MENTION_QUEUE.md"), "utf8");
  assert.equal(doc.includes(PLANT_COMMAND), true);
  const template = `${PLANT_NODE} $MENTION_INSTALL_PREFIX/scripts/x-mention-dig.mjs`;
  assert.equal(doc.includes(template), true);
  assert.match(doc, /author_display_name/);
  assert.match(doc, /fail_closed/);
  const wrapper = fs.readFileSync(path.join(ROOT, "scripts", "x-mention-dig.sh"), "utf8");
  assert.match(wrapper, /GROKBUILD_NODE/);
  assert.match(wrapper, /MENTION_INSTALL_PREFIX/);
  assert.match(wrapper, /scripts\/x-mention-dig\.mjs/);
  assert.equal(wrapper.includes(PLANT_NODE), false);
  const cli = fs.readFileSync(path.join(ROOT, "scripts", "x-mention-dig.mjs"), "utf8");
  assert.equal(cli.includes("loadDotEnv"), false);
  assert.equal(cli.includes("queueAddRequest"), false);
  assert.equal(cli.includes("processAddRequest"), false);
  assert.equal(cli.includes("X_API_KEY"), false);
  assert.equal(cli.includes(PLANT_NODE), false);
});

test("cli prints one envelope and exits 0 without secrets", async () => {
  const secret = "dig-secret-should-not-print";
  const help = await runDig(["--help"], "", { X_API_KEY: secret, MENTION_QUEUE_WORKER_TOKEN: secret });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /x-mention-dig\.mjs/);
  assert.equal(help.stdout.includes(secret), false);
  const bad = await runDig([], "{", { X_API_KEY: secret });
  assert.equal(bad.code, 0);
  assert.equal(bad.stderr.includes(secret), false);
  const envelope = parseDigEnvelope(bad.stdout);
  assert.equal(envelope.outcome, "fail_closed");
  assert.equal(envelope.error_reason, "invalid_row");
  assert.equal(bad.stdout.includes(secret), false);
});

function runDig(args, stdin, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "x-mention-dig.mjs"), ...args], {
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
    child.stdin.end(stdin);
  });
}
