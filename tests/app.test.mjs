import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import path from "path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import { PAGE_SIZE } from "../app/lib/paginate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 15220;
let child;
let seed;

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: pathname },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 8000;
  let last;
  while (Date.now() < deadline) {
    try {
      const res = await get("/api/health");
      if (res.status === 200) return res;
      last = res;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw last instanceof Error ? last : new Error("health never became 200");
}

before(async () => {
  seed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "seed.json"), "utf8"));
  child = spawn(process.execPath, [path.join(ROOT, "app", "server.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      DATA_DIR: path.join(ROOT, "data"),
      MEDIA_DIR: path.join(ROOT, "media"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
});

after(async () => {
  if (child && !child.killed) child.kill("SIGTERM");
});

test("seed has 8-12 people per exit category and 7+ dog comms", () => {
  const counts = {};
  for (const row of seed.people) {
    counts[row.category] = (counts[row.category] || 0) + 1;
    assert.equal(row.sources.length, 2, `${row.id} needs two sources`);
    if (String(row.category).startsWith("death_")) {
      assert.ok(row.death_date, `${row.id} needs death_date`);
    } else {
      assert.equal(row.death_date, null, `${row.id} death_date must be null`);
    }
  }
  for (const id of [
    "firings",
    "resignations",
    "government_stepdowns",
    "death_celebrity",
    "death_official",
    "death_ceo",
  ]) {
    assert.ok(counts[id] >= 8 && counts[id] <= 12, `${id} count ${counts[id]}`);
  }
  assert.ok(seed.dog_comms.length >= 7, "need 7+ dog comms");
  for (const row of seed.dog_comms) {
    assert.match(row.source_url, /^https:\/\/x\.com\//);
    assert.ok(row.text.length > 10);
    assert.ok(row.snapshot && row.snapshot.text);
  }
});

test("health is 200 on file backend", async () => {
  const res = await get("/api/health");
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.backend, "file");
  assert.equal(json.people, seed.people.length);
  assert.equal(json.dog_comms, seed.dog_comms.length);
});

test("html pages render", async () => {
  const paths = [
    "/",
    "/firings",
    "/resignations",
    "/government",
    "/deaths/celebrities",
    "/deaths/officials",
    "/deaths/ceos",
    "/dog-comms",
    "/downloads",
    "/health",
  ];
  for (const p of paths) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.match(res.body, /ExitTrace/);
    assert.doesNotMatch(res.body, /widgets\.js/);
  }
});

test("downloads page describes the zip and does not fetch it", async () => {
  const res = await get("/downloads");
  assert.equal(res.status, 200);
  assert.match(res.body, /data-latest/);
  assert.match(res.body, /exittrace-data-YYYYMMDD\.zip/);
  assert.doesNotMatch(res.body, /widgets\.js/);
});

test("tree does not ship widgets.js or live X embeds", () => {
  const html = fs.readFileSync(path.join(ROOT, "app", "lib", "html.mjs"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  assert.doesNotMatch(html, /widgets\.js/);
  assert.doesNotMatch(js, /platform\.twitter|platform\.x\.com|cdn\.syndication/);
});

function newestFirst(rows, dateKey) {
  return rows
    .slice()
    .sort((a, b) => {
      const d = String(b[dateKey]).localeCompare(String(a[dateKey]));
      if (d !== 0) return d;
      const tie = dateKey === "event_date" ? "name" : "handle";
      return String(a[tie]).localeCompare(String(b[tie]));
    });
}

function countClass(html, className) {
  return (html.match(new RegExp(`class="${className}"`, "g")) || []).length;
}

test("people list pages paginate newest-first with shareable ?page=", async () => {
  const firings = newestFirst(
    seed.people.filter((r) => r.category === "firings"),
    "event_date",
  );
  assert.ok(firings.length > PAGE_SIZE, "seed must have more than one page of firings");

  const first = await get("/firings");
  const second = await get("/firings?page=2");
  const clamped = await get("/firings?page=99");
  const junk = await get("/firings?page=nope");

  for (const res of [first, second, clamped, junk]) {
    assert.equal(res.status, 200);
    assert.match(res.body, /class="pager"/);
    assert.match(res.body, /class="person-card"/);
    assert.match(res.body, /Net worth \(published estimate\)/);
    assert.doesNotMatch(res.body, /widgets\.js/);
  }

  const page1Cards = countClass(first.body, "person-card");
  const page2Cards = countClass(second.body, "person-card");
  assert.equal(page1Cards, PAGE_SIZE);
  assert.equal(page2Cards, firings.length - PAGE_SIZE);
  assert.match(first.body, /Page 1 of 2/);
  assert.match(second.body, /Page 2 of 2/);
  assert.match(first.body, /rel="next"/);
  assert.match(second.body, /rel="prev"/);
  assert.match(first.body, /href="\/firings\?page=2"/);
  assert.match(second.body, /href="\/firings"/);

  assert.match(first.body, new RegExp(firings[0].name));
  assert.doesNotMatch(first.body, new RegExp(firings[PAGE_SIZE].name));
  assert.match(second.body, new RegExp(firings[PAGE_SIZE].name));
  assert.doesNotMatch(second.body, new RegExp(firings[0].name));

  assert.match(clamped.body, /Page 2 of 2/);
  assert.match(junk.body, /Page 1 of 2/);
  assert.match(junk.body, new RegExp(firings[0].name));
});

test("every category list page ships a pager", async () => {
  const paths = [
    "/firings",
    "/resignations",
    "/government",
    "/deaths/celebrities",
    "/deaths/officials",
    "/deaths/ceos",
    "/dog-comms",
  ];
  for (const p of paths) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.match(res.body, /class="pager"/, p);
    assert.match(res.body, /Page 1 of /);
  }
});

test("dog-comms page paginates stored cards and keeps local snapshots", async () => {
  const dogs = newestFirst(seed.dog_comms, "posted_at");
  const res = await get("/dog-comms");
  assert.equal(res.status, 200);
  assert.match(res.body, /class="pager"/);
  assert.match(res.body, /class="dog-card"/);
  assert.match(res.body, new RegExp(dogs[0].handle.replace("@", "@")));
  assert.match(res.body, /Citation:/);
  assert.doesNotMatch(res.body, /widgets\.js/);
  if (dogs.length <= PAGE_SIZE) {
    assert.match(res.body, /Page 1 of 1/);
    assert.equal(countClass(res.body, "dog-card"), dogs.length);
  }
});

test("home dog-comm previews are tap targets, not hover-only", async () => {
  const res = await get("/");
  assert.equal(res.status, 200);
  assert.match(res.body, /dog-row-toggle/);
  assert.match(res.body, /View snapshot/);
  assert.match(res.body, /Hover or tap/);
  assert.match(res.body, /aria-expanded="false"/);
  assert.match(res.body, /class="person-card"/);
});

test("optional API page= uses the same window without inventing rows", async () => {
  const firings = newestFirst(
    seed.people.filter((r) => r.category === "firings"),
    "event_date",
  );
  const res = await get("/api/people?category=firings&page=1");
  assert.equal(res.status, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.total, firings.length);
  assert.equal(json.people.length, Math.min(PAGE_SIZE, firings.length));
  assert.equal(json.people[0].id, firings[0].id);
  assert.equal(json.people[0].name, firings[0].name);
});
