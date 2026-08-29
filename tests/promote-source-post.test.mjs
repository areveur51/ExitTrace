import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { personDetail } from "../app/lib/html.mjs";
import { importSourcePostsText } from "../app/lib/import-posts.mjs";
import {
  CITE_FLOOR,
  findGoldMatch,
  personSlug,
  PromoteError,
  validatePromoteInput,
} from "../app/lib/promote.mjs";
import {
  countPeople,
  countSourcePosts,
  getMemory,
  getPerson,
  hydrateFileMemory,
  listPeople,
  listSourcePosts,
  loadSeedFile,
  mergeGoldPeople,
  promoteSourcePost,
  setMemory,
  writeFileStore,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "source-posts.jsonl");
const SCRIPT = path.join(ROOT, "scripts", "promote-source-post.mjs");

const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

async function parkedFixture() {
  const seed = goldSeed();
  setMemory(seed);
  await importSourcePostsText(fs.readFileSync(FIXTURE, "utf8"));
  return seed;
}

function goldFingerprint(people) {
  return people
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) =>
      JSON.stringify({
        id: row.id,
        name: row.name,
        category: row.category,
        event_date: row.event_date,
        death_date: row.death_date,
        photo: row.photo,
        sources: row.sources,
        summary: row.summary,
      }),
    );
}

function runPromote(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (c) => stdout.push(c));
    child.stderr.on("data", (c) => stderr.push(c));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

test("slug follows seed ids; cite floor is two", () => {
  assert.equal(personSlug("James Comey"), "james-comey");
  assert.equal(personSlug("Harald V"), "harald-v");
  assert.equal(CITE_FLOOR, 2);
  assert.equal(findGoldMatch([], { subject: "Casey Vale", event_date: "2024-06-15" }), null);
});

test("promote fixture source post adds one officials-style person", async () => {
  const seed = await parkedFixture();
  const beforePeople = await countPeople();
  const beforePosts = await countSourcePosts();
  const beforeGold = goldFingerprint(getMemory().people);
  assert.equal(beforePeople, 72);

  const standalone = await listSourcePosts({ standalone: true });
  const arrest = standalone.find((row) => row.source_url.includes("/n/arrest-1"));
  assert.ok(arrest);
  assert.equal(arrest.poster_handle, "@example_desk");
  assert.equal(arrest.posted_at, "2024-03-01");

  const result = await promoteSourcePost({
    source_url: arrest.source_url,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
    summary: "Arrested, contemporaneous news reports said.",
  });

  assert.equal(result.action, "created");
  assert.equal(result.person.id, "casey-vale");
  assert.equal(result.person.name, "Casey Vale");
  assert.equal(result.person.event_date, "2024-06-15");
  assert.notEqual(result.person.event_date, arrest.posted_at);
  assert.notEqual(result.person.name, arrest.poster_name);
  assert.equal(result.person.category, "arrests");
  assert.equal(result.person.photo, "");
  assert.equal(result.person.death_date, null);
  assert.equal(result.person.sources.length, 2);
  assert.equal(result.person.sources[0].url, CITES[0]);
  assert.equal(await countPeople(), beforePeople + 1);
  assert.equal(await countSourcePosts(), beforePosts);

  const leftover = goldFingerprint(getMemory().people.filter((r) => r.id !== "casey-vale"));
  assert.deepEqual(leftover, beforeGold);

  const stillParked = await listSourcePosts({ standalone: true });
  assert.equal(stillParked.length, standalone.length);
  const same = stillParked.find((row) => row.id === arrest.id);
  assert.ok(same);
  assert.equal(same.gold_person_id, null);
  assert.equal(same.posted_at, "2024-03-01");

  const html = personDetail(result.person);
  assert.match(html, /Casey Vale/);
  assert.match(html, />CV<\/span>/);
  assert.doesNotMatch(html, /example_desk/);

  const seedIds = new Set(seed.people.map((r) => r.id));
  assert.ok(!seedIds.has("casey-vale"));
  assert.ok(!seed.people.some((r) => /jessica bowie/i.test(r.name)));
});

test("second promote is idempotent and does not duplicate", async () => {
  await parkedFixture();
  const args = {
    source_url: "https://example.com/n/arrest-1",
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  };
  const first = await promoteSourcePost(args);
  const second = await promoteSourcePost(args);
  assert.equal(first.action, "created");
  assert.equal(second.action, "annotated");
  assert.equal(second.added_cites, 0);
  assert.equal(await countPeople(), 73);
  assert.equal((await getPerson("casey-vale")).sources.length, 2);
});

test("existing gold person is annotate-only", async () => {
  await parkedFixture();
  const comey = await getPerson("james-comey");
  const before = JSON.stringify({
    name: comey.name,
    event_date: comey.event_date,
    category: comey.category,
    sources: comey.sources,
  });
  const extra = "https://www.example.com/n/comey-extra";
  const result = await promoteSourcePost({
    source_url: "https://example.com/n/fire-1",
    subject: "James Comey",
    event_date: "2017-05-11",
    category: "firings",
    cite_urls: [comey.sources[0].url, extra],
  });
  assert.equal(result.action, "annotated");
  assert.equal(result.added_cites, 1);
  assert.equal(await countPeople(), 72);
  const after = await getPerson("james-comey");
  assert.equal(after.name, "James Comey");
  assert.equal(after.event_date, comey.event_date);
  assert.equal(after.category, comey.category);
  assert.deepEqual(after.sources.slice(0, comey.sources.length), comey.sources);
  assert.equal(after.sources.at(-1).url, extra);
  assert.equal(after.sources.length, comey.sources.length + 1);
  const frozen = JSON.stringify({
    name: after.name,
    event_date: after.event_date,
    category: after.category,
    sources: after.sources.slice(0, comey.sources.length),
  });
  assert.equal(frozen, before);
  const others = (await listPeople()).filter((r) => r.id !== "james-comey");
  assert.equal(others.length, 71);
});

test("reject missing subject, missing date, and fewer than two cites", async () => {
  await parkedFixture();
  const base = {
    source_url: "https://example.com/n/arrest-1",
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
  };

  await assert.rejects(
    () => promoteSourcePost({ ...base, subject: "" }),
    (err) => err instanceof PromoteError && err.code === "missing_subject",
  );
  await assert.rejects(
    () => promoteSourcePost({ ...base, event_date: "" }),
    (err) => err instanceof PromoteError && err.code === "missing_event_date",
  );
  await assert.rejects(
    () => promoteSourcePost({ ...base, event_date: "2024-03-01T12:00:00Z" }),
    (err) => err instanceof PromoteError && err.code === "missing_event_date",
  );
  await assert.rejects(
    () => promoteSourcePost({ ...base, cite_urls: [CITES[0]] }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
  await assert.rejects(
    () => promoteSourcePost({ ...base, cite_urls: ["ftp://example.com/n/1", CITES[0]] }),
    (err) => err instanceof PromoteError && err.code === "invalid_cite_url",
  );
  await assert.rejects(
    () => promoteSourcePost({ ...base, category: "dog_comms" }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
  await assert.rejects(
    () => promoteSourcePost({ ...base, category: "death_unspecified" }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );

  assert.equal(await countPeople(), 72);
  assert.doesNotMatch(JSON.stringify(getMemory().people), /Casey Vale/);
});

test("validatePromoteInput never fills subject or date from a source post", () => {
  assert.throws(
    () => validatePromoteInput({ source_url: "https://example.com/n/arrest-1" }),
    (err) => err.code === "missing_subject",
  );
  assert.throws(
    () =>
      validatePromoteInput({
        source_url: "https://example.com/n/arrest-1",
        subject: "Casey Vale",
      }),
    (err) => err.code === "missing_event_date",
  );
});

test("death promote sets death_date; file hydrate keeps extras", async () => {
  await parkedFixture();
  const result = await promoteSourcePost({
    source_url: "https://example.com/n/death-1",
    subject: "Casey Vale",
    event_date: "2024-05-10",
    category: "death_official",
    cite_urls: CITES,
  });
  assert.equal(result.person.death_date, "2024-05-10");
  assert.equal(result.person.photo, "");

  const seed = goldSeed();
  const merged = mergeGoldPeople(seed.people, [
    ...seed.people,
    result.person,
    {
      ...seed.people.find((r) => r.id === "james-comey"),
      name: "Should Not Win",
      event_date: "1999-01-01",
      sources: [
        ...seed.people.find((r) => r.id === "james-comey").sources,
        { title: "", publisher: "", url: "https://www.example.com/n/kept", date: "2017-05-09" },
      ],
    },
  ]);
  assert.equal(merged.length, 73);
  const comey = merged.find((r) => r.id === "james-comey");
  assert.equal(comey.name, "James Comey");
  assert.equal(comey.event_date, "2017-05-09");
  assert.ok(comey.sources.some((s) => s.url === "https://www.example.com/n/kept"));
  assert.ok(merged.some((r) => r.id === "casey-vale"));
});

test("one-shot CLI writes the file store and stays idempotent", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "et-promote-"));
  fs.copyFileSync(path.join(ROOT, "data", "seed.json"), path.join(tmp, "seed.json"));
  await parkedFixture();
  writeFileStore(tmp, getMemory());

  const flags = [
    "--source-url",
    "https://example.com/n/arrest-1",
    "--subject",
    "Casey Vale",
    "--event-date",
    "2024-06-15",
    "--category",
    "arrests",
    "--cite-url",
    CITES[0],
    "--cite-url",
    CITES[1],
    "--summary",
    "Arrested, contemporaneous news reports said.",
  ];
  const first = await runPromote(flags, { DATA_DIR: tmp });
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /promote created person=casey-vale people=73/);
  assert.match(first.stdout, /unsorted/);

  const store = JSON.parse(fs.readFileSync(path.join(tmp, "store.json"), "utf8"));
  assert.equal(store.people.length, 73);
  const person = store.people.find((r) => r.id === "casey-vale");
  assert.equal(person.photo, "");
  assert.equal(person.sources.length, 2);
  assert.ok(store.source_posts.some((r) => r.source_url.includes("/n/arrest-1") && !r.gold_person_id));
  assert.ok(!store.people.some((r) => /jessica bowie/i.test(r.name)));

  const second = await runPromote(flags, { DATA_DIR: tmp });
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /promote annotated person=casey-vale people=73 added=0/);
  const again = JSON.parse(fs.readFileSync(path.join(tmp, "store.json"), "utf8"));
  assert.equal(again.people.length, 73);
  assert.equal(again.people.find((r) => r.id === "casey-vale").sources.length, 2);

  const oneCite = await runPromote(
    [
      "--source-url",
      "https://example.com/n/arrest-1",
      "--subject",
      "Casey Vale",
      "--event-date",
      "2024-06-15",
      "--category",
      "arrests",
      "--cite-url",
      CITES[0],
    ],
    { DATA_DIR: tmp },
  );
  assert.equal(oneCite.code, 1);
  assert.match(oneCite.stderr, /at least 2/);

  const hydrated = hydrateFileMemory(tmp, goldSeed());
  assert.equal(hydrated.people.length, 73);
  assert.ok(hydrated.people.some((r) => r.id === "casey-vale"));
});
