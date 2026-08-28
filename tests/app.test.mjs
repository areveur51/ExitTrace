import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import path from "path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";

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
  assert.doesNotMatch(js, /widgets\.js|platform\.twitter|syndication/);
});
