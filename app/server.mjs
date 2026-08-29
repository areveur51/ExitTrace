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
  countSourcePosts,
  getDogComm,
  getPerson,
  getSourcePost,
  listDogComms,
  listPeople,
  listSourcePosts,
  loadFileStore,
  loadSeedFile,
  searchCatalog,
  setMemory,
  writeFileStore,
} from "./lib/store.mjs";
import {
  deathsIndexNav,
  dogDetail,
  dogList,
  downloadsBody,
  healthBody,
  homeBody,
  layout,
  listHead,
  listSection,
  pager,
  peopleList,
  personDetail,
  searchBody,
  sourcePostDetail,
  sourcePostList,
  tuiCount,
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
const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version;
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

function safeId(raw) {
  const id = decodeURIComponent(String(raw || ""));
  return /^[a-z0-9][a-z0-9-]*$/i.test(id) ? id : null;
}

function countText(title, meta, pageCount) {
  return tuiCount({
    title,
    total: meta.total,
    index: 1,
    of: pageCount || meta.limit,
  });
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
    source_posts: c.source_posts,
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
        query: "health",
        countLabel: "ready",
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
  if (p === "/api/source-posts") {
    const category = url.searchParams.get("category") || undefined;
    if (url.searchParams.has("page")) {
      const total = await countSourcePosts({ category, standalone: true });
      const meta = paginate({ total, page: parsePage(url.searchParams) });
      return sendJson(res, 200, {
        source_posts: await listSourcePosts({
          category,
          standalone: true,
          limit: meta.limit,
          offset: meta.offset,
        }),
        ...meta,
      });
    }
    return sendJson(res, 200, {
      source_posts: await listSourcePosts({ category, standalone: true }),
    });
  }

  if (p === "/styles.css" || p === "/app.js") {
    const filePath = path.join(PUBLIC, p.slice(1));
    if (!fs.existsSync(filePath)) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, fs.readFileSync(filePath), {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    return;
  }
  if (p.startsWith("/media/")) {
    return serveFile(res, safeJoin(mediaDir, p.slice("/media/".length)));
  }

  if (p === "/") {
    return sendHtml(
      res,
      layout({
        title: "Home",
        path: "/",
        heading: "ExitTrace",
        mode: "home",
        body: homeBody({ version: APP_VERSION }),
      }),
    );
  }

  if (p === "/search") {
    const q = (url.searchParams.get("q") || "").trim();
    const all = q ? await searchCatalog(q) : [];
    const meta = paginate({
      total: all.length,
      page: parsePage(url.searchParams),
      pageSize: PAGE_SIZE,
    });
    const windowed = all.slice(meta.offset, meta.offset + meta.limit);
    const searchPath = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
    return sendHtml(
      res,
      layout({
        title: q ? `Search · ${q}` : "Search",
        path: "/search",
        heading: "Search",
        query: q || "search",
        countLabel: q ? countText(q, meta, windowed.length) : "local",
        lede: "Matches names, roles, summaries, handles, and stored post text in the local catalog.",
        body: listSection(
          searchBody(windowed, q),
          q
            ? pager(meta, { basePath: searchPath, noun: "results" })
            : "",
          q
            ? listHead({
                title: q,
                total: meta.total,
                index: 1,
                of: windowed.length,
              })
            : "",
        ),
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
        query: "downloads",
        countLabel: "pack",
        lede: "GitHub Releases publish the zip. This page does not fetch it.",
        body: downloadsBody(),
      }),
    );
  }

  if (p.startsWith("/people/")) {
    const id = safeId(p.slice("/people/".length));
    const row = id ? await getPerson(id) : null;
    if (!row) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    return sendHtml(
      res,
      layout({
        title: row.name,
        path: `/people/${row.id}`,
        heading: row.name,
        query: row.name,
        countLabel: "detail",
        body: personDetail(row),
      }),
    );
  }

  if (p.startsWith("/posts/")) {
    const id = safeId(p.slice("/posts/".length));
    const row = id ? await getSourcePost(id) : null;
    if (!row) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    return sendHtml(
      res,
      layout({
        title: "Source post",
        path: `/posts/${row.id}`,
        heading: "Source post",
        query: row.poster_handle || "source post",
        countLabel: "detail",
        body: sourcePostDetail(row),
      }),
    );
  }

  if (p.startsWith("/dog-comms/") && p !== "/dog-comms/") {
    const id = safeId(p.slice("/dog-comms/".length));
    const row = id ? await getDogComm(id) : null;
    if (!row) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    return sendHtml(
      res,
      layout({
        title: row.handle,
        path: `/dog-comms/${row.id}`,
        heading: row.handle,
        query: row.handle,
        countLabel: "snapshot",
        body: dogDetail(row),
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
    const extra = cat.id === "death_unspecified" ? deathsIndexNav() : "";
    return sendHtml(
      res,
      layout({
        title: cat.title,
        path: cat.path,
        heading: cat.title,
        query: cat.title,
        countLabel: countText(cat.title, meta, rows.length),
        lede: `${cat.blurb} Seeded rows only — not exhaustive.`,
        body: `${extra}${listSection(
          peopleList(rows, { showDeath: isDeathCategory(cat.id) }),
          pager(meta, { basePath: cat.path, noun: "rows" }),
          listHead({
            title: cat.title,
            total: meta.total,
            index: 1,
            of: rows.length,
          }),
        )}`,
      }),
    );
  }
  if (cat && cat.kind === "source") {
    const total = await countSourcePosts({ standalone: true });
    const meta = paginate({
      total,
      page: parsePage(url.searchParams),
      pageSize: PAGE_SIZE,
    });
    const rows = await listSourcePosts({
      standalone: true,
      limit: meta.limit,
      offset: meta.offset,
    });
    return sendHtml(
      res,
      layout({
        title: cat.title,
        path: cat.path,
        heading: cat.title,
        query: cat.title,
        countLabel: countText(cat.title, meta, rows.length),
        lede: cat.blurb,
        body: listSection(
          sourcePostList(rows),
          pager(meta, { basePath: cat.path, noun: "posts" }),
          listHead({
            title: cat.title,
            total: meta.total,
            index: 1,
            of: rows.length,
          }),
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
        query: cat.title,
        countLabel: countText(cat.title, meta, rows.length),
        lede: cat.blurb,
        body: listSection(
          dogList(rows),
          pager(meta, { basePath: cat.path, noun: "posts" }),
          listHead({
            title: cat.title,
            total: meta.total,
            index: 1,
            of: rows.length,
          }),
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
    const prior = loadFileStore(dataDir);
    const mem = setMemory({
      people: seed.people,
      dog_comms: seed.dog_comms,
      source_posts: prior.source_posts,
      meta: seed.meta,
    });
    writeFileStore(dataDir, mem);
    console.log(
      `[exittrace] file store people=${mem.people.length} dog_comms=${mem.dog_comms.length} source_posts=${mem.source_posts.length}`,
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
