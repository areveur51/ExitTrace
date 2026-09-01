import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import path from "path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import { DOG_PAGE_SIZE, PAGE_SIZE } from "../app/lib/paginate.mjs";

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
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
});

after(async () => {
  if (child && !child.killed) child.kill("SIGTERM");
});

test("seed has 8-13 people per exit category and 7+ dog comms", () => {
  const counts = {};
  for (const row of seed.people) {
    counts[row.category] = (counts[row.category] || 0) + 1;
    assert.ok(row.sources.length >= 2, `${row.id} needs two sources`);
    assert.equal(row.birth_date, undefined, `${row.id} gold birth_date stays unset`);
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
    assert.ok(counts[id] >= 8 && counts[id] <= 13, `${id} count ${counts[id]}`);
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
    "/corona-comms",
    "/dashboard",
    "/dashboard/reason",
    "/dashboard/organization",
    "/indictments",
    "/indictments/civilians",
    "/indictments/non-civilians",
    "/deaths",
    "/deaths/celebrities",
    "/deaths/officials",
    "/deaths/ceos",
    "/unsorted",
    "/dog-comms",
    "/add",
    "/add?mode=dog",
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
  const deaths = newestFirst(
    seed.people.filter((r) => String(r.category).startsWith("death_")),
    "event_date",
  );
  const totalPages = Math.ceil(deaths.length / PAGE_SIZE);
  assert.ok(deaths.length > PAGE_SIZE, "seed must have more than one page of deaths");

  const first = await get("/deaths");
  const second = await get("/deaths?page=2");
  const clamped = await get("/deaths?page=99");
  const junk = await get("/deaths?page=nope");
  const firings = await get("/firings");

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
  assert.equal(page2Cards, Math.min(PAGE_SIZE, deaths.length - PAGE_SIZE));
  assert.match(first.body, new RegExp(`Page 1 of ${totalPages}`));
  assert.match(second.body, new RegExp(`Page 2 of ${totalPages}`));
  assert.match(first.body, new RegExp(`${deaths.length} available`));
  assert.match(first.body, new RegExp(`1/${PAGE_SIZE}`));
  assert.match(first.body, /tui-toast/);
  assert.match(first.body, /tui-modal/);
  assert.match(first.body, /rel="next"/);
  assert.match(second.body, /rel="prev"/);
  assert.match(first.body, /href="\/deaths\?page=2"/);
  assert.match(second.body, /href="\/deaths"/);
  assert.match(first.body, /data-page-size-set="17"/);
  assert.match(firings.body, /data-page-size-set="17"/);
  assert.match(firings.body, /class="age-filter"/);
  assert.match(first.body, /class="age-filter"/);

  assert.match(first.body, new RegExp(deaths[0].name));
  assert.doesNotMatch(first.body, new RegExp(deaths[PAGE_SIZE].name));
  assert.match(second.body, new RegExp(deaths[PAGE_SIZE].name));
  assert.doesNotMatch(second.body, new RegExp(deaths[0].name));

  assert.match(clamped.body, new RegExp(`Page ${totalPages} of ${totalPages}`));
  assert.match(junk.body, new RegExp(`Page 1 of ${totalPages}`));
  assert.match(junk.body, new RegExp(deaths[0].name));
});

test("every category list page ships a pager", async () => {
  const paths = [
    "/firings",
    "/resignations",
    "/government",
    "/arrests",
    "/corona-comms",
    "/dashboard/reason",
    "/indictments",
    "/indictments/civilians",
    "/indictments/non-civilians",
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
  if (dogs.length <= DOG_PAGE_SIZE) {
    assert.match(res.body, /Page 1 of 1/);
    assert.equal(countClass(res.body, "dog-card"), dogs.length);
  }
  assert.doesNotMatch(res.body, /data-page-size-set=/);
  assert.doesNotMatch(res.body, /class="age-filter"/);
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
  assert.match(res.body, /href="\/corona-comms"/);
  assert.match(res.body, /href="\/dashboard"/);
  assert.match(res.body, /href="\/indictments"/);
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
  assert.match(deaths.body, /person-card/);
  const indictments = await get("/indictments");
  assert.equal(indictments.status, 200);
  assert.match(indictments.body, /href="\/indictments\/civilians"/);
  assert.match(indictments.body, /href="\/indictments\/non-civilians"/);
  assert.doesNotMatch(indictments.body, /person-card/);
  const corona = await get("/corona-comms");
  assert.equal(corona.status, 200);
  assert.match(corona.body, /Corona Comms/);
  assert.match(corona.body, /href="\/corona-comms"/);
  assert.match(corona.body, /data-key="o"/);
  assert.match(corona.body, /aria-current="page">Corona Comms/);
  assert.doesNotMatch(corona.body, /person-card/);
  assert.doesNotMatch(corona.body, /href="\/corona-comms\/civilians"/);
  assert.doesNotMatch(corona.body, /source-card/);
});

test("list pages expose four themes and keep catalog copy, not pin LARP", async () => {
  const list = await get("/firings");
  assert.equal(list.status, 200);
  assert.match(list.body, /data-theme="cyberdeck"/);
  assert.match(list.body, /class="theme-switch"/);
  assert.match(list.body, /data-theme-set="cyberdeck"/);
  assert.match(list.body, /data-theme-set="phosphor"/);
  assert.match(list.body, /data-theme-set="greyscale"/);
  assert.match(list.body, /data-theme-set="stencil"/);
  assert.match(list.body, />Cyberdeck</);
  assert.match(list.body, />Phosphor</);
  assert.match(list.body, />Greyscale</);
  assert.match(list.body, />Stencil</);
  assert.match(list.body, /href="\/firings"/);
  assert.match(list.body, /href="\/resignations"/);
  assert.match(list.body, /href="\/government"/);
  assert.match(list.body, /href="\/deaths"/);
  assert.match(list.body, /href="\/arrests"/);
  assert.match(list.body, /href="\/corona-comms"/);
  assert.match(list.body, /href="\/dashboard"/);
  assert.match(list.body, /href="\/indictments"/);
  assert.match(list.body, /href="\/unsorted"/);
  assert.match(list.body, /href="\/add"/);
  assert.match(list.body, /href="\/dog-comms"/);
  assert.match(list.body, /data-key="f"/);
  assert.match(list.body, />Firings</);
  assert.doesNotMatch(
    list.body,
    /CLOSE HACK|BREACH PROTOCOL|CLOSE HACK IMMEDIATELY|samurai|SurveilTrack|ROOT@/i,
  );
});

test("HUD palette uses red/black/cyan tokens and documents phone/iPad/desktop layouts", async () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "app", "lib", "html.mjs"), "utf8");
  const home = await get("/");
  const list = await get("/firings");
  const detail = await get("/people/james-comey");

  assert.match(css, /--bg:\s*#0a0203/i);
  assert.match(css, /--red:\s*#e23a32/i);
  assert.match(css, /--cyan:\s*#3fe0e8/i);
  assert.match(css, /--cyan-dim:\s*#4fd8e0/i);
  assert.match(css, /--brick:\s*#8e2a22/i);
  assert.match(css, /--ink:\s*#3fe0e8/i);
  assert.match(css, /--label:\s*#f2f0ec/i);
  assert.match(css, /--bin-fill:/);
  assert.match(css, /--hud-year:\s*0\.95rem/);
  assert.match(css, /--hud-label:\s*0\.8rem/);
  assert.match(css, /\.tui-group-h[\s\S]*font-size:\s*var\(--hud-year\)/);
  assert.match(css, /clip-path:\s*polygon/);
  assert.match(css, /phone ~390/);
  assert.match(css, /iPad ~768/);
  assert.match(css, /desktop >=1280/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(min-width: 721px\) and \(max-width: 1100px\)/);
  assert.match(css, /@media \(min-width: 1280px\)/);
  assert.doesNotMatch(css, /#e6c384|#0d0d12|#c4b5fd|#4c1d95|#7c3aed|#fbbf24/);
  assert.match(html, /fill="var\(--red\)"/);
  assert.match(html, /fill="var\(--brick\)"/);
  assert.doesNotMatch(html, /#e6c384|#c4b5fd|#4c1d95|#67e8f9|#ff2a2a/);
  assert.doesNotMatch(
    html,
    /CLOSE HACK|SAMURAI PROTOCOL|BREACH PROTOCOL|ROOT@HARADAN|BIO-INTERFACE/i,
  );
  assert.match(home.body, /data-theme="cyberdeck"/);
  assert.match(home.body, /fill="var\(--red\)"/);
  assert.match(home.body, /class="tui hud/);
  assert.match(home.body, /class="hud-stage"/);
  assert.match(home.body, /href="\/search"/);
  assert.match(home.body, /data-key="s"/);
  assert.doesNotMatch(home.body, /#c4b5fd|#4c1d95|#e6c384/);
  assert.match(list.body, /list-head/);
  assert.match(list.body, /class="hud-stage"/);
  assert.match(detail.body, /box-pane/);
});

test("pages expose a clickable breadcrumb trail", async () => {
  const home = await get("/");
  const list = await get("/firings");
  const deaths = await get("/deaths/celebrities");
  const detail = await get("/people/james-comey");
  const addDog = await get("/add?mode=dog");

  assert.match(home.body, /aria-label="Breadcrumb"/);
  assert.match(home.body, /aria-current="page">Home/);
  assert.match(list.body, /<a href="\/">Home<\/a>/);
  assert.match(list.body, /aria-current="page">Firings/);
  assert.match(deaths.body, /href="\/deaths"/);
  assert.match(deaths.body, /aria-current="page">Celebrities/);
  assert.match(detail.body, /href="\/firings"/);
  assert.match(detail.body, /aria-current="page">James Comey/);
  assert.match(addDog.body, /href="\/add"/);
  assert.match(addDog.body, /aria-current="page">Dog comms/);
});

test("HUD overlays stay behind text and images and keep pointer-events none", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
    assert.ok(match, `missing CSS rule ${selector}`);
    return match[1];
  }

  const scan = rule("body.tui::before");
  const vignette = rule("body.tui::after");
  assert.match(scan, /pointer-events:\s*none/);
  assert.match(vignette, /pointer-events:\s*none/);
  assert.match(scan, /z-index:\s*0/);
  assert.match(vignette, /z-index:\s*0/);
  assert.doesNotMatch(scan, /z-index:\s*4\d/);
  assert.doesNotMatch(vignette, /z-index:\s*4\d/);

  const top = rule(".tui-top");
  const stage = rule(".hud-stage");
  const main = rule(".tui-main");
  assert.match(top, /z-index:\s*2/);
  assert.match(top, /padding:\s*1\.3rem/);
  assert.match(stage, /z-index:\s*1/);
  assert.match(main, /z-index:\s*1/);
  assert.match(rule(".tui-top::before"), /pointer-events:\s*none/);
  assert.match(rule(".tui-top::after"), /pointer-events:\s*none/);
  assert.match(rule(".tui-q,\n.tui-app,\n.tui-n"), /z-index:\s*1/);

  const row = rule(".tui-row");
  assert.match(row, /isolation:\s*isolate/);
  assert.match(row, /background-size:\s*calc\(100% - 1\.7rem\)/);
  const inner = rule(".box-inner");
  assert.match(inner, /background-color:\s*var\(--panel\)/);
  assert.match(inner, /background-size:\s*calc\(100% - 1\.1rem\)/);
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
  assert.match(list.body, /width="40" height="52"/);
  assert.match(list.body, /loading="lazy"/);
  assert.match(list.body, /\/media\/thumbs\/dog-comms\//);
  assert.doesNotMatch(list.body, /src="\/media\/dog-comms\//);
  assert.doesNotMatch(list.body, /class="still"(?![^"]*\bthumb\b)/);

  assert.equal(search.status, 200);
  assert.match(search.body, /class="still thumb"/);
  assert.match(search.body, /width="40" height="52"/);
  assert.match(search.body, /\/media\/thumbs\/dog-comms\//);

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

  const allDeaths = newestFirst(
    seed.people.filter((r) =>
      ["death_celebrity", "death_official", "death_ceo"].includes(r.category),
    ),
    "event_date",
  );
  const parentDeaths = await get("/deaths");
  assert.match(parentDeaths.body, /person-card/);
  assert.match(parentDeaths.body, new RegExp(allDeaths[0].name));
  assert.match(parentDeaths.body, new RegExp(`${allDeaths.length} available`));

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
  assert.match(firings.body, /\/media\/thumbs\/people\//);
  assert.match(firings.body, /width="40" height="52"/);
  assert.match(firings.body, /loading="lazy"/);
  assert.doesNotMatch(firings.body, /src="\/media\/people\//);
  assert.match(officialPage.body, /class="tui-row person-card/);
  assert.match(officialPage.body, /class="portrait thumb"/);
  assert.match(officialPage.body, /\/media\/thumbs\/people\//);
  assert.doesNotMatch(officialPage.body, /src="\/media\/people\//);

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
  if (json.people[0].photo) {
    assert.match(json.people[0].photo, /^\/media\/people\//);
    assert.doesNotMatch(json.people[0].photo, /\/thumbs\//);
  }
});

test("list thumbs are small local JPEGs; detail and cache keep the full still", async () => {
  const row = newestFirst(
    seed.people.filter((r) => r.category === "firings" && r.photo),
    "event_date",
  )[0];
  assert.ok(row?.photo);
  const stem = path.basename(row.photo).replace(/\.[^.]+$/, "");
  const list = await get("/firings");
  const detail = await get(`/people/${row.id}`);
  const thumb = await get(`/media/thumbs/people/${stem}.jpg`);
  const original = await get(row.photo);

  assert.match(list.body, new RegExp(`src="/media/thumbs/people/${stem}\\.jpg"`));
  assert.doesNotMatch(list.body, new RegExp(`src="/media/people/${stem}\\.`));
  assert.match(detail.body, /class="detail-photo"/);
  assert.match(detail.body, new RegExp(`src="${row.photo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.doesNotMatch(detail.body, new RegExp(`/media/thumbs/people/${stem}`));

  assert.equal(thumb.status, 200);
  assert.equal(original.status, 200);
  assert.match(thumb.headers["content-type"], /image\/jpeg/);
  assert.match(thumb.headers["cache-control"], /max-age=31536000/);
  assert.match(thumb.headers["cache-control"], /immutable/);
  assert.match(original.headers["cache-control"], /max-age=31536000/);
  const thumbBytes = Number(thumb.headers["content-length"]);
  const originalBytes = Number(original.headers["content-length"]);
  assert.ok(thumbBytes > 0 && originalBytes > 0);
  assert.ok(thumbBytes < originalBytes);
  assert.ok(thumbBytes < 12_000);
});
