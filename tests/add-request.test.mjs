import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import {
  AddError,
  processAddRequest,
  queueAddRequest,
} from "../app/lib/add-request.mjs";
import { MISSING_NET_WORTH_NOTE } from "../app/lib/net-worth.mjs";
import { addBody } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import {
  countDogComms,
  countPeople,
  getAddRequest,
  getMemory,
  getPerson,
  hydrateFileMemory,
  listAddRequests,
  loadSeedFile,
  setMemory,
  writeFileStore,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "process-add-request.mjs");
const SEED = path.join(ROOT, "data", "seed.json");

const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];

function goldSeed() {
  return loadSeedFile(SEED);
}

function requestPage(pathname, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : String(body);
    const req = {
      method,
      url: pathname,
      headers: { host: "127.0.0.1", "content-type": "application/x-www-form-urlencoded" },
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
      },
      end(chunk) {
        chunks.push(chunk);
        resolve({
          status: this.statusCode,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

function runProcess(args, env = {}) {
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

test("/add renders person and dog modes in TUI chrome", async () => {
  const person = await requestPage("/add");
  const dog = await requestPage("/add?mode=dog");
  for (const res of [person, dog]) {
    assert.equal(res.status, 200);
    assert.match(res.body, /ExitTrace/);
    assert.match(res.body, /class="keymap"/);
    assert.match(res.body, /href="\/add"/);
    assert.match(res.body, /data-key="n"/);
    assert.match(res.body, /verified official news or official government social/);
    assert.match(res.body, /Unofficial or commentary social is extra only/);
    assert.doesNotMatch(res.body, /widgets\.js/);
  }
  assert.match(person.body, /name="subject"/);
  assert.match(person.body, /name="category"/);
  assert.match(person.body, /value="arrests"/);
  assert.match(person.body, />Arrests</);
  assert.match(person.body, /name="event_date"/);
  assert.match(person.body, /name="hint_url"/);
  assert.match(person.body, /name="photo"/);
  assert.match(person.body, /Wikimedia Commons or official \.gov/);
  assert.match(person.body, /do not invent a photo/i);
  assert.match(person.body, /Existing gold photos are not overwritten/);
  assert.match(person.body, /name="net_worth_usd"/);
  assert.match(person.body, /name="net_worth_source"/);
  assert.match(person.body, /Published Forbes or Bloomberg estimate only/);
  assert.match(person.body, /do not invent a figure/i);
  assert.match(person.body, /Existing gold net-worth is not overwritten/);
  assert.match(person.body, /value="person"/);
  assert.match(dog.body, /name="handle"/);
  assert.match(dog.body, /name="source_url"/);
  assert.match(dog.body, /name="posted_at"/);
  assert.match(dog.body, /Official government/);
  assert.match(dog.body, /value="dog"/);

  const htmlPerson = addBody({ mode: "person" });
  const htmlDog = addBody({ mode: "dog" });
  assert.match(htmlPerson, /Add a person/);
  assert.match(htmlDog, /Add official dog comms/);
});

test("pending add request is stored and does not change gold counts", async () => {
  const seed = goldSeed();
  setMemory(seed);
  assert.equal(await countPeople(), 72);
  assert.equal(await countDogComms(), 8);

  const posted = await requestPage("/add", {
    method: "POST",
    body: new URLSearchParams({
      kind: "person",
      subject: "Casey Vale",
      category: "arrests",
      event_date: "2024-06-15",
      hint_url: "https://example.com/n/arrest-1",
    }).toString(),
  });
  assert.equal(posted.status, 200);
  assert.match(posted.body, /queued/i);
  assert.match(posted.body, /ar-[a-f0-9]+/);
  assert.match(posted.body, /Back to Add/);

  const pending = await listAddRequests({ status: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].subject, "Casey Vale");
  assert.equal(pending[0].kind, "person");
  assert.deepEqual(pending[0].cite_urls, []);
  assert.equal(await countPeople(), 72);
  assert.equal(await countDogComms(), 8);
  assert.equal(goldSeed().people.length, 72);
  assert.equal(JSON.parse(fs.readFileSync(SEED, "utf8")).people.length, 72);
});

test("process with two official cites creates a person; one cite is rejected", async () => {
  setMemory(goldSeed());
  const queued = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
  });
  const before = await countPeople();
  assert.equal(before, 72);

  await assert.rejects(
    () =>
      processAddRequest({
        id: queued.request.id,
        overlay: { cite_urls: [CITES[0]] },
      }),
    (err) => err instanceof AddError && err.code === "cites_floor",
  );
  assert.equal(await countPeople(), 72);
  assert.equal((await getAddRequest(queued.request.id)).status, "rejected");

  const again = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
  });
  const created = await processAddRequest({
    id: again.request.id,
    overlay: { cite_urls: CITES },
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.id, "casey-vale");
  assert.equal(created.person.sources.length, 2);
  assert.equal(created.person.net_worth_usd, null);
  assert.equal(created.person.net_worth_note, MISSING_NET_WORTH_NOTE);
  assert.equal(created.person.net_worth_source, "");
  assert.equal(await countPeople(), 73);
  assert.equal((await getPerson("casey-vale")).name, "Casey Vale");

  const replay = await processAddRequest({
    id: again.request.id,
    overlay: { cite_urls: CITES },
  });
  assert.equal(replay.action, "created");
  assert.equal(replay.replayed, true);
  assert.equal(await countPeople(), 73);
  assert.equal(goldSeed().people.length, 72);
});

test("unofficial commentary social is extra only and posted_at is never event_date", async () => {
  setMemory(goldSeed());
  const unofficial = "https://x.com/RandomCat/status/99";
  const queued = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
  });
  const created = await processAddRequest({
    id: queued.request.id,
    overlay: { cite_urls: [...CITES, unofficial] },
  });
  assert.equal(created.action, "created");
  const urls = created.person.sources.map((s) => s.url);
  assert.deepEqual(urls, CITES);
  assert.ok(!urls.includes(unofficial));
  assert.equal(created.extra_urls.length, 1);
  assert.equal(created.extra_urls[0], unofficial);
  assert.equal(created.person.event_date, "2024-06-15");
  assert.notEqual(created.person.event_date, "2024-03-01");

  const noDate = await queueAddRequest({
    kind: "person",
    subject: "Riley Chen",
    category: "firings",
  });
  await assert.rejects(
    () =>
      processAddRequest({
        id: noDate.request.id,
        overlay: {
          posted_at: "2024-03-01",
          cite_urls: CITES,
          category: "firings",
        },
      }),
    (err) => err instanceof AddError && err.code === "missing_event_date",
  );
  assert.equal(await getPerson("riley-chen"), null);
  assert.equal(goldSeed().people.length, 72);
});

test("dog comms reject unofficial social at queue and process", async () => {
  setMemory(goldSeed());
  await assert.rejects(
    () =>
      queueAddRequest({
        kind: "dog",
        handle: "@RandomCat",
        source_url: "https://x.com/RandomCat/status/1",
        posted_at: "2024-01-01",
      }),
    (err) => err instanceof AddError && err.code === "unofficial_social",
  );

  const posted = await requestPage("/add?mode=dog", {
    method: "POST",
    body: new URLSearchParams({
      kind: "dog",
      handle: "@elonmusk",
      source_url: "https://x.com/elonmusk/status/1",
    }).toString(),
  });
  assert.equal(posted.status, 200);
  assert.match(posted.body, /official government/i);
  assert.equal((await listAddRequests({ status: "pending" })).length, 0);
  assert.equal(await countDogComms(), 8);

  const queued = await queueAddRequest({
    kind: "dog",
    handle: "@POTUS",
    source_url: "https://x.com/POTUS/status/1999999999999999999",
    posted_at: "2024-07-04",
  });
  await assert.rejects(
    () =>
      processAddRequest({
        id: queued.request.id,
        overlay: {
          handle: "@RandomCat",
          source_url: "https://x.com/RandomCat/status/99",
          posted_at: "2024-07-04",
        },
      }),
    (err) => err instanceof AddError && err.code === "unofficial_social",
  );
  assert.equal(await countDogComms(), 8);
});

test("official dog process inserts once and stays annotate-only", async () => {
  setMemory(goldSeed());
  const queued = await queueAddRequest({
    kind: "dog",
    handle: "@POTUS",
    source_url: "https://x.com/POTUS/status/1999999999999999999",
    posted_at: "2024-07-04",
  });
  const first = await processAddRequest({
    id: queued.request.id,
    overlay: { text: "Stored official snapshot from the caller." },
  });
  assert.equal(first.action, "created");
  assert.equal(first.dog.handle, "@POTUS");
  assert.equal(first.dog.posted_at, "2024-07-04");
  assert.equal(await countDogComms(), 9);

  const second = await processAddRequest({
    id: queued.request.id,
    overlay: { text: "Should not invent a second row." },
  });
  assert.equal(second.action, "created");
  assert.equal(second.replayed, true);
  assert.equal(await countDogComms(), 9);
  assert.equal(goldSeed().dog_comms.length, 8);
});

test("gold seed counts stay 72/8 when a request is only queued", async () => {
  setMemory(goldSeed());
  await queueAddRequest({ kind: "person", subject: "Casey Vale" });
  await queueAddRequest({
    kind: "dog",
    handle: "@USArmy",
    source_url: "https://x.com/USArmy/status/1888888888888888888",
  });
  assert.equal(await countPeople(), 72);
  assert.equal(await countDogComms(), 8);
  assert.equal(getMemory().people.length, 72);
  assert.equal(JSON.parse(fs.readFileSync(SEED, "utf8")).people.length, 72);
  assert.equal(JSON.parse(fs.readFileSync(SEED, "utf8")).dog_comms.length, 8);
});

test("add-process CLI applies next pending with cite flags", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "et-add-"));
  fs.copyFileSync(SEED, path.join(tmp, "seed.json"));
  setMemory(goldSeed());
  const queued = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
  });
  writeFileStore(tmp, getMemory());

  const one = await runProcess(
    ["--id", queued.request.id, "--cite-url", CITES[0]],
    { DATA_DIR: tmp },
  );
  assert.equal(one.code, 1, one.stderr);
  assert.match(one.stderr, /at least 2|cite/i);

  const afterFail = JSON.parse(fs.readFileSync(path.join(tmp, "store.json"), "utf8"));
  assert.equal(afterFail.people.length, 72);

  const ok = await runProcess(
    [
      "--id",
      queued.request.id,
      "--cite-url",
      CITES[0],
      "--cite-url",
      CITES[1],
      "--event-date",
      "2024-06-15",
      "--category",
      "arrests",
    ],
    { DATA_DIR: tmp },
  );
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /add-process created person=casey-vale people=73/);

  const store = JSON.parse(fs.readFileSync(path.join(tmp, "store.json"), "utf8"));
  assert.equal(store.people.length, 73);
  assert.ok(store.people.some((r) => r.id === "casey-vale"));
  assert.equal(JSON.parse(fs.readFileSync(SEED, "utf8")).people.length, 72);

  const hydrated = hydrateFileMemory(tmp, goldSeed());
  assert.equal(hydrated.people.length, 73);
});

function writeStill(dir, name, bytes = "portrait-bytes") {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test("local eligible still attaches; missing or ineligible still stays blank", async () => {
  setMemory(goldSeed());
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-media-"));
  writeStill(path.join(media, "people"), "casey-vale.jpg");

  const queued = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
  });
  const created = await processAddRequest({
    id: queued.request.id,
    overlay: { cite_urls: CITES, mediaDir: media },
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.photo, "/media/people/casey-vale.jpg");
  assert.ok(fs.existsSync(path.join(media, "people", "casey-vale.jpg")));

  const blankMedia = fs.mkdtempSync(path.join(os.tmpdir(), "et-media-blank-"));
  const blank = await queueAddRequest({
    kind: "person",
    subject: "Riley Chen",
    category: "firings",
    event_date: "2024-08-01",
  });
  const empty = await processAddRequest({
    id: blank.request.id,
    overlay: {
      cite_urls: CITES,
      photo: "https://example.com/selfie.jpg",
      mediaDir: blankMedia,
    },
  });
  assert.equal(empty.person.photo, "");
  assert.equal(empty.person.photo_credit, "");
  assert.equal(fs.existsSync(path.join(blankMedia, "people", "riley-chen.jpg")), false);
  assert.equal(goldSeed().people.length, 72);
});

test("/add rejects ineligible portrait URL and stores an eligible one", async () => {
  setMemory(goldSeed());
  const bad = await requestPage("/add", {
    method: "POST",
    body: new URLSearchParams({
      kind: "person",
      subject: "Casey Vale",
      category: "arrests",
      event_date: "2024-06-15",
      photo: "https://x.com/RandomCat/photo.jpg",
    }).toString(),
  });
  assert.equal(bad.status, 200);
  assert.match(bad.body, /Wikimedia or official government still/i);
  assert.equal((await listAddRequests({ status: "pending" })).length, 0);

  const wiki =
    "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg";
  const ok = await requestPage("/add", {
    method: "POST",
    body: new URLSearchParams({
      kind: "person",
      subject: "Casey Vale",
      category: "arrests",
      event_date: "2024-06-15",
      photo: wiki,
    }).toString(),
  });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /queued/i);
  const pending = await listAddRequests({ status: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].photo, wiki);
  assert.equal(await countPeople(), 72);
  assert.equal(goldSeed().people.length, 72);
});

test("annotate does not overwrite a gold photo", async () => {
  setMemory(goldSeed());
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-media-gold-"));
  writeStill(path.join(media, "people"), "james-comey.jpg", "not-the-gold-bytes");
  writeStill(path.join(media, "people"), "imposter.jpg", "wrong-person");
  const comey = await getPerson("james-comey");
  assert.equal(comey.photo, "/media/people/james-comey.jpg");
  const credit = comey.photo_credit;

  const queued = await queueAddRequest({
    kind: "person",
    subject: "James Comey",
    category: "firings",
    event_date: "2017-05-09",
  });
  const annotated = await processAddRequest({
    id: queued.request.id,
    overlay: {
      cite_urls: [
        "https://www.example.com/news/comey-follow",
        "https://www.example.net/world/comey-follow",
      ],
      photo: "/media/people/imposter.jpg",
      photo_credit: "Should not win",
      mediaDir: media,
    },
  });
  assert.equal(annotated.action, "annotated");
  assert.equal(annotated.person.photo, "/media/people/james-comey.jpg");
  assert.equal(annotated.person.photo_credit, credit);
  assert.equal(annotated.person.name, "James Comey");
  assert.equal(annotated.person.event_date, "2017-05-09");
  assert.equal((await getPerson("james-comey")).photo, "/media/people/james-comey.jpg");
  assert.equal(await countPeople(), 72);
  assert.equal(JSON.parse(fs.readFileSync(SEED, "utf8")).people.find((r) => r.id === "james-comey").photo, "/media/people/james-comey.jpg");
});

const FORBES = "https://www.forbes.com/profile/casey-vale/";

test("published Forbes estimate fills net worth; ineligible or missing stays blank", async () => {
  setMemory(goldSeed());
  const queued = await queueAddRequest({
    kind: "person",
    subject: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    net_worth_usd: "2500000000",
    net_worth_source: FORBES,
    net_worth_note: "Forbes estimate around the 2024 exit year.",
  });
  assert.equal(queued.request.net_worth_usd, 2500000000);
  assert.equal(queued.request.net_worth_source, FORBES);

  const created = await processAddRequest({
    id: queued.request.id,
    overlay: { cite_urls: CITES },
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.net_worth_usd, 2500000000);
  assert.equal(created.person.net_worth_source, FORBES);
  assert.equal(created.person.net_worth_note, "Forbes estimate around the 2024 exit year.");

  const blank = await queueAddRequest({
    kind: "person",
    subject: "Riley Chen",
    category: "firings",
    event_date: "2024-08-01",
  });
  const empty = await processAddRequest({
    id: blank.request.id,
    overlay: {
      cite_urls: CITES,
      net_worth_usd: "999",
      net_worth_source: "https://example.com/wealth/riley",
    },
  });
  assert.equal(empty.person.net_worth_usd, null);
  assert.equal(empty.person.net_worth_note, MISSING_NET_WORTH_NOTE);
  assert.equal(empty.person.net_worth_source, "");
  assert.equal(goldSeed().people.length, 72);
});

test("/add rejects ineligible net-worth source and stores a Forbes pair", async () => {
  setMemory(goldSeed());
  const bad = await requestPage("/add", {
    method: "POST",
    body: new URLSearchParams({
      kind: "person",
      subject: "Casey Vale",
      category: "arrests",
      event_date: "2024-06-15",
      net_worth_usd: "2500000000",
      net_worth_source: "https://example.com/wealth/casey",
    }).toString(),
  });
  assert.equal(bad.status, 200);
  assert.match(bad.body, /Forbes or Bloomberg estimate/i);
  assert.equal((await listAddRequests({ status: "pending" })).length, 0);

  const usdOnly = await requestPage("/add", {
    method: "POST",
    body: new URLSearchParams({
      kind: "person",
      subject: "Casey Vale",
      category: "arrests",
      event_date: "2024-06-15",
      net_worth_usd: "2500000000",
    }).toString(),
  });
  assert.equal(usdOnly.status, 200);
  assert.match(usdOnly.body, /Forbes or Bloomberg source URL/i);
  assert.equal((await listAddRequests({ status: "pending" })).length, 0);

  const ok = await requestPage("/add", {
    method: "POST",
    body: new URLSearchParams({
      kind: "person",
      subject: "Casey Vale",
      category: "arrests",
      event_date: "2024-06-15",
      net_worth_usd: "2500000000",
      net_worth_source: FORBES,
    }).toString(),
  });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /queued/i);
  const pending = await listAddRequests({ status: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].net_worth_usd, 2500000000);
  assert.equal(pending[0].net_worth_source, FORBES);
  assert.equal(await countPeople(), 72);
  assert.equal(goldSeed().people.length, 72);
});

test("annotate does not overwrite gold net-worth", async () => {
  setMemory(goldSeed());
  const kalanick = await getPerson("travis-kalanick");
  assert.equal(kalanick.net_worth_usd, 2500000000);
  const comey = await getPerson("james-comey");
  assert.equal(comey.net_worth_usd, null);
  assert.equal(comey.net_worth_note, MISSING_NET_WORTH_NOTE);

  const kq = await queueAddRequest({
    kind: "person",
    subject: "Travis Kalanick",
    category: "resignations",
    event_date: "2017-06-21",
  });
  const kAnn = await processAddRequest({
    id: kq.request.id,
    overlay: {
      cite_urls: [
        "https://www.example.com/news/kalanick-follow",
        "https://www.example.net/world/kalanick-follow",
      ],
      net_worth_usd: "1",
      net_worth_source: "https://www.forbes.com/profile/should-not-win/",
      net_worth_note: "Should not win",
    },
  });
  assert.equal(kAnn.action, "annotated");
  assert.equal(kAnn.person.net_worth_usd, 2500000000);
  assert.equal(kAnn.person.net_worth_note, kalanick.net_worth_note);
  assert.equal(kAnn.person.net_worth_source, kalanick.net_worth_source);

  const cq = await queueAddRequest({
    kind: "person",
    subject: "James Comey",
    category: "firings",
    event_date: "2017-05-09",
  });
  const cAnn = await processAddRequest({
    id: cq.request.id,
    overlay: {
      cite_urls: [
        "https://www.example.com/news/comey-worth",
        "https://www.example.net/world/comey-worth",
      ],
      net_worth_usd: "1",
      net_worth_source: "https://www.forbes.com/profile/should-not-win/",
    },
  });
  assert.equal(cAnn.action, "annotated");
  assert.equal(cAnn.person.net_worth_usd, null);
  assert.equal(cAnn.person.net_worth_note, MISSING_NET_WORTH_NOTE);
  assert.equal(cAnn.person.net_worth_source, "");
  assert.equal(await countPeople(), 72);
  const seedComey = JSON.parse(fs.readFileSync(SEED, "utf8")).people.find((r) => r.id === "james-comey");
  assert.equal(seedComey.net_worth_usd, null);
  assert.equal(seedComey.net_worth_note, MISSING_NET_WORTH_NOTE);
});
