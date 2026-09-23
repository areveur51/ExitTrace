import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { buildReplyPlan, digMention } from "../app/lib/mention-dig.mjs";
import { keepDetailPath } from "../app/lib/keep-page-shot.mjs";
import { CITE_FLOOR } from "../app/lib/promote.mjs";
import { listRequestAttributions } from "../app/lib/request-attributions.mjs";
import { countPeople, getAddRequest, getPerson, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";
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
  assert.equal(parsed.subject_kind, "person");
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
  assert.equal(lead.kind, "person");
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
  assert.match(cli, /MENTION_DIG_INNER one-shot dig/);
  assert.equal(cli.includes("MENTION_DIG_COMMAND"), false);
  assert.match(doc, /Recommended plant value for `MENTION_DIG_INNER`/);
  assert.match(doc, /node scripts\/x-mention-dig-call\.mjs/);
  const call = fs.readFileSync(path.join(ROOT, "scripts", "x-mention-dig-call.mjs"), "utf8");
  assert.match(call, /Use this as MENTION_DIG_COMMAND/);
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

function quiet(plan) {
  assert.equal(plan.reply, false);
  assert.equal(plan.text, "");
  assert.equal(plan.detail_path, "");
  assert.equal(/https?:\/\//i.test(plan.text), false);
}

test("six catalog surfaces KEEP; holiday stays silent", async () => {
  assert.equal(CITE_FLOOR, 2);
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));

  const personEnv = await digMentionEnvelope(row(), { fetchImpl: harness(happyPosts()).fetchImpl });
  assert.equal(personEnv.subject_kind, "person");
  assert.equal(personEnv.subject, "Casey Vale");
  assert.ok(personEnv.cite_urls.length >= CITE_FLOOR);
  const personKept = await digMention(row(), { ...NEW_PERSON_LOCK, ...personEnv });
  assert.equal(personKept.status, "kept");
  assert.equal(personKept.subject_kind, "person");
  assert.equal(personKept.kept_person_slug, "casey-vale");
  const personLead = await getAddRequest(personKept.lead_id);
  assert.equal(personLead.kind, "person");
  assert.ok(personLead.cite_urls.length >= CITE_FLOOR);
  assert.equal(JSON.stringify(personLead.cite_urls).includes(MENTION), false);
  assert.equal(JSON.stringify(personLead.cite_urls).includes(SUBJECT), false);
  const personPlan = buildReplyPlan(
    { status: "kept", kept_person_slug: personKept.kept_person_slug },
    { displayName: personKept.person.name, detailPath: keepDetailPath(personKept.kept_person_slug, "person") },
  );
  assert.equal(personPlan.text, "ExitTrace kept Casey Vale.");
  assert.equal(personPlan.detail_path, "/people/casey-vale");
  assert.equal(personPlan.text.includes("http"), false);
  assert.equal(/https?:\/\//i.test(personPlan.text), false);
  const personAttr = await listRequestAttributions({
    target_kind: "person",
    target_id: personKept.kept_person_slug,
  });
  assert.equal(personAttr.length, 1);
  assert.equal(personAttr[0].channel, "x_mention");

  const opId = "2000000000000000101";
  const opText =
    "Operation Restore Justice is a missing kids operation announced by the Department of Justice on 2024-08-01.";
  const opPosts = {
    [opId]: tweet({
      id: opId,
      handle: "someone",
      name: "Wire",
      text: opText,
      urls: [REUTERS, JUSTICE],
    }),
  };
  const opRow = row({
    subject_status_id: opId,
    subject_url: statusUrl("someone", opId),
    mention_status_id: "1000000000000000101",
    referenced_json: null,
  });
  const opEnv = await digMentionEnvelope(opRow, {
    fetchImpl: harness(opPosts).fetchImpl,
  });
  assert.equal(opEnv.subject_kind, "operation");
  assert.equal(opEnv.subject, "Operation Restore Justice");
  assert.equal(opEnv.category, "missing_kids");
  assert.equal(opEnv.event_date, "2024-08-01");
  assert.ok(opEnv.cite_urls.length >= CITE_FLOOR);
  const opKept = await digMention(opRow, opEnv);
  assert.equal(opKept.status, "kept", opKept.error_reason || "");
  assert.equal(opKept.subject_kind, "operation");
  assert.equal(opKept.kept_person_slug, "operation-restore-justice");
  const opLead = await getAddRequest(opKept.lead_id);
  assert.equal(opLead.kind, "operation");
  assert.ok(opLead.cite_urls.length >= CITE_FLOOR);
  assert.equal(JSON.stringify(opLead.cite_urls).includes(opId), false);
  assert.equal(JSON.stringify(opLead.cite_urls).includes("1000000000000000101"), false);
  const opPlan = buildReplyPlan(
    { status: "kept", kept_person_slug: opKept.kept_person_slug },
    {
      displayName: opKept.operation.name,
      detailPath: keepDetailPath(opKept.kept_person_slug, "operation"),
    },
  );
  assert.equal(opPlan.text, "ExitTrace kept Operation Restore Justice.");
  assert.equal(opPlan.detail_path, "/operations/operation-restore-justice");
  assert.equal(/https?:\/\//i.test(opPlan.text), false);
  const opAttr = await listRequestAttributions({
    target_kind: "operation",
    target_id: opKept.kept_person_slug,
  });
  assert.equal(opAttr.length, 1);

  const dogId = "2000000000000000102";
  const dogPosts = {
    [dogId]: tweet({
      id: dogId,
      handle: "FBI",
      name: "FBI",
      text: "Military working dog honored on 2024-06-15.",
      urls: [],
      created_at: "1999-05-05T00:00:00.000Z",
    }),
  };
  const dogRow = row({
    subject_status_id: dogId,
    subject_url: statusUrl("FBI", dogId),
    mention_status_id: "1000000000000000102",
    referenced_json: null,
  });
  const dogEnv = await digMentionEnvelope(dogRow, { fetchImpl: harness(dogPosts).fetchImpl });
  assert.equal(dogEnv.subject_kind, "dog_comm");
  assert.equal(dogEnv.subject, "FBI");
  assert.equal(dogEnv.cite_urls, undefined);
  assert.equal(dogEnv.posted_at, "2024-06-15");
  assert.equal(dogEnv.posted_at === "1999-05-05", false);
  assert.match(dogEnv.source_url, new RegExp(`/status/${dogId}$`));
  const dogKept = await digMention(dogRow, dogEnv);
  assert.equal(dogKept.status, "kept", dogKept.error_reason || "");
  assert.equal(dogKept.subject_kind, "dog_comm");
  assert.match(dogKept.kept_person_slug, /^fbi-2024-06-15-[a-f0-9]{8}$/);
  const dogLead = await getAddRequest(dogKept.lead_id);
  assert.equal(dogLead.kind, "dog");
  assert.deepEqual(dogLead.cite_urls, []);
  assert.equal(JSON.stringify(dogLead.cite_urls).includes(dogId), false);
  const dogPlan = buildReplyPlan(
    { status: "kept", kept_person_slug: dogKept.kept_person_slug },
    {
      displayName: dogKept.dog.account_name,
      detailPath: keepDetailPath(dogKept.kept_person_slug, "dog_comm"),
    },
  );
  assert.equal(dogPlan.text, "ExitTrace kept FBI.");
  assert.equal(dogPlan.detail_path, `/dog-comms/${dogKept.kept_person_slug}`);
  assert.equal(dogPlan.detail_path.includes("http"), false);
  assert.equal(/https?:\/\//i.test(dogPlan.text), false);
  const dogAttr = await listRequestAttributions({
    target_kind: "dog_comm",
    target_id: dogKept.kept_person_slug,
  });
  assert.equal(dogAttr.length, 1);
  const dogAgain = await digMention(dogRow, dogEnv);
  assert.equal(dogAgain.status, "kept");
  const dogAttrAgain = await listRequestAttributions({
    target_kind: "dog_comm",
    target_id: dogKept.kept_person_slug,
  });
  assert.equal(dogAttrAgain.length, 1);

  const folderId = "2000000000000000104";
  const folderPosts = {
    [folderId]: tweet({
      id: folderId,
      handle: "Reuters",
      name: "Reuters",
      text: "Official red folder note on 2024-06-15.",
      urls: [],
      created_at: "1999-05-05T00:00:00.000Z",
    }),
  };
  const folderRow = row({
    subject_status_id: folderId,
    subject_url: statusUrl("Reuters", folderId),
    mention_status_id: "1000000000000000104",
    referenced_json: null,
  });
  const folderEnv = await digMentionEnvelope(folderRow, { fetchImpl: harness(folderPosts).fetchImpl });
  assert.equal(folderEnv.subject_kind, "red_folder");
  assert.equal(folderEnv.subject, "Reuters");
  assert.equal(folderEnv.cite_urls, undefined);
  assert.equal(folderEnv.posted_at, "2024-06-15");
  const folderKept = await digMention(folderRow, folderEnv);
  assert.equal(folderKept.status, "kept", folderKept.error_reason || "");
  assert.equal(folderKept.subject_kind, "red_folder");
  assert.match(folderKept.kept_person_slug, /^reuters-2024-06-15-[a-f0-9]{8}$/);
  const folderLead = await getAddRequest(folderKept.lead_id);
  assert.equal(folderLead.kind, "red_folder");
  assert.equal(folderLead.category, "red_folder_comms");
  assert.deepEqual(folderLead.cite_urls, []);
  const folderPlan = buildReplyPlan(
    { status: "kept", kept_person_slug: folderKept.kept_person_slug },
    {
      displayName: folderKept.red_folder.account_name,
      detailPath: keepDetailPath(folderKept.kept_person_slug, "red_folder"),
    },
  );
  assert.equal(folderPlan.text, "ExitTrace kept Reuters.");
  assert.equal(folderPlan.detail_path, `/red-folder-comms/${folderKept.kept_person_slug}`);
  assert.equal(/https?:\/\//i.test(folderPlan.text), false);
  const folderAttr = await listRequestAttributions({
    target_kind: "red_folder_comm",
    target_id: folderKept.kept_person_slug,
  });
  assert.equal(folderAttr.length, 1);
  const folderAgain = await digMention(folderRow, folderEnv);
  assert.equal(folderAgain.status, "kept");
  const folderAttrAgain = await listRequestAttributions({
    target_kind: "red_folder_comm",
    target_id: folderKept.kept_person_slug,
  });
  assert.equal(folderAttrAgain.length, 1);

  const beforeCatalog = await countPeople();
  const coronaId = "2000000000000000103";
  const coronaPosts = {
    [coronaId]: tweet({
      id: coronaId,
      handle: "someone",
      name: "Wire",
      text: "James Comey corona comms on 2024-07-01.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const coronaRow = row({
    subject_status_id: coronaId,
    subject_url: statusUrl("someone", coronaId),
    mention_status_id: "1000000000000000103",
    referenced_json: null,
  });
  const corona = await digMentionEnvelope(coronaRow, { fetchImpl: harness(coronaPosts).fetchImpl });
  assert.equal(corona.subject_kind, "corona_comms");
  assert.equal(corona.subject, "James Comey");
  assert.equal(corona.category, "corona_comms");
  assert.equal(corona.event_date, "2024-07-01");
  assert.ok(corona.cite_urls.length >= CITE_FLOOR);
  const coronaKept = await digMention(coronaRow, corona);
  assert.equal(coronaKept.status, "kept", coronaKept.error_reason || "");
  assert.equal(coronaKept.subject_kind, "corona_comms");
  assert.equal(coronaKept.kept_person_slug, "james-comey");
  const coronaLead = await getAddRequest(coronaKept.lead_id);
  assert.equal(coronaLead.kind, "person");
  assert.equal(coronaLead.category, "corona_comms");
  assert.ok(coronaLead.cite_urls.length >= CITE_FLOOR);
  const coronaPerson = await getPerson("james-comey");
  assert.ok((coronaPerson.events || []).some((ev) => ev.kind === "corona_comms"));
  const coronaPlan = buildReplyPlan(
    { status: "kept", kept_person_slug: coronaKept.kept_person_slug },
    {
      displayName: coronaKept.person.name,
      detailPath: keepDetailPath(coronaKept.kept_person_slug, "corona_comms"),
    },
  );
  assert.equal(coronaPlan.text, "ExitTrace kept James Comey.");
  assert.equal(coronaPlan.detail_path, "/people/james-comey");
  assert.equal(/https?:\/\//i.test(coronaPlan.text), false);
  const coronaAttr = await listRequestAttributions({
    target_kind: "person",
    target_id: "james-comey",
  });
  assert.equal(coronaAttr.length, 1);

  const castId = "2000000000000000105";
  const castPosts = {
    [castId]: tweet({
      id: castId,
      handle: "nytimes",
      name: "The New York Times",
      text: "James Comey central casting on 2024-05-09.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const castRow = row({
    subject_status_id: castId,
    subject_url: statusUrl("nytimes", castId),
    mention_status_id: "1000000000000000105",
    referenced_json: null,
  });
  const castEnv = await digMentionEnvelope(castRow, { fetchImpl: harness(castPosts).fetchImpl });
  assert.equal(castEnv.subject_kind, "central_casting_comms");
  assert.equal(castEnv.subject, "James Comey");
  assert.ok(castEnv.cite_urls.length >= 1);
  const castKept = await digMention(castRow, castEnv);
  assert.equal(castKept.status, "kept", castKept.error_reason || "");
  assert.equal(castKept.subject_kind, "central_casting_comms");
  assert.equal(castKept.kept_person_slug, "james-comey");
  const castLead = await getAddRequest(castKept.lead_id);
  assert.equal(castLead.kind, "central_casting");
  const castPerson = await getPerson("james-comey");
  assert.ok((castPerson.central_casting || []).length >= 1);
  const castPlan = buildReplyPlan(
    { status: "kept", kept_person_slug: castKept.kept_person_slug },
    {
      displayName: castKept.person.name,
      detailPath: keepDetailPath(castKept.kept_person_slug, "central_casting_comms"),
    },
  );
  assert.equal(castPlan.text, "ExitTrace kept James Comey.");
  assert.equal(castPlan.detail_path, "/people/james-comey");
  assert.equal(/https?:\/\//i.test(castPlan.text), false);
  const castAttr = await listRequestAttributions({
    target_kind: "central_casting_comm",
    target_id: castKept.central_casting.id,
  });
  assert.equal(castAttr.length, 1);
  const castAgain = await digMention(castRow, castEnv);
  assert.equal(castAgain.status, "kept");
  const castAttrAgain = await listRequestAttributions({
    target_kind: "central_casting_comm",
    target_id: castKept.central_casting.id,
  });
  assert.equal(castAttrAgain.length, 1);
  assert.equal(await countPeople(), beforeCatalog);

  const holidayPosts = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Wire",
      text: "Pumpkin Day is today.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const holiday = await digMentionEnvelope(row({ referenced_json: null }), {
    fetchImpl: harness(holidayPosts).fetchImpl,
  });
  assert.deepEqual(holiday, { outcome: "fail_closed", error_reason: "missing_subject" });
  const holidayDug = await digMention(row({ referenced_json: null }), holiday);
  assert.equal(holidayDug.status, "fail_closed");
  assert.equal(holidayDug.lead_id, null);
  quiet(buildReplyPlan({ status: "fail_closed", error_reason: "missing_subject" }));

  const castingPosts = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Wire",
      text: "Central Casting is not a person card by itself.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const casting = await digMentionEnvelope(row({ referenced_json: null }), {
    fetchImpl: harness(castingPosts).fetchImpl,
  });
  assert.deepEqual(casting, { outcome: "fail_closed", error_reason: "missing_subject" });
  quiet(buildReplyPlan(casting && { status: "fail_closed", error_reason: casting.error_reason }));

  const unofficialDog = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Wire",
      text: "Military working dog honored on 2024-06-15.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const unofficial = await digMentionEnvelope(row({ referenced_json: null }), {
    fetchImpl: harness(unofficialDog).fetchImpl,
  });
  assert.deepEqual(unofficial, { outcome: "fail_closed", error_reason: "missing_subject" });

  const unofficialFolder = {
    [SUBJECT]: tweet({
      id: SUBJECT,
      handle: "someone",
      name: "Wire",
      text: "A red folder note on 2024-06-15.",
      urls: [REUTERS, JUSTICE],
    }),
  };
  const unofficialFolderEnv = await digMentionEnvelope(row({ referenced_json: null }), {
    fetchImpl: harness(unofficialFolder).fetchImpl,
  });
  assert.deepEqual(unofficialFolderEnv, { outcome: "fail_closed", error_reason: "missing_subject" });

  assert.equal(keepDetailPath("casey-vale", "person"), "/people/casey-vale");
  assert.equal(keepDetailPath("james-comey", "corona_comms"), "/people/james-comey");
  assert.equal(keepDetailPath("james-comey", "central_casting"), "/people/james-comey");
  assert.equal(keepDetailPath("james-comey", "central_casting_comms"), "/people/james-comey");
  assert.equal(keepDetailPath("operation-restore-justice", "operation"), "/operations/operation-restore-justice");
  assert.equal(keepDetailPath("fbi-k9", "dog_comm"), "/dog-comms/fbi-k9");
  assert.equal(keepDetailPath("fbi-k9", "dog_comms"), "/dog-comms/fbi-k9");
  assert.equal(keepDetailPath("folder-note", "red_folder"), "/red-folder-comms/folder-note");
  assert.equal(keepDetailPath("folder-note", "red_folder_comms"), "/red-folder-comms/folder-note");

  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
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
