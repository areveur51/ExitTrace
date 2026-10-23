import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cfExemptPaths,
  cfHosts,
  cfOnlyMode,
  cfOnlyStats,
  checkCfOrigin,
  formatCfRejectLine,
  isCloudflareIp,
  resetCfOnlyStats,
  sanitizeCfPath,
} from "../app/lib/cf-origin.mjs";
import {
  clientIp,
  createRateLimiter,
  getRateLimiter,
  resetRateLimiter,
  xffHop,
} from "../app/lib/rate-limit.mjs";
import { handle } from "../app/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANGES_FILE = path.join(ROOT, "app", "data", "cloudflare-ips.json");

const EXPECTED_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
const EXPECTED_V6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const RAY = "ray-do-not-log";
const SECRET = "origin-secret-test-dddd";
const BOT = "test-bot-token-aaaa";
const WORKER = "test-worker-token-bbbb";
const INTERNAL = "test-internal-token-cccc";
const CF_V4 = "173.245.48.1";
const CF_V6 = "2400:cb00::1";

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

after(() => {
  restoreEnv();
});

beforeEach(() => {
  applyClean();
});

function enable(mode = "enforce", hops = "1") {
  process.env.ET_CF_ONLY = mode;
  process.env.TRUSTED_PROXY_HOPS = String(hops);
}

function passHeaders(extra = {}) {
  return {
    host: "exittrace.areveur.com",
    "cf-ray": RAY,
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": CF_V4,
    ...extra,
  };
}

function decision(urlPath, headers, method = "GET") {
  const pathname = new URL(urlPath, "http://127.0.0.1").pathname;
  return checkCfOrigin(
    {
      method,
      url: urlPath,
      headers,
      socket: { remoteAddress: "127.0.0.1" },
    },
    { pathname, env: process.env },
  );
}

function request(pathname, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: pathname,
      headers,
      socket: { remoteAddress: "127.0.0.1" },
      body,
    };
    const chunks = [];
    const res = {
      req,
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, hdrs) {
        this.statusCode = status;
        this.headersSent = true;
        this.headers = {};
        for (const [key, value] of Object.entries(hdrs || {})) {
          this.headers[String(key).toLowerCase()] = String(value);
        }
      },
      end(chunk) {
        if (chunk) chunks.push(chunk);
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(
            chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? "")))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

async function capture(fn) {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  const push = (args) => lines.push(args.map((item) => String(item)).join(" "));
  console.log = (...args) => {
    push(args);
    origLog(...args);
  };
  console.error = (...args) => {
    push(args);
    origErr(...args);
  };
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

function cfLines(lines) {
  return lines.filter((line) => line.startsWith("cf_only reject "));
}

function assertNoLeak(text) {
  const body = String(text);
  for (const secret of [SECRET, BOT, WORKER, INTERNAL, RAY, "evil-host-do-not-log.example"]) {
    assert.equal(body.includes(secret), false, secret);
  }
  assert.equal(body.includes("cf-ray"), false);
  assert.equal(body.includes("cf-connecting-ip"), false);
  assert.equal(body.includes("x-forwarded-for"), false);
  assert.equal(body.includes("authorization"), false);
  assert.equal(body.includes("x-et-"), false);
}

function assertCidr(cidr) {
  const parts = cidr.split("/");
  assert.equal(parts.length, 2, cidr);
  const [addr, bitsRaw] = parts;
  const kind = isIP(addr);
  assert.ok(kind === 4 || kind === 6, cidr);
  const bits = Number(bitsRaw);
  const max = kind === 4 ? 32 : 128;
  assert.equal(String(bits), bitsRaw, cidr);
  assert.ok(Number.isInteger(bits) && bits >= 0 && bits <= max, cidr);
}

test("vendored Cloudflare ranges are pinned at 15 + 7", () => {
  const data = JSON.parse(fs.readFileSync(RANGES_FILE, "utf8"));
  assert.deepEqual(data.source, [
    "https://www.cloudflare.com/ips-v4",
    "https://www.cloudflare.com/ips-v6",
  ]);
  assert.equal(data.fetched, "2026-10-23");
  assert.deepEqual(data.ipv4, EXPECTED_V4);
  assert.deepEqual(data.ipv6, EXPECTED_V6);
  assert.equal(data.ipv4.length, 15);
  assert.equal(data.ipv6.length, 7);
  assert.equal(data.ipv4.length + data.ipv6.length, 22);
  for (const cidr of [...data.ipv4, ...data.ipv6]) {
    assertCidr(cidr);
    const addr = cidr.split("/")[0];
    assert.equal(isCloudflareIp(addr), true, cidr);
  }
  const src = fs.readFileSync(path.join(ROOT, "app", "lib", "cf-origin.mjs"), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /console\./);
  assert.doesNotMatch(src, /remoteAddress/);
  assert.doesNotMatch(src, /fs\.rm|unlink|rmdir|find -delete/);
});

test("isCloudflareIp matches range edges, mapped v4, and rejects outsiders", () => {
  const inside = [
    "173.245.48.0",
    "173.245.63.255",
    "173.245.48.1:443",
    "103.21.244.0",
    "103.21.247.255",
    "141.101.64.0",
    "141.101.127.255",
    "198.41.128.0",
    "198.41.255.255",
    "162.158.0.0",
    "162.159.255.255",
    "104.16.0.0",
    "104.23.255.255",
    "104.24.0.0",
    "104.27.255.255",
    "2400:cb00::",
    "2400:cb00::1",
    "2400:cb00:ffff:ffff:ffff:ffff:ffff:ffff",
    "[2400:cb00::1]",
    "2a06:98c0::",
    "2a06:98c0::1",
    "2a06:98c7:ffff:ffff:ffff:ffff:ffff:ffff",
    "::ffff:173.245.48.0",
    "::ffff:173.245.63.255",
    "::FFFF:173.245.48.1",
  ];
  const outside = [
    "173.245.47.255",
    "173.245.64.0",
    "103.21.243.255",
    "103.21.248.0",
    "141.101.63.255",
    "141.101.128.0",
    "198.41.127.255",
    "198.42.0.0",
    "162.157.255.255",
    "162.160.0.0",
    "104.15.255.255",
    "104.28.0.0",
    "8.8.8.8",
    "1.1.1.1",
    "203.0.113.10",
    "not-an-ip",
    "",
    "2400:cb01::",
    "2400:caff:ffff:ffff:ffff:ffff:ffff:ffff",
    "2a06:98c8::",
    "2a06:98bf:ffff:ffff:ffff:ffff:ffff:ffff",
    "::ffff:173.245.47.255",
    "::ffff:173.245.64.0",
    "::ffff:203.0.113.1",
  ];
  for (const ip of inside) assert.equal(isCloudflareIp(ip), true, ip);
  for (const ip of outside) assert.equal(isCloudflareIp(ip), false, ip);
});

test("mode parser treats only report and enforce as on", () => {
  assert.equal(cfOnlyMode({}), "off");
  assert.equal(cfOnlyMode({ ET_CF_ONLY: "" }), "off");
  assert.equal(cfOnlyMode({ ET_CF_ONLY: "banana" }), "off");
  assert.equal(cfOnlyMode({ ET_CF_ONLY: "yes" }), "off");
  assert.equal(cfOnlyMode({ ET_CF_ONLY: " OFF " }), "off");
  assert.equal(cfOnlyMode({ ET_CF_ONLY: " Enforce " }), "enforce");
  assert.equal(cfOnlyMode({ ET_CF_ONLY: "REPORT" }), "report");
  assert.deepEqual(cfHosts({}), ["exittrace.areveur.com"]);
  assert.deepEqual(cfHosts({ ET_CF_HOSTS: " ExitTrace.Areveur.com , www.Example.com " }), [
    "exittrace.areveur.com",
    "www.example.com",
  ]);
  assert.deepEqual(cfExemptPaths({}), ["/health", "/api/health"]);
  assert.deepEqual(cfExemptPaths({ ET_CF_EXEMPT_PATHS: " /only-probe , /health " }), [
    "/only-probe",
    "/health",
  ]);
});

test("off is a no-op and garbage mode stays off", async () => {
  const open = await capture(() => request("/search?q=z", { headers: { host: "127.0.0.1" } }));
  assert.equal(open.result.status, 200);
  assert.deepEqual(cfLines(open.lines), []);
  assert.deepEqual(cfOnlyStats(), { mode: "off", rejected_since_boot: 0 });
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body).cf_only, { mode: "off", rejected_since_boot: 0 });

  process.env.ET_CF_ONLY = "banana";
  const garbage = await request("/search?q=z", { headers: { host: "evil-host-do-not-log.example" } });
  assert.equal(garbage.status, 200);
  assert.equal(JSON.parse((await request("/api/health")).body).cf_only.mode, "off");
  const offDecision = decision("/search", { host: "127.0.0.1" });
  assert.equal(offDecision.pass, true);
  assert.equal(offDecision.exempt, null);
  assert.equal(offDecision.trustCf, false);
});

test("report serves, counts, and logs one line without secrets or headers", async () => {
  enable("report", "0");
  process.env.ET_CF_ORIGIN_SECRET = SECRET;
  const seen = await capture(() =>
    request("/search?q=z", {
      headers: {
        host: "evil-host-do-not-log.example",
        "cf-ray": RAY,
        "cf-connecting-ip": "203.0.113.10",
        "x-et-origin-auth": "wrong-origin-secret-value",
      },
    }),
  );
  assert.equal(seen.result.status, 200);
  assert.deepEqual(cfLines(seen.lines), [
    "cf_only reject mode=report reason=host path=/search hop=none",
  ]);
  assertNoLeak(cfLines(seen.lines).join("\n"));
  const again = await capture(() => request("/no-such", { headers: { host: "127.0.0.1" } }));
  assert.equal(again.result.status, 404);
  assert.equal(cfLines(again.lines).length, 1);
  const health = await request("/api/health");
  const json = JSON.parse(health.body);
  assert.deepEqual(json.cf_only, { mode: "report", rejected_since_boot: 2 });
  assert.equal(JSON.stringify(json).includes(SECRET), false);
  const page = await request("/health");
  assert.equal(page.status, 200);
  // healthBody HTML-escapes the embedded JSON, so the key is &quot;cf_only&quot;.
  assert.match(page.body, /&quot;cf_only&quot;/);
  assert.equal(page.body.includes(SECRET), false);
  assert.equal(cfOnlyStats().rejected_since_boot, 2);
});

test("enforce returns exactly Forbidden and does not leak the reason", async () => {
  enable("enforce", "1");
  process.env.ET_CF_ORIGIN_SECRET = SECRET;
  const denied = await capture(() =>
    request("/search?q=z", {
      headers: passHeaders({ "x-forwarded-for": "203.0.113.50" }),
    }),
  );
  assert.equal(denied.result.status, 403);
  assert.equal(denied.result.body, "Forbidden\n");
  assert.match(denied.result.headers["content-type"], /^text\/plain/);
  assert.equal(denied.result.body.includes("hop"), false);
  assert.equal(denied.result.body.includes("origin_auth"), false);
  assert.equal(denied.result.body.includes(SECRET), false);
  assert.deepEqual(cfLines(denied.lines), [
    "cf_only reject mode=enforce reason=hop path=/search hop=203.0.113.50",
  ]);
  assertNoLeak(cfLines(denied.lines).join("\n"));
  assert.equal(cfOnlyStats().rejected_since_boot, 1);
});

test("each missing Cloudflare signal fails with its own reason", () => {
  enable("enforce", "1");
  const cases = [
    ["wrong host", passHeaders({ host: "evil-host-do-not-log.example" }), "host", ""],
    ["host with port", passHeaders({ host: "exittrace.areveur.com:443" }), null, CF_V4],
    ["mixed-case host", passHeaders({ Host: "ExitTrace.Areveur.com", host: undefined }), null, CF_V4],
    ["ipv6 host brackets", passHeaders({ host: "[2001:db8::5]:443" }), "host", ""],
    ["missing ray", passHeaders({ "cf-ray": undefined }), "cf_ray", ""],
    ["blank ray", passHeaders({ "cf-ray": "   " }), "cf_ray", ""],
    ["missing cf ip", passHeaders({ "cf-connecting-ip": undefined }), "cf_ip", ""],
    ["blank cf ip", passHeaders({ "cf-connecting-ip": "   " }), "cf_ip", ""],
    ["invalid cf ip", passHeaders({ "cf-connecting-ip": "not-an-ip" }), "cf_ip", ""],
    ["mapped invalid cf ip", passHeaders({ "cf-connecting-ip": "::ffff:999.1.1.1" }), "cf_ip", ""],
  ];
  for (const [name, headers, reason, hop] of cases) {
    if (headers.host === undefined) delete headers.host;
    if (headers["cf-ray"] === undefined) delete headers["cf-ray"];
    if (headers["cf-connecting-ip"] === undefined) delete headers["cf-connecting-ip"];
    const got = decision("/search", headers);
    if (reason == null) {
      assert.equal(got.pass, true, name);
      assert.equal(got.exempt, null, name);
      assert.equal(got.reason, null, name);
    } else {
      assert.equal(got.pass, false, name);
      assert.equal(got.reason, reason, name);
    }
    if (hop) assert.equal(got.hop, hop, name);
  }

  enable("enforce", "0");
  const zero = decision("/search", passHeaders());
  assert.equal(zero.pass, false);
  assert.equal(zero.reason, "hop");
  assert.equal(zero.hop, "");

  enable("enforce", "2");
  const short = decision("/search", passHeaders({ "x-forwarded-for": CF_V4 }));
  assert.equal(short.pass, false);
  assert.equal(short.reason, "hop");
  assert.equal(short.hop, "");

  // hops is still 2, so the selected entry is the second from the right.
  const notCf = decision("/search", passHeaders({ "x-forwarded-for": `1.2.3.4, 203.0.113.50` }));
  assert.equal(notCf.pass, false);
  assert.equal(notCf.reason, "hop");
  assert.equal(notCf.hop, "1.2.3.4");
});

test("spoofed CF headers from a non-Cloudflare hop fail hop", async () => {
  enable("enforce", "1");
  const spoofed = passHeaders({ "x-forwarded-for": "203.0.113.8" });
  const got = decision("/", spoofed);
  assert.equal(got.pass, false);
  assert.equal(got.reason, "hop");
  assert.equal(got.hop, "203.0.113.8");
  assert.equal(got.exempt, null);
  const res = await request("/search?q=z", { headers: spoofed });
  assert.equal(res.status, 403);
  assert.equal(res.body, "Forbidden\n");
});

test("a Cloudflare v4 hop, v6 hop, and mapped v4 hop pass", () => {
  enable("enforce", "1");
  const v4 = decision("/search", passHeaders());
  assert.equal(v4.pass, true);
  assert.equal(v4.exempt, null);
  assert.equal(v4.reason, null);
  assert.equal(v4.hop, CF_V4);
  assert.equal(v4.trustCf, true);

  const v6 = decision("/search", passHeaders({ "x-forwarded-for": CF_V6 }));
  assert.equal(v6.pass, true);
  assert.equal(v6.hop, CF_V6);

  const mapped = decision("/search", passHeaders({ "x-forwarded-for": "::ffff:173.245.48.1" }));
  assert.equal(mapped.pass, true);
  assert.equal(mapped.hop, "173.245.48.1");

  const inside = decision("/search", passHeaders({ "x-forwarded-for": "173.245.63.255" }));
  assert.equal(inside.pass, true);
  const outside = decision("/search", passHeaders({ "x-forwarded-for": "173.245.64.0" }));
  assert.equal(outside.pass, false);
  assert.equal(outside.reason, "hop");
  assert.equal(outside.hop, "173.245.64.0");
  const v6out = decision("/search", passHeaders({ "x-forwarded-for": "2400:cb01::" }));
  assert.equal(v6out.reason, "hop");
  assert.equal(v6out.hop, "2400:cb01::");
});

test("the socket address is not the hop", () => {
  enable("enforce", "1");
  const passed = checkCfOrigin(
    {
      method: "GET",
      url: "/",
      headers: passHeaders(),
      socket: { remoteAddress: "203.0.113.99" },
    },
    { pathname: "/", env: process.env },
  );
  assert.equal(passed.pass, true);
  const ignored = checkCfOrigin(
    {
      method: "GET",
      url: "/",
      headers: {
        host: "exittrace.areveur.com",
        "cf-ray": RAY,
        "cf-connecting-ip": "203.0.113.10",
      },
      socket: { remoteAddress: CF_V4 },
    },
    { pathname: "/", env: process.env },
  );
  assert.equal(ignored.pass, false);
  assert.equal(ignored.reason, "hop");
  assert.equal(ignored.hop, "");
});

test("XFF hop N and clientIp stay on the same path", () => {
  const headers = { "x-forwarded-for": "6.6.6.6, 198.51.100.2, 203.0.113.5" };
  assert.equal(xffHop(headers, 0), "");
  assert.equal(xffHop(headers, 1), "203.0.113.5");
  assert.equal(xffHop(headers, 2), "198.51.100.2");
  assert.equal(clientIp({ headers }, { trustCf: false, trustedProxyHops: 0 }), "unknown");
  assert.equal(clientIp({ headers }, { trustCf: false, trustedProxyHops: 1 }), "203.0.113.5");
  assert.equal(clientIp({ headers }, { trustCf: false, trustedProxyHops: 2 }), "198.51.100.2");
  assert.equal(
    clientIp({ headers: {}, socket: { remoteAddress: "9.9.9.9" } }, { trustCf: false, trustedProxyHops: 1 }),
    "unknown",
  );

  const pad = `${"8.8.8.8, ".repeat(150)}6.6.6.6, 203.0.113.44`;
  assert.equal(xffHop({ "x-forwarded-for": pad }, 1), "203.0.113.44");
  assert.equal(xffHop({ "x-forwarded-for": pad }, 2), "6.6.6.6");
  assert.equal(
    clientIp({ headers: { "x-forwarded-for": pad } }, { trustCf: false, trustedProxyHops: 1 }),
    "203.0.113.44",
  );
  assert.equal(
    xffHop({ "x-forwarded-for": ["1.1.1.1", "203.0.113.8"] }, 1),
    "203.0.113.8",
  );

  enable("enforce", "1");
  const forged = decision("/search", passHeaders({ "x-forwarded-for": "1.2.3.4, 9.9.9.9, 173.245.48.1" }));
  assert.equal(forged.pass, true);
  assert.equal(forged.hop, CF_V4);
  enable("enforce", "2");
  const second = decision("/search", passHeaders({ "x-forwarded-for": "1.2.3.4, 9.9.9.9, 173.245.48.1" }));
  assert.equal(second.pass, false);
  assert.equal(second.reason, "hop");
  assert.equal(second.hop, "9.9.9.9");
  const bothCf = decision("/search", passHeaders({ "x-forwarded-for": "9.9.9.9, 173.245.48.1, 104.16.0.1" }));
  assert.equal(bothCf.pass, true);
  assert.equal(bothCf.hop, CF_V4);
});

test("health stays up in enforce and exempt paths are exact", async () => {
  enable("enforce", "0");
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.match(health.body, /&quot;cf_only&quot;/);
  const api = await request("/api/health?x=1");
  assert.equal(api.status, 200);
  assert.equal(JSON.parse(api.body).cf_only.mode, "enforce");
  assert.equal(JSON.parse(api.body).cf_only.rejected_since_boot, 0);
  const direct = decision("/health", { host: "127.0.0.1" });
  assert.equal(direct.pass, false);
  assert.equal(direct.exempt, "path");
  assert.equal(direct.trustCf, false);

  process.env.ET_CF_EXEMPT_PATHS = "/only-probe";
  const hidden = await request("/health");
  assert.equal(hidden.status, 403);
  assert.equal(hidden.body, "Forbidden\n");
  const custom = await request("/only-probe");
  assert.equal(custom.status, 404);
  assert.equal(decision("/only-probe", { host: "127.0.0.1" }).exempt, "path");

  delete process.env.ET_CF_EXEMPT_PATHS;
  const css = await request("/styles.css");
  const js = await request("/app.js");
  assert.equal(css.status, 403);
  assert.equal(css.body, "Forbidden\n");
  assert.equal(js.status, 403);
  assert.equal(decision("/styles.css", { host: "127.0.0.1" }).exempt, null);
  assert.equal(decision("/app.js", { host: "127.0.0.1" }).exempt, null);
});

test("mention-queue bearer exempts only a validated role", async () => {
  enable("enforce", "0");
  process.env.MENTION_QUEUE_BOT_TOKEN = BOT;
  process.env.MENTION_QUEUE_WORKER_TOKEN = WORKER;

  const preflight = await request("/api/mention-queue/preflight", {
    method: "POST",
    headers: { host: "127.0.0.1", authorization: `Bearer ${BOT}` },
    body: "",
  });
  assert.equal(preflight.status, 200);
  assert.deepEqual(JSON.parse(preflight.body), { ok: true, probe: true });
  assert.equal(
    decision(
      "/api/mention-queue/preflight",
      { host: "127.0.0.1", authorization: `Bearer ${BOT}` },
      "POST",
    ).exempt,
    "bearer",
  );

  const pending = await request("/api/mention-queue/pending", {
    headers: { host: "127.0.0.1", authorization: `Bearer ${WORKER}` },
  });
  assert.equal(pending.status, 200);
  assert.equal(JSON.parse(pending.body).ok, true);
  assert.ok(Array.isArray(JSON.parse(pending.body).rows));

  const botOnWorkerRoute = await request("/api/mention-queue/pending", {
    headers: { host: "127.0.0.1", authorization: `Bearer ${BOT}` },
  });
  assert.equal(botOnWorkerRoute.status, 401);
  assert.equal(botOnWorkerRoute.body.includes(BOT), false);

  const bad = await request("/api/mention-queue/preflight", {
    method: "POST",
    headers: { host: "127.0.0.1", authorization: "Bearer test-bot-token-wrong" },
    body: "",
  });
  assert.equal(bad.status, 403);
  assert.equal(bad.body, "Forbidden\n");
  const missing = await request("/api/mention-queue/preflight", {
    method: "POST",
    headers: { host: "127.0.0.1" },
    body: "",
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.body, "Forbidden\n");

  process.env.MENTION_QUEUE_WORKER_TOKEN = BOT;
  const misconfigured = await request("/api/mention-queue/preflight", {
    method: "POST",
    headers: { host: "127.0.0.1", authorization: `Bearer ${BOT}` },
    body: "",
  });
  assert.equal(misconfigured.status, 403);
});

test("internal bypass is GET and HEAD only", async () => {
  enable("enforce", "0");
  const headers = { host: "127.0.0.1", "x-et-internal": INTERNAL };
  process.env.ET_INTERNAL_BYPASS_TOKEN = INTERNAL;
  const get = await request("/search?q=z", { headers });
  assert.equal(get.status, 200);
  assert.equal(decision("/search?q=z", headers).exempt, "internal");
  const head = await request("/search?q=z", { method: "HEAD", headers });
  assert.notEqual(head.status, 403);
  assert.equal(decision("/search?q=z", headers, "HEAD").exempt, "internal");
  const post = await request("/search?q=z", { method: "POST", headers, body: "" });
  assert.equal(post.status, 403);
  assert.equal(post.body, "Forbidden\n");
  assert.equal(decision("/search?q=z", headers, "POST").exempt, null);

  const wrong = await request("/search?q=z", {
    headers: { host: "127.0.0.1", "X-ET-Internal": "test-internal-token-wrong" },
  });
  assert.equal(wrong.status, 403);

  delete process.env.ET_INTERNAL_BYPASS_TOKEN;
  const unset = await request("/search?q=z", { headers });
  assert.equal(unset.status, 403);
  assert.equal(unset.body.includes(INTERNAL), false);
});

test("a passing Cloudflare request is not marked exempt", () => {
  enable("enforce", "1");
  process.env.ET_INTERNAL_BYPASS_TOKEN = INTERNAL;
  const got = decision("/health", passHeaders({ "x-et-internal": INTERNAL }));
  assert.equal(got.pass, true);
  assert.equal(got.exempt, null);
  assert.equal(got.trustCf, true);
});

test("dormant origin secret is required only when set", async () => {
  enable("enforce", "1");
  const open = decision("/search", passHeaders());
  assert.equal(open.pass, true);

  process.env.ET_CF_ORIGIN_SECRET = SECRET;
  const missing = decision("/search", passHeaders());
  assert.equal(missing.pass, false);
  assert.equal(missing.reason, "origin_auth");
  const wrong = decision("/search", passHeaders({ "x-et-origin-auth": "not-the-origin-secret" }));
  assert.equal(wrong.reason, "origin_auth");
  const right = decision("/search", passHeaders({ "x-et-origin-auth": SECRET }));
  assert.equal(right.pass, true);
  assert.equal(right.exempt, null);

  const denied = await capture(() => request("/search?q=z", { headers: passHeaders() }));
  assert.equal(denied.result.status, 403);
  assert.equal(denied.result.body, "Forbidden\n");
  assert.equal(denied.result.body.includes(SECRET), false);
  assert.equal(denied.result.body.includes("origin_auth"), false);
  assert.deepEqual(cfLines(denied.lines), [
    "cf_only reject mode=enforce reason=origin_auth path=/search hop=173.245.48.1",
  ]);
  assert.equal(cfLines(denied.lines).join("\n").includes(SECRET), false);
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.includes(SECRET), false);
  assert.equal(JSON.parse(health.body).cf_only.mode, "enforce");

  const allowed = await request("/search?q=z", {
    headers: passHeaders({ "x-et-origin-auth": ` ${SECRET} ` }),
  });
  assert.equal(allowed.status, 200);
});

test("reject log path drops the query and control characters and caps length", () => {
  const noisy = `/${"a".repeat(40)}\n${"b".repeat(40)}?q=${SECRET}${"c".repeat(200)}`;
  const line = formatCfRejectLine("report", { reason: "host", hop: "" }, noisy);
  assert.equal(line.includes("\n"), false);
  assert.equal(line.includes(SECRET), false);
  assert.equal(line.includes("?"), false);
  assert.ok(line.length < 280);
  const long = `/${"a".repeat(250)}`;
  assert.equal(
    formatCfRejectLine("enforce", { reason: "hop", hop: "203.0.113.5" }, long),
    `cf_only reject mode=enforce reason=hop path=${sanitizeCfPath(long)} hop=203.0.113.5`,
  );
  assert.equal(sanitizeCfPath(long).length, 200);
});

test("check() trustCf override is per call and omitted keeps the env switch", () => {
  process.env.ET_TRUST_CF_CONNECTING_IP = "off";
  process.env.TRUSTED_PROXY_HOPS = "1";
  const lim = createRateLimiter();
  const req = {
    method: "GET",
    url: "/search?q=a",
    headers: {
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.7",
    },
  };
  assert.equal(lim.check(req, "/search").allowed, true);
  assert.equal(lim.usage("203.0.113.10"), null);
  assert.equal(lim.usage("198.51.100.7").search, 1);
  assert.equal(lim.check(req, "/search", { trustCf: true }).allowed, true);
  assert.equal(lim.usage("203.0.113.10").search, 1);

  process.env.ET_TRUST_CF_CONNECTING_IP = "on";
  const on = createRateLimiter();
  assert.equal(on.check(req, "/search", { trustCf: false }).allowed, true);
  assert.equal(on.usage("203.0.113.10"), null);
  assert.equal(on.usage("198.51.100.7").search, 1);
  assert.equal(on.check(req, "/search").allowed, true);
  assert.equal(on.usage("203.0.113.10").search, 1);
});

test("report and enforce key a passing request on CF-Connecting-IP", async () => {
  for (const mode of ["report", "enforce"]) {
    enable(mode, "1");
    resetRateLimiter();
    for (let i = 0; i < 12; i++) {
      const res = await request("/search?q=z", {
        headers: passHeaders({ "cf-connecting-ip": "203.0.113.10" }),
      });
      assert.equal(res.status, 200, `${mode} ${i + 1}`);
    }
    const denied = await request("/search?q=z", {
      headers: passHeaders({ "cf-connecting-ip": "203.0.113.10" }),
    });
    assert.equal(denied.status, 429, mode);
    const other = await request("/search?q=z", {
      headers: passHeaders({ "cf-connecting-ip": "203.0.113.11" }),
    });
    assert.equal(other.status, 200, mode);
  }
});

test("exempt direct traffic does not key on a forged CF-Connecting-IP", async () => {
  enable("enforce", "1");
  process.env.ET_INTERNAL_BYPASS_TOKEN = INTERNAL;
  resetRateLimiter();
  for (let i = 0; i < 12; i++) {
    const res = await request("/search?q=z", {
      headers: {
        host: "127.0.0.1",
        "x-et-internal": INTERNAL,
        "cf-connecting-ip": `203.0.113.${i + 1}`,
        "x-forwarded-for": "198.51.100.40",
      },
    });
    assert.equal(res.status, 200, `exempt ${i + 1}`);
  }
  const shared = await request("/search?q=z", {
    headers: {
      host: "127.0.0.1",
      "x-et-internal": INTERNAL,
      "cf-connecting-ip": "198.51.100.99",
      "x-forwarded-for": "198.51.100.40",
    },
  });
  assert.equal(shared.status, 429);
  assert.equal(getRateLimiter().usage("198.51.100.99"), null);
  assert.equal(getRateLimiter().usage("203.0.113.1"), null);
  const otherHop = await request("/search?q=z", {
    headers: {
      host: "127.0.0.1",
      "x-et-internal": INTERNAL,
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.41",
    },
  });
  assert.equal(otherHop.status, 200);
  assert.equal(getRateLimiter().usage("198.51.100.41").search, 1);
});

test("mode off keeps the #225 CF-Connecting-IP key", async () => {
  delete process.env.ET_CF_ONLY;
  delete process.env.TRUSTED_PROXY_HOPS;
  resetRateLimiter();
  const first = await request("/search?q=z", {
    headers: { host: "127.0.0.1", "cf-connecting-ip": "203.0.113.30" },
  });
  assert.equal(first.status, 200);
  assert.equal(getRateLimiter().usage("203.0.113.30").search, 1);
  const plain = await request("/search?q=z", { headers: { host: "127.0.0.1" } });
  assert.equal(plain.status, 200);
  assert.equal(JSON.parse((await request("/api/health")).body).cf_only.mode, "off");

  process.env.ET_TRUST_CF_CONNECTING_IP = "off";
  process.env.TRUSTED_PROXY_HOPS = "1";
  resetRateLimiter();
  const hopped = await request("/search?q=z", {
    headers: {
      host: "127.0.0.1",
      "cf-connecting-ip": "203.0.113.30",
      "x-forwarded-for": "198.51.100.8",
    },
  });
  assert.equal(hopped.status, 200);
  assert.equal(getRateLimiter().usage("203.0.113.30"), null);
  assert.equal(getRateLimiter().usage("198.51.100.8").search, 1);
});

test("mention-queue and health are the HTTP paths; replication is not", async () => {
  enable("enforce", "0");
  process.env.MENTION_QUEUE_BOT_TOKEN = BOT;
  process.env.MENTION_QUEUE_WORKER_TOKEN = WORKER;
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  const preflight = await request("/api/mention-queue/preflight", {
    method: "POST",
    headers: { host: "127.0.0.1", authorization: `Bearer ${BOT}` },
    body: "",
  });
  assert.equal(preflight.status, 200);
  const pending = await request("/api/mention-queue/pending", {
    headers: { host: "127.0.0.1", authorization: `Bearer ${WORKER}` },
  });
  assert.equal(pending.status, 200);
  // Logical replication is a Postgres connection. It never reaches handle().
  assert.equal(decision("/api/health", { host: "127.0.0.1" }).exempt, "path");
});
