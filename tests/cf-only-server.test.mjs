import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { resetCfOnlyStats } from "../app/lib/cf-origin.mjs";
import { resetRateLimiter } from "../app/lib/rate-limit.mjs";
import { handle } from "../app/server.mjs";

const RAY = "ray-do-not-log";
const SECRET = "origin-secret-test-dddd";
const BOT = "test-bot-token-aaaa";
const WORKER = "test-worker-token-bbbb";
const INTERNAL = "test-internal-token-cccc";
const CF_V4 = "173.245.48.1";

const ENV_KEYS = [
  "ET_CF_ONLY",
  "ET_CF_HOSTS",
  "ET_CF_EXEMPT_PATHS",
  "ET_CF_ORIGIN_SECRET",
  "ET_INTERNAL_BYPASS_TOKEN",
  "TRUSTED_PROXY_HOPS",
  "ET_TRUST_CF_CONNECTING_IP",
  "ET_RL_GLOBAL",
  "ET_RL_SEARCH",
  "ET_RL_ADD",
  "ET_RL_WINDOW_MS",
  "MENTION_QUEUE_BOT_TOKEN",
  "MENTION_QUEUE_WORKER_TOKEN",
];

const PREV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(name, value) {
  if (value == null) delete process.env[name];
  else process.env[name] = String(value);
}

function restoreEnv() {
  for (const [key, value] of Object.entries(PREV)) setEnv(key, value);
  resetRateLimiter();
  resetCfOnlyStats();
}

function applyClean() {
  process.env.ET_RL_GLOBAL = "120";
  process.env.ET_RL_SEARCH = "12";
  process.env.ET_RL_ADD = "5";
  process.env.ET_RL_WINDOW_MS = "60000";
  for (const key of ENV_KEYS) {
    if (key.startsWith("ET_RL_")) continue;
    delete process.env[key];
  }
  resetRateLimiter();
  resetCfOnlyStats();
}

let server;
let port;

function httpCall({ method = "GET", pathname = "/", headers = {}, body = null }) {
  const hdrs = {};
  for (const [key, value] of Object.entries(headers)) hdrs[key.toLowerCase()] = value;
  if (!hdrs.host) hdrs.host = "127.0.0.1";
  hdrs.connection = "close";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: pathname,
        setHost: false,
        headers: hdrs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

before(async () => {
  applyClean();
  server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.equal(addr.address, "127.0.0.1");
  assert.notEqual(addr.port, 5220);
  port = addr.port;
});

beforeEach(() => {
  applyClean();
});

after(async () => {
  restoreEnv();
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function passHeaders(extra = {}) {
  return {
    host: "exittrace.areveur.com",
    "cf-ray": RAY,
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": CF_V4,
    ...extra,
  };
}

test("direct enforce is 403 and a Cloudflare hop is served", async () => {
  process.env.ET_CF_ONLY = "enforce";
  process.env.TRUSTED_PROXY_HOPS = "1";
  const denied = await httpCall({ pathname: "/styles.css" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body, "Forbidden\n");
  assert.match(String(denied.headers["content-type"]), /^text\/plain/);
  assert.equal(denied.body.includes("host"), false);
  assert.equal(denied.body.includes("hop"), false);

  const passed = await httpCall({ pathname: "/styles.css", headers: passHeaders() });
  assert.equal(passed.status, 200);
  assert.match(passed.body, /body|--/);
  assert.notEqual(passed.body, "Forbidden\n");

  const spoofed = await httpCall({
    pathname: "/",
    headers: passHeaders({ "x-forwarded-for": "203.0.113.8" }),
  });
  assert.equal(spoofed.status, 403);
  assert.equal(spoofed.body, "Forbidden\n");
});

test("health and mention-queue bearers pass in enforce; static files do not", async () => {
  process.env.ET_CF_ONLY = "enforce";
  process.env.TRUSTED_PROXY_HOPS = "1";
  process.env.MENTION_QUEUE_BOT_TOKEN = BOT;
  process.env.MENTION_QUEUE_WORKER_TOKEN = WORKER;

  const health = await httpCall({ pathname: "/api/health" });
  assert.equal(health.status, 200);
  const json = JSON.parse(health.body);
  assert.equal(json.cf_only.mode, "enforce");
  assert.equal(typeof json.cf_only.rejected_since_boot, "number");
  const page = await httpCall({ pathname: "/health" });
  assert.equal(page.status, 200);
  assert.match(page.body, /cf_only/);

  const preflight = await httpCall({
    method: "POST",
    pathname: "/api/mention-queue/preflight",
    headers: { authorization: `Bearer ${BOT}` },
    body: "",
  });
  assert.equal(preflight.status, 200);
  assert.deepEqual(JSON.parse(preflight.body), { ok: true, probe: true });

  const pending = await httpCall({
    pathname: "/api/mention-queue/pending",
    headers: { authorization: `Bearer ${WORKER}` },
  });
  assert.equal(pending.status, 200);

  const bad = await httpCall({
    method: "POST",
    pathname: "/api/mention-queue/preflight",
    headers: { authorization: "Bearer test-bot-token-wrong" },
    body: "",
  });
  assert.equal(bad.status, 403);
  assert.equal(bad.body, "Forbidden\n");

  const css = await httpCall({ pathname: "/styles.css" });
  const js = await httpCall({ pathname: "/app.js" });
  assert.equal(css.status, 403);
  assert.equal(js.status, 403);
});

test("internal GET and HEAD pass and POST does not", async () => {
  process.env.ET_CF_ONLY = "enforce";
  process.env.ET_INTERNAL_BYPASS_TOKEN = INTERNAL;
  const ok = await httpCall({
    pathname: "/styles.css",
    headers: { "x-et-internal": INTERNAL },
  });
  assert.equal(ok.status, 200);
  const head = await httpCall({
    method: "HEAD",
    pathname: "/styles.css",
    headers: { "x-et-internal": INTERNAL },
  });
  assert.equal(head.status, 200);
  const post = await httpCall({
    method: "POST",
    pathname: "/styles.css",
    headers: { "x-et-internal": INTERNAL },
    body: "",
  });
  assert.equal(post.status, 403);
  assert.equal(post.body, "Forbidden\n");
  const wrong = await httpCall({
    pathname: "/styles.css",
    headers: { "x-et-internal": "test-internal-token-wrong" },
  });
  assert.equal(wrong.status, 403);
});

test("report serves a direct request and logs one line", async () => {
  process.env.ET_CF_ONLY = "report";
  process.env.ET_CF_ORIGIN_SECRET = SECRET;
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map((item) => String(item)).join(" "));
    orig(...args);
  };
  try {
    const res = await httpCall({ pathname: "/styles.css", headers: { host: "evil-host-do-not-log.example" } });
    assert.equal(res.status, 200);
    const logged = lines.filter((line) => line.startsWith("cf_only reject "));
    assert.deepEqual(logged, ["cf_only reject mode=report reason=host path=/styles.css hop=none"]);
    assert.equal(logged.join("\n").includes(SECRET), false);
    assert.equal(logged.join("\n").includes("evil-host-do-not-log.example"), false);
    const health = await httpCall({ pathname: "/api/health" });
    assert.equal(health.body.includes(SECRET), false);
    assert.equal(JSON.parse(health.body).cf_only.rejected_since_boot >= 1, true);
  } finally {
    console.log = orig;
  }
});

test("origin secret on the wire fails closed and stays out of the body", async () => {
  process.env.ET_CF_ONLY = "enforce";
  process.env.TRUSTED_PROXY_HOPS = "1";
  process.env.ET_CF_ORIGIN_SECRET = SECRET;
  const missing = await httpCall({ pathname: "/styles.css", headers: passHeaders() });
  assert.equal(missing.status, 403);
  assert.equal(missing.body, "Forbidden\n");
  assert.equal(missing.body.includes(SECRET), false);
  const right = await httpCall({
    pathname: "/styles.css",
    headers: passHeaders({ "x-et-origin-auth": SECRET }),
  });
  assert.equal(right.status, 200);
  assert.equal(right.body.includes(SECRET), false);
});
