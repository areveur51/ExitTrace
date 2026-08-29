#!/usr/bin/env node
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
  CATEGORIES,
  PERSON_CATEGORIES,
  categoryByPath,
  isDeathCategory,
} from "./lib/categories.mjs";
import { databaseUrl, loadDotEnv, resolveRoot } from "./lib/env.mjs";
import {
  backendName,
  counts,
  ensureSchema,
  getPool,
  importSeed,
  countDogComms,
  countPeople,
  listDogComms,
  listPeople,
  loadSeedFile,
  setMemory,
  writeFileStore,
} from "./lib/store.mjs";
import {
  dogCard,
  downloadsBody,
  healthBody,
  homeBody,
  layout,
  listSection,
  pager,
  peopleList,
} from "./lib/html.mjs";
import { PAGE_SIZE, paginate, parsePage } from "./lib/paginate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");

loadDotEnv(path.join(ROOT, ".env"));

const port = Number(process.env.PORT || 5220);
const host = process.env.HOST || "0.0.0.0";
const { mediaDir, dataDir } = resolveRoot(ROOT);
const seedPath = path.join(dataDir, "seed.json");
const bootstrapSql = fs.readFileSync(
  path.join(ROOT, "scripts", "bootstrap-db.sql"),
  "utf8",
);

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
  res.writeHead(status, {
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function sendHtml(res, html) {
  send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath);
  const resolved = path.resolve(root, decoded.replace(/^\/+/, ""));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function serveFile(res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, fs.readFileSync(filePath), {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
  });
}

async function healthPayload() {
  const c = await counts();
  return {
    ok: true,
    ready: true,
    backend: backendName(),
    port,
    people: c.people,
    dog_comms: c.dog_comms,
    byCategory: c.byCategory,
  };
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const p = url.pathname;

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  if (p === "/health" || p === "/api/health") {
    const payload = await healthPayload();
    if (p === "/api/health") return sendJson(res, 200, payload);
    return sendHtml(
      res,
      layout({
        title: "Health",
        path: "/health",
        heading: "Health",
        lede: "Process is up. Counts come from the local store.",
        body: healthBody(payload),
      }),
    );
  }

  if (p === "/api/people") {
    const category = url.searchParams.get("category") || undefined;
    if (url.searchParams.has("page")) {
      const total = await countPeople(category);
      const meta = paginate({ total, page: parsePage(url.searchParams) });
      return sendJson(res, 200, {
        people: await listPeople({
          category,
          limit: meta.limit,
          offset: meta.offset,
        }),
        ...meta,
      });
    }
    return sendJson(res, 200, { people: await listPeople(category) });
  }
  if (p === "/api/dog-comms") {
    if (url.searchParams.has("page")) {
      const total = await countDogComms();
      const meta = paginate({ total, page: parsePage(url.searchParams) });
      return sendJson(res, 200, {
        dog_comms: await listDogComms({
          limit: meta.limit,
          offset: meta.offset,
        }),
        ...meta,
      });
    }
    return sendJson(res, 200, { dog_comms: await listDogComms() });
  }

  if (p === "/styles.css" || p === "/app.js") {
    return serveFile(res, path.join(PUBLIC, p.slice(1)));
  }
  if (p.startsWith("/media/")) {
    return serveFile(res, safeJoin(mediaDir, p.slice("/media/".length)));
  }

  if (p === "/") {
    const [c, peoplePreview, dogsPreview] = await Promise.all([
      counts(),
      listPeople({ limit: 8 }),
      listDogComms({ limit: 5 }),
    ]);
    return sendHtml(
      res,
      layout({
        title: "Home",
        path: "/",
        heading: "A sourced clip file",
        lede: "Firings, resignations, government step-downs, and deaths of celebrities, officials, and CEOs — plus official government posts about dogs. Two news citations on every person row.",
        body: homeBody({
          counts: c,
          peoplePreview,
          dogsPreview,
        }),
      }),
    );
  }

  if (p === "/downloads") {
    return sendHtml(
      res,
      layout({
        title: "Downloads",
        path: "/downloads",
        heading: "Data pack",
        lede: "GitHub Releases publish the zip. This page does not fetch it.",
        body: downloadsBody(),
      }),
    );
  }

  const cat = categoryByPath(p);
  if (cat && cat.kind === "person") {
    const total = await countPeople(cat.id);
    const meta = paginate({
      total,
      page: parsePage(url.searchParams),
      pageSize: PAGE_SIZE,
    });
    const rows = await listPeople({
      category: cat.id,
      limit: meta.limit,
      offset: meta.offset,
    });
    return sendHtml(
      res,
      layout({
        title: cat.title,
        path: cat.path,
        heading: cat.title,
        lede: `${cat.blurb} Seeded rows only — not exhaustive.`,
        body: listSection(
          peopleList(rows, { showDeath: isDeathCategory(cat.id) }),
          pager(meta, { basePath: cat.path, noun: "people" }),
        ),
      }),
    );
  }
  if (cat && cat.kind === "dog") {
    const total = await countDogComms();
    const meta = paginate({
      total,
      page: parsePage(url.searchParams),
      pageSize: PAGE_SIZE,
    });
    const rows = await listDogComms({
      limit: meta.limit,
      offset: meta.offset,
    });
    return sendHtml(
      res,
      layout({
        title: cat.title,
        path: cat.path,
        heading: cat.title,
        lede: cat.blurb,
        body: listSection(
          `<div class="dog-page">${rows.map(dogCard).join("")}</div>`,
          pager(meta, { basePath: cat.path, noun: "posts" }),
        ),
      }),
    );
  }

  send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
}

async function boot() {
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Missing seed file: ${seedPath}`);
  }
  const seed = loadSeedFile(seedPath);
  if (databaseUrl()) {
    const pool = await getPool();
    await ensureSchema(pool, bootstrapSql);
    const imported = await importSeed(pool, seed);
    console.log(
      `[exittrace] postgres people=${imported.people} dog_comms=${imported.dog_comms}`,
    );
  } else {
    setMemory(seed);
    writeFileStore(dataDir, seed);
    console.log(
      `[exittrace] file store people=${seed.people.length} dog_comms=${seed.dog_comms.length}`,
    );
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        send(res, 500, "Internal error\n", { "Content-Type": "text/plain; charset=utf-8" });
      }
    });
  });
  server.listen(port, host, () => {
    console.log(`[exittrace] http://${host}:${port} backend=${backendName()}`);
  });
  return server;
}

export {
  CATEGORIES,
  PERSON_CATEGORIES,
  ROOT,
  boot,
  handle,
  healthPayload,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  boot().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
