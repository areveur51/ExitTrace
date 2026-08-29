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
    "/arrests",
    "/deaths",
    "/deaths/celebrities",
    "/deaths/officials",
    "/deaths/ceos",
    "/unsorted",
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
  return (html.match(new RegExp(`class="[^"]*\\b${className}\\b`, "g")) || []).length;
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
    assert.match(res.body, /person-card/);
    assert.match(res.body, /tui-row/);
    assert.doesNotMatch(res.body, /widgets\.js/);
  }

  const page1Cards = countClass(first.body, "person-card");
  const page2Cards = countClass(second.body, "person-card");
  assert.equal(page1Cards, PAGE_SIZE);
  assert.equal(page2Cards, firings.length - PAGE_SIZE);
  assert.match(first.body, /Page 1 of 2/);
  assert.match(second.body, /Page 2 of 2/);
  assert.match(first.body, /12 available/);
  assert.match(first.body, /1\/10/);
  assert.match(first.body, /tui-toast/);
  assert.match(first.body, /tui-modal/);
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
    "/arrests",
    "/deaths",
    "/deaths/celebrities",
    "/deaths/officials",
    "/deaths/ceos",
    "/unsorted",
    "/dog-comms",
  ];
  for (const p of paths) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.match(res.body, /class="pager"/, p);
    assert.match(res.body, /Page 1 of /);
  }
});

test("dog-comms page paginates stored rows and opens local snapshots on detail", async () => {
  const dogs = newestFirst(seed.dog_comms, "posted_at");
  const res = await get("/dog-comms");
  assert.equal(res.status, 200);
  assert.match(res.body, /class="pager"/);
  assert.match(res.body, /dog-card/);
  assert.match(res.body, new RegExp(dogs[0].handle.replace("@", "@")));
  assert.match(res.body, new RegExp(`/dog-comms/${dogs[0].id}`));
  assert.doesNotMatch(res.body, /widgets\.js/);
  if (dogs.length <= PAGE_SIZE) {
    assert.match(res.body, /Page 1 of 1/);
    assert.equal(countClass(res.body, "dog-card"), dogs.length);
  }
  const detail = await get(`/dog-comms/${dogs[0].id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.body, /Citation:/);
  assert.match(detail.body, /stored snapshot/);
  assert.doesNotMatch(detail.body, /widgets\.js/);
});

test("home is TUI chrome with local search and tap-friendly catalog keys", async () => {
  const res = await get("/");
  assert.equal(res.status, 200);
  assert.match(res.body, /pixel-wordmark/);
  assert.match(res.body, /EXITTRACE|ExitTrace/);
  assert.match(res.body, /action="\/search"/);
  assert.match(res.body, /class="keymap"/);
  assert.match(res.body, /class="keychip"/);
  assert.match(res.body, /href="\/firings"/);
  assert.match(res.body, /href="\/arrests"/);
  assert.match(res.body, /href="\/unsorted"/);
  assert.match(res.body, /data-key="u"/);
  assert.doesNotMatch(res.body, /widgets\.js/);
});

test("Arrests page uses the same TUI chrome and empty subject is not invented", async () => {
  const res = await get("/arrests");
  assert.equal(res.status, 200);
  assert.match(res.body, /ExitTrace/);
  assert.match(res.body, /class="pager"/);
  assert.match(res.body, /class="keymap"/);
  assert.match(res.body, /href="\/arrests"/);
  assert.match(res.body, /data-key="a"/);
  assert.doesNotMatch(res.body, /widgets\.js/);
  const deaths = await get("/deaths");
  assert.equal(deaths.status, 200);
  assert.match(deaths.body, /href="\/deaths\/celebrities"/);
  assert.match(deaths.body, /href="\/deaths\/officials"/);
  assert.match(deaths.body, /href="\/deaths\/ceos"/);
});

test("TUI palette uses imagine-cli tokens, not MovieBox purple/cyan", async () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "app", "lib", "html.mjs"), "utf8");
  const home = await get("/");
  const list = await get("/firings");
  const detail = await get("/people/james-comey");

  assert.match(css, /--bg:\s*#0d0d12/);
  assert.match(css, /--bg-2:\s*#1a1a20/);
  assert.match(css, /--ink:\s*#c9d1d9/);
  assert.match(css, /--gold:\s*#e6c384/);
  assert.match(css, /--green:\s*#98bb6c/);
  assert.match(css, /--blue:\s*#5d81f7/);
  assert.match(css, /--amber:\s*#d19a66/);
  assert.match(css, /--rule:\s*#21262d/);
  assert.doesNotMatch(css, /box-shadow/);
  assert.doesNotMatch(css, /#c4b5fd|#4c1d95|#7c3aed|#67e8f9|#1e1f2b|#fbbf24/);
  assert.doesNotMatch(css, /--cyan\b/);
  assert.match(html, /fill="#e6c384"/);
  assert.doesNotMatch(html, /#c4b5fd|#4c1d95|#67e8f9/);
  assert.match(home.body, /fill="#e6c384"/);
  assert.doesNotMatch(home.body, /#c4b5fd|#4c1d95/);
  assert.match(list.body, /list-head/);
  assert.match(detail.body, /box-pane/);
});

test("person detail keeps net worth and two sources without inventing figures", async () => {
  const row = seed.people.find((r) => r.id === "james-comey");
  const res = await get("/people/james-comey");
  assert.equal(res.status, 200);
  assert.match(res.body, /James Comey/);
  assert.match(res.body, /Net worth \(published estimate\)/);
  assert.match(res.body, /The New York Times/);
  assert.match(res.body, /BBC News/);
  assert.match(res.body, /source-link/);
  assert.match(res.body, /box-pane/);
  assert.equal(row.net_worth_usd, null);
  assert.match(res.body, /—/);
  const missing = await get("/people/not-a-real-person");
  assert.equal(missing.status, 404);
});

test("search stays local and does not invent rows", async () => {
  const res = await get("/search?q=Comey");
  assert.equal(res.status, 200);
  assert.match(res.body, /James Comey/);
  assert.match(res.body, /href="\/people\/james-comey"/);
  const empty = await get("/search?q=xyzzy-no-such-seed-row");
  assert.equal(empty.status, 200);
  assert.match(empty.body, /No seeded rows match/);
  assert.doesNotMatch(empty.body, /href="\/people\//);
});

test("dog-comm list and search cards use still.thumb, not the large snapshot still", async () => {
  const dogs = newestFirst(seed.dog_comms, "posted_at");
  const list = await get("/dog-comms");
  const search = await get(`/search?q=${encodeURIComponent(dogs[0].handle.replace("@", ""))}`);
  const detail = await get(`/dog-comms/${dogs[0].id}`);

  assert.equal(list.status, 200);
  assert.match(list.body, /class="still thumb"/);
  assert.match(list.body, /width="48" height="64"/);
  assert.doesNotMatch(list.body, /class="still"(?![^"]*\bthumb\b)/);

  assert.equal(search.status, 200);
  assert.match(search.body, /class="still thumb"/);
  assert.match(search.body, /width="48" height="64"/);

  assert.equal(detail.status, 200);
  assert.match(detail.body, /class="still"/);
  assert.match(detail.body, /width="320" height="200"/);
});

test("death lists and people search show one death date without a died suffix", async () => {
  const celeb = newestFirst(
    seed.people.filter((r) => r.category === "death_celebrity"),
    "event_date",
  )[0];
  const newestFiring = newestFirst(
    seed.people.filter((r) => r.category === "firings"),
    "event_date",
  )[0];
  assert.ok(celeb && celeb.death_date);
  assert.ok(newestFiring);

  const paths = ["/deaths", "/deaths/celebrities", "/deaths/officials", "/deaths/ceos"];
  for (const p of paths) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.doesNotMatch(res.body, /died /, p);
  }

  const celebs = await get("/deaths/celebrities");
  assert.match(celebs.body, new RegExp(`datetime="${celeb.death_date}"`));
  assert.doesNotMatch(celebs.body, /died /);

  const celebSearch = await get(`/search?q=${encodeURIComponent(celeb.name)}`);
  assert.equal(celebSearch.status, 200);
  assert.match(celebSearch.body, new RegExp(celeb.name));
  assert.doesNotMatch(celebSearch.body, /died /);
  assert.match(celebSearch.body, new RegExp(`datetime="${celeb.death_date}"`));
  assert.doesNotMatch(celebSearch.body, /died ${celeb.death_date}|died [A-Z]/);

  const firingPage = await get("/firings");
  assert.equal(firingPage.status, 200);
  assert.match(firingPage.body, / · Firings · /);
  assert.doesNotMatch(firingPage.body, /died /);
  assert.match(firingPage.body, new RegExp(`datetime="${newestFiring.event_date}"`));
});

test("firings people rows match officials person-card markup", async () => {
  const newest = newestFirst(
    seed.people.filter((r) => r.category === "firings"),
    "event_date",
  )[0];
  const officials = newestFirst(
    seed.people.filter((r) => r.category === "death_official" && r.photo),
    "event_date",
  )[0];
  assert.ok(newest);
  assert.ok(officials);

  const firings = await get("/firings");
  const officialPage = await get("/deaths/officials");
  assert.equal(firings.status, 200);
  assert.equal(officialPage.status, 200);

  assert.match(firings.body, /class="tui-row person-card/);
  assert.match(firings.body, /class="portrait thumb"/);
  assert.match(officialPage.body, /class="tui-row person-card/);
  assert.match(officialPage.body, /class="portrait thumb"/);

  const fired = newest.event_date;
  assert.match(firings.body, new RegExp(`<div class="tui-title">${newest.name}</div>`));
  assert.match(
    firings.body,
    new RegExp(`<time datetime="${fired}">[^<]+</time> · Firings · `),
  );
  assert.doesNotMatch(firings.body, /source-card/);
  assert.doesNotMatch(firings.body, /posted · poster /);
  assert.doesNotMatch(firings.body, /died /);

  assert.match(officialPage.body, / · Officials · /);
  assert.doesNotMatch(officialPage.body, /died /);
  assert.doesNotMatch(officialPage.body, /source-card/);
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
