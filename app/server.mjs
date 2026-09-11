#!/usr/bin/env node
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import {
  CATEGORIES,
  PERSON_CATEGORIES,
  catalogListKinds,
  categoryByPath,
  isDeathCategory,
  isGroupOpsCategory,
  isIndictmentCategory,
} from "./lib/categories.mjs";
import { databaseUrl, loadDotEnv, resolveRoot } from "./lib/env.mjs";
import {
  backendName,
  counts,
  ensureSchema,
  getPool,
  importSeed,
  migrateUniquePeople,
  countDogComms,
  countOperations,
  countPeople,
  countSourcePosts,
  getDogComm,
  getOperation,
  getPerson,
  getSourcePost,
  listDogComms,
  listOperations,
  listPeople,
  listSourcePosts,
  hydrateFileMemory,
  loadSeedFile,
  persistAddRequests,
  searchCatalog,
  writeFileStore,
} from "./lib/store.mjs";
import {
  addBody,
  identityFilterNav,
  dashboardAgeBody,
  dashboardBody,
  dashboardRankBody,
  dogDetail,
  dogList,
  downloadsBody,
  healthBody,
  homeBody,
  layout,
  listHead,
  listSection,
  operationDetail,
  operationList,
  pager,
  peopleList,
  personDetail,
  searchBody,
  sourcePostDetail,
  sourcePostList,
  tuiCount,
} from "./lib/html.mjs";
import { AddError, queueAddRequest } from "./lib/add-request.mjs";
import {
  DOG_PAGE_SIZE,
  PAGE_SIZES,
  paginate,
  parseCookiePageSize,
  parsePage,
} from "./lib/paginate.mjs";
import { parseAgeBand } from "./lib/age.mjs";
import { filterPath, parseTagFilter } from "./lib/tags.mjs";
import {
  findGrokipediaEntry,
  fillEmptyFromGrokipedia,
  grokipediaIndex,
  grokipediaEntryRedirect,
  grokipediaIndexRedirect,
  grokipediaSlug,
  GROKIPEDIA_PATH,
} from "./lib/grokipedia.mjs";
import {
  DASH_AGE,
  buildDashboard,
  dashDimensionByPath,
  dashRangeHref,
  parseDashRangeSearch,
  peopleInAgeBand,
  rankDimension,
} from "./lib/dashboard.mjs";
import { ensureThumbFile, thumbRelFromHref } from "./lib/thumb.mjs";

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

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req?.headers?.["accept-encoding"] || ""));
}

function gzippableType(contentType) {
  const type = String(contentType || "");
  return (
    type.startsWith("text/") ||
    type.includes("javascript") ||
    type.includes("json") ||
    type.includes("svg")
  );
}

function send(res, status, body, headers = {}) {
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
  const extra = { ...headers };
  const contentType = extra["Content-Type"] || extra["content-type"] || "";
  const req = res.req;
  if (
    req &&
    status === 200 &&
    payload.length >= 512 &&
    gzippableType(contentType) &&
    acceptsGzip(req)
  ) {
    payload = zlib.gzipSync(payload);
    extra["Content-Encoding"] = "gzip";
    extra.Vary = extra.Vary ? `${extra.Vary}, Accept-Encoding` : "Accept-Encoding";
  }
  res.writeHead(status, {
    "Content-Length": payload.length,
    "Cache-Control": extra["Cache-Control"] || extra["cache-control"] || "no-store",
    ...extra,
  });
  res.end(payload);
}

const staticCache = new Map();
const STATIC_CACHE_MAX_BYTES = 1024 * 1024;

function cachedFile(filePath, { gzippable = false } = {}) {
  const st = fs.statSync(filePath);
  const hit = staticCache.get(filePath);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  const body = fs.readFileSync(filePath);
  const etag = `"${crypto.createHash("sha1").update(body).digest("hex")}"`;
  const entry = {
    body,
    gzip: gzippable ? zlib.gzipSync(body) : null,
    etag,
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
  if (gzippable && st.size <= STATIC_CACHE_MAX_BYTES) staticCache.set(filePath, entry);
  return entry;
}

function sendStatic(req, res, filePath, contentType, cacheControl) {
  const gzippable = gzippableType(contentType);
  if (!gzippable) {
    const st = fs.statSync(filePath);
    const etag = `W/"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      ETag: etag,
    };
    if (String(req.headers["if-none-match"] || "") === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const body = fs.readFileSync(filePath);
    res.writeHead(200, { ...headers, "Content-Length": body.length });
    res.end(body);
    return;
  }
  const asset = cachedFile(filePath, { gzippable: true });
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ETag: asset.etag,
    Vary: "Accept-Encoding",
  };
  if (String(req.headers["if-none-match"] || "") === asset.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const gzip = Boolean(asset.gzip) && acceptsGzip(req);
  const payload = gzip ? asset.gzip : asset.body;
  res.writeHead(200, {
    ...headers,
    "Content-Length": payload.length,
    ...(gzip ? { "Content-Encoding": "gzip" } : {}),
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

function sendRedirect(res, location) {
  send(res, 302, "", { Location: location });
}

async function readBody(req, limit = 32_000) {
  if (typeof req.body === "string") return req.body;
  const chunks = [];
  let n = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    n += buf.length;
    if (n > limit) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  const out = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function addPage({ mode, queued, error, values }) {
  return layout({
    title: queued ? "Queued" : "Add",
    path: "/add",
    heading: queued ? "Queued" : "Add",
    mode: queued ? undefined : mode,
    crumbLabel: queued ? "Queued" : undefined,
    query: queued ? "queued" : mode === "dog" ? "add dog" : mode === "operation" ? "add operation" : "add person",
    countLabel: queued ? "queued" : "add",
    lede: queued
      ? "The request is stored. A host process supplies cites and applies the row."
      : "Queue a person, an operation, or an official government dog-comm. Cites are not invented here.",
    body: addBody({ mode, queued, error, values }),
  });
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

function serveFile(res, filePath, req) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const cache = "public, max-age=31536000, immutable";
  if (req) return sendStatic(req, res, filePath, type, cache);
  send(res, 200, fs.readFileSync(filePath), {
    "Content-Type": type,
    "Cache-Control": cache,
  });
}

function serveMedia(res, reqPath, req) {
  const rel = decodeURIComponent(String(reqPath || "")).replace(/^\/+/, "");
  if (rel.startsWith("thumbs/")) {
    const href = `/media/${rel}`;
    const thumbRel = thumbRelFromHref(href);
    const dest = thumbRel ? ensureThumbFile(mediaDir, thumbRel) : null;
    return serveFile(res, dest, req);
  }
  return serveFile(res, safeJoin(mediaDir, rel), req);
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
    operations: c.operations,
    source_posts: c.source_posts,
    byCategory: c.byCategory,
  };
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const p = url.pathname;

  if (p === "/add" && req.method === "POST") {
    let fields = {};
    try {
      fields = parseForm(await readBody(req));
    } catch {
      send(res, 400, "Bad request\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const mode =
      fields.kind === "dog" ? "dog" : fields.kind === "operation" ? "operation" : "person";
    try {
      const { request } = await queueAddRequest(fields);
      if (!databaseUrl()) persistAddRequests(dataDir);
      return sendHtml(res, addPage({ mode, queued: request }));
    } catch (err) {
      const message =
        err instanceof AddError ? err.message : "Could not queue that request.";
      return sendHtml(res, addPage({ mode, error: message, values: fields }));
    }
  }

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
      const meta = paginate({
        total,
        page: parsePage(url.searchParams),
        pageSize: parseCookiePageSize(req.headers.cookie),
      });
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
  if (p === "/api/grokipedia" || p.startsWith("/api/grokipedia/")) {
    const people = await listPeople();
    if (p === "/api/grokipedia") {
      return sendJson(res, 200, {
        ok: true,
        entries: grokipediaIndex(people).map((entry) => ({
          slug: entry.slug,
          name: entry.name,
          personHref: entry.personHref,
          cite: entry.cite,
        })),
      });
    }
    const slug = safeId(p.slice("/api/grokipedia/".length));
    const person = slug
      ? people.find((row) => grokipediaSlug(row) === slug || row.id === slug)
      : null;
    if (!person) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const filled = fillEmptyFromGrokipedia(person);
    const entry = findGrokipediaEntry(people, grokipediaSlug(person));
    return sendJson(res, 200, {
      slug: grokipediaSlug(person),
      name: person.name,
      personHref: `/people/${person.id}`,
      cite: filled.cite,
      fills: filled.filled,
      redundant: entry?.redundant ?? false,
    });
  }
  if (p === "/api/operations") {
    const tag = url.searchParams.get("tag") || url.searchParams.get("category") || undefined;
    const tags = tag && tag !== "group_ops_unspecified" ? [tag] : [];
    if (url.searchParams.has("page")) {
      const total = await countOperations({ tags });
      const meta = paginate({
        total,
        page: parsePage(url.searchParams),
        pageSize: parseCookiePageSize(req.headers.cookie),
      });
      return sendJson(res, 200, {
        operations: await listOperations({
          tags,
          limit: meta.limit,
          offset: meta.offset,
        }),
        ...meta,
      });
    }
    return sendJson(res, 200, { operations: await listOperations({ tags }) });
  }
  if (p === "/api/dog-comms") {
    if (url.searchParams.has("page")) {
      const total = await countDogComms();
      const meta = paginate({
        total,
        page: parsePage(url.searchParams),
        pageSize: DOG_PAGE_SIZE,
      });
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
      const meta = paginate({
        total,
        page: parsePage(url.searchParams),
        pageSize: parseCookiePageSize(req.headers.cookie),
      });
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

  if (p === "/styles.css" || p === "/app.js" || p.startsWith("/media/themes/")) {
    const filePath = p.startsWith("/media/themes/")
      ? safeJoin(PUBLIC, p.slice(1))
      : path.join(PUBLIC, p.slice(1));
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    sendStatic(
      req,
      res,
      filePath,
      MIME[ext] || "application/octet-stream",
      "public, max-age=31536000, immutable",
    );
    return;
  }
  if (p.startsWith("/media/")) {
    return serveMedia(res, p.slice("/media/".length), req);
  }

  if (p === "/") {
    const c = await counts();
    return sendHtml(
      res,
      layout({
        title: "Home",
        path: "/",
        heading: "ExitTrace",
        mode: "home",
        query: "home",
        countLabel: `${c.people} people · ${c.operations || 0} operations · ${c.dog_comms} dog comms`,
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
      pageSize: DOG_PAGE_SIZE,
    });
    const windowed = all.slice(meta.offset, meta.offset + meta.limit);
    const searchPath = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
    return sendHtml(
      res,
      layout({
        title: q ? `Search · ${q}` : "Search",
        path: "/search",
        heading: "Search",
        crumbLabel: q || "Search",
        query: q || "search",
        countLabel: q ? countText(q, meta, windowed.length) : "local",
        lede: "Matches names, operation titles, roles, summaries, handles, and stored post text in the local catalog.",
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

  if (p === "/add") {
    const rawMode = url.searchParams.get("mode");
    const mode = rawMode === "dog" || rawMode === "operation" ? rawMode : "person";
    return sendHtml(res, addPage({ mode }));
  }

  if (p === GROKIPEDIA_PATH || p.startsWith(`${GROKIPEDIA_PATH}/`)) {
    if (p === GROKIPEDIA_PATH) {
      return sendRedirect(res, grokipediaIndexRedirect());
    }
    const slug = safeId(p.slice(`${GROKIPEDIA_PATH}/`.length));
    const people = await listPeople();
    const person = slug
      ? people.find((row) => grokipediaSlug(row) === slug || row.id === slug)
      : null;
    return sendRedirect(res, grokipediaEntryRedirect(person, slug));
  }

  if (p === "/dashboard" || p.startsWith("/dashboard/")) {
    const people = await listPeople();
    const operations = await listOperations();
    const dim = dashDimensionByPath(p);
    const range = parseDashRangeSearch(url.searchParams, { cookie: req.headers.cookie });
    if (p === DASH_AGE.path) {
      const bandToken = String(url.searchParams.get("band") || "").trim();
      const band = parseAgeBand(bandToken);
      const invalid = Boolean(bandToken) && bandToken !== "all" && !band;
      const matched = invalid ? [] : peopleInAgeBand(people, band?.id, range);
      const pageSize = parseCookiePageSize(req.headers.cookie);
      const meta = paginate({
        total: matched.length,
        page: parsePage(url.searchParams),
        pageSize,
      });
      const windowed = matched.slice(meta.offset, meta.offset + meta.limit);
      const listPath = dashRangeHref(DASH_AGE.path, range, band ? { band: band.id } : {});
      const heading = band ? `Age · ${band.label}` : "Counts by Age";
      return sendHtml(
        res,
        layout({
          title: `Dashboard · ${heading}`,
          path: DASH_AGE.path,
          heading,
          query: heading,
          pageSize,
          dashRange: range,
          countLabel: countText(heading, meta, windowed.length),
          lede: "Unique people by age at a tagged event. Missing birth date is not guessed and is not listed.",
          body: `${dashboardAgeBody({ range, band })}${listSection(
            peopleList(windowed),
            pager(meta, { basePath: listPath, noun: "rows", pageSizes: PAGE_SIZES }),
            listHead({
              title: heading,
              total: meta.total,
              index: 1,
              of: windowed.length,
            }),
          )}`,
        }),
      );
    }
    if (p !== "/dashboard" && !dim) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    if (dim) {
      const ranked = rankDimension(people, dim.id, range);
      const pageSize = parseCookiePageSize(req.headers.cookie);
      const meta = paginate({
        total: ranked.length,
        page: parsePage(url.searchParams),
        pageSize,
      });
      const windowed = ranked.slice(meta.offset, meta.offset + meta.limit);
      const rangePath = dashRangeHref(dim.path, range);
      return sendHtml(
        res,
        layout({
          title: `Dashboard · ${dim.nav}`,
          path: dim.path,
          heading: `All by ${dim.nav}`,
          query: dim.nav,
          pageSize,
          dashRange: range,
          countLabel: countText(dim.nav, meta, windowed.length),
          lede: "Live unique-person counts from event columns. Empty buckets stay empty. Country, organization, and branch are not guessed.",
          body: listSection(
            dashboardRankBody(dim, windowed, { range }),
            pager(meta, { basePath: rangePath, noun: "rows", pageSizes: PAGE_SIZES }),
            listHead({
              title: dim.nav,
              total: meta.total,
              index: 1,
              of: windowed.length,
            }),
          ),
        }),
      );
    }
    const model = buildDashboard(people, range, operations);
    return sendHtml(
      res,
      layout({
        title: "Dashboard",
        path: "/dashboard",
        heading: "Dashboard",
        query: "dashboard",
        dashRange: range,
        countLabel: `${model.people} people · ${model.trends.events} events`,
        lede: "Live unique-person ranks from the same event columns harvest writes. One card per person. Reason is the KEEP kind. Empty org, country, branch, and position stay empty.",
        body: dashboardBody(model, { path: "/dashboard", range }),
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
        categoryId: row.category,
        crumbLabel: row.name,
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
        crumbLabel: "Source post",
        countLabel: "detail",
        body: sourcePostDetail(row),
      }),
    );
  }

  if (p.startsWith("/operations/") && p !== "/operations/") {
    const id = safeId(p.slice("/operations/".length));
    const row = id ? await getOperation(id) : null;
    if (!row) {
      send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const tag = (row.tags || [])[0] || "group_ops_unspecified";
    return sendHtml(
      res,
      layout({
        title: row.name,
        path: `/operations/${row.id}`,
        heading: row.name,
        query: row.name,
        categoryId: tag,
        crumbLabel: row.name,
        countLabel: "detail",
        body: operationDetail(row),
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
        crumbLabel: row.handle,
        countLabel: "snapshot",
        body: dogDetail(row),
      }),
    );
  }

  const cat = categoryByPath(p);
  if (cat && cat.kind === "person") {
    const deaths = isDeathCategory(cat.id);
    const gov = cat.id === "government_stepdowns";
    const kinds = gov
      ? []
      : isDeathCategory(cat.id)
        ? catalogListKinds("death_unspecified")
        : isIndictmentCategory(cat.id)
          ? catalogListKinds("indictment_unspecified")
          : catalogListKinds(cat.id);
    const tags = parseTagFilter(url.searchParams, p);
    const pageSize = parseCookiePageSize(req.headers.cookie);
    const listOpts = { category: kinds, tags };
    const total = await countPeople(listOpts);
    const meta = paginate({
      total,
      page: parsePage(url.searchParams),
      pageSize,
    });
    const rows = await listPeople({
      ...listOpts,
      limit: meta.limit,
      offset: meta.offset,
    });
    const heading = gov ? "Officials" : cat.title;
    const listPath = filterPath(cat.path, { tags });
    return sendHtml(
      res,
      layout({
        title: heading,
        path: cat.path,
        heading,
        query: heading,
        pageSize,
        countLabel: countText(heading, meta, rows.length),
        lede: gov
          ? "People tagged official — government, appointed, military, or law-enforcement roles. One card per person; tags are not exclusive."
          : `${cat.blurb} One card per person. Identity tags are independent of the event. Seeded rows only — not exhaustive.`,
        body: `${identityFilterNav(cat.path, { tags })}${listSection(
          peopleList(rows, { showDeath: deaths }),
          pager(meta, { basePath: listPath, noun: "rows", pageSizes: PAGE_SIZES }),
          listHead({
            title: heading,
            total: meta.total,
            index: 1,
            of: rows.length,
          }),
        )}`,
      }),
    );
  }
  if (cat && cat.kind === "operation") {
    const tags = isGroupOpsCategory(cat.id) && cat.id !== "group_ops_unspecified"
      ? catalogListKinds(cat.id)
      : [];
    const pageSize = parseCookiePageSize(req.headers.cookie);
    const listOpts = { tags };
    const total = await countOperations(listOpts);
    const meta = paginate({
      total,
      page: parsePage(url.searchParams),
      pageSize,
    });
    const rows = await listOperations({
      ...listOpts,
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
        pageSize,
        countLabel: countText(cat.title, meta, rows.length),
        lede: cat.blurb,
        body: `${identityFilterNav(cat.path)}${listSection(
          operationList(rows),
          pager(meta, { basePath: cat.path, noun: "rows", pageSizes: PAGE_SIZES }),
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
    const pageSize = parseCookiePageSize(req.headers.cookie);
    const total = await countSourcePosts({ standalone: true });
    const meta = paginate({
      total,
      page: parsePage(url.searchParams),
      pageSize,
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
        pageSize,
        countLabel: countText(cat.title, meta, rows.length),
        lede: cat.blurb,
        body: listSection(
          sourcePostList(rows),
          pager(meta, { basePath: cat.path, noun: "posts", pageSizes: PAGE_SIZES }),
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
      pageSize: DOG_PAGE_SIZE,
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
    const migrated = await migrateUniquePeople();
    console.log(
      `[exittrace] postgres people=${imported.people} dog_comms=${imported.dog_comms} operations=${imported.operations || 0} unique=${migrated.people}`,
    );
  } else {
    const mem = hydrateFileMemory(dataDir, seed);
    writeFileStore(dataDir, mem);
    console.log(
      `[exittrace] file store people=${mem.people.length} dog_comms=${mem.dog_comms.length} operations=${(mem.operations || []).length} source_posts=${mem.source_posts.length}`,
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
