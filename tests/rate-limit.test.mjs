import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  clientIp,
  createRateLimiter,
  isExemptPath,
  resetRateLimiter,
  trustedProxyHops,
} from "../app/lib/rate-limit.mjs";
import { handle, resetRateLimiter as resetServerLimiter } from "../app/server.mjs";

const PREV = {
  ET_RL_GLOBAL: process.env.ET_RL_GLOBAL,
  ET_RL_SEARCH: process.env.ET_RL_SEARCH,
  ET_RL_ADD: process.env.ET_RL_ADD,
  ET_RL_WINDOW_MS: process.env.ET_RL_WINDOW_MS,
  TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
};

function setEnv(name, value) {
  if (value == null) delete process.env[name];
  else process.env[name] = String(value);
}

function restoreEnv() {
  for (const [k, v] of Object.entries(PREV)) setEnv(k, v);
  resetRateLimiter();
  resetServerLimiter();
}

function applyDefaultLimits() {
  process.env.ET_RL_GLOBAL = "120";
  process.env.ET_RL_SEARCH = "12";
  process.env.ET_RL_ADD = "5";
  process.env.ET_RL_WINDOW_MS = "60000";
  delete process.env.TRUSTED_PROXY_HOPS;
  resetRateLimiter();
  resetServerLimiter();
}

after(() => {
  restoreEnv();
});

beforeEach(() => {
  applyDefaultLimits();
});

function mockReq(pathname, { method = "GET", headers = {}, ip = "203.0.113.10", body = "" } = {}) {
  return {
    method,
    url: pathname,
    headers: { host: "127.0.0.1", "cf-connecting-ip": ip, ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    body,
  };
}

function request(pathname, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = mockReq(pathname, opts);
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
        for (const [k, v] of Object.entries(hdrs || {})) {
          this.headers[String(k).toLowerCase()] = String(v);
        }
      },
      end(chunk) {
        if (chunk) chunks.push(chunk);
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("global 120 limit denies the 121st request", async () => {
  const lim = createRateLimiter();
  const req = mockReq("/nope");
  for (let i = 0; i < 120; i++) {
    const r = lim.check(req, "/nope");
    assert.equal(r.allowed, true, `hit ${i + 1} should be allowed`);
  }
  const denied = lim.check(req, "/nope");
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfter >= 1);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.limit, 120);
});

test("search 12 then 13th is 429 with Retry-After via handle()", async () => {
  for (let i = 0; i < 12; i++) {
    const r = await request("/search?q=z");
    assert.equal(r.status, 200, `search ${i + 1}`);
  }
  const denied = await request("/search?q=z");
  assert.equal(denied.status, 429);
  assert.match(denied.headers["content-type"], /text\/plain/);
  assert.match(denied.body, /Too many requests\. Retry after \d+ seconds\./);
  assert.ok(Number(denied.headers["retry-after"]) >= 1);
  assert.equal(denied.headers["ratelimit-remaining"], "0");
  assert.ok(denied.headers["ratelimit-limit"]);
  assert.ok(denied.headers["ratelimit-reset"]);
  const other = await request("/search?q=z", { ip: "203.0.113.11" });
  assert.equal(other.status, 200);
});

test("add 5 then 6th POST /add is 429 with RateLimit headers via handle()", async () => {
  for (let i = 0; i < 5; i++) {
    const r = await request("/add", { method: "POST", body: "kind=person" });
    assert.notEqual(r.status, 429, `add ${i + 1}`);
  }
  const denied = await request("/add", { method: "POST", body: "kind=person" });
  assert.equal(denied.status, 429);
  assert.match(denied.body, /Too many requests\. Retry after \d+ seconds\./);
  assert.ok(Number(denied.headers["retry-after"]) >= 1);
  assert.equal(denied.headers["ratelimit-remaining"], "0");
  assert.ok(denied.headers["ratelimit-limit"]);
  assert.ok(denied.headers["ratelimit-reset"]);
  const other = await request("/add", { method: "POST", body: "kind=person", ip: "203.0.113.11" });
  assert.notEqual(other.status, 429);
});

test("health, /api/health, /styles.css, /app.js exempt after limit hit", async () => {
  for (let i = 0; i < 120; i++) {
    const r = await request("/nope");
    assert.equal(r.status, 404);
  }
  const blocked = await request("/nope");
  assert.equal(blocked.status, 429);

  const health = await request("/health");
  assert.equal(health.status, 200);
  const api = await request("/api/health");
  assert.equal(api.status, 200);
  const css = await request("/styles.css");
  assert.equal(css.status, 200);
  const js = await request("/app.js");
  assert.equal(js.status, 200);
  const portrait = await request("/empty-portrait.jpg");
  assert.equal(portrait.status, 200);
  const theme = await request("/media/themes/glass-bg.webp");
  assert.equal(theme.status, 200);
  assert.equal(isExemptPath("/health"), true);
  assert.equal(isExemptPath("/media/themes/glass-bg.webp"), true);
  assert.equal(isExemptPath("/search"), false);
});

test("window reset via injected clock", () => {
  let now = 1_000_000;
  const lim = createRateLimiter({ windowMs: 1_000, now: () => now });
  const req = mockReq("/nope");
  for (let i = 0; i < 120; i++) assert.equal(lim.check(req, "/nope").allowed, true);
  assert.equal(lim.check(req, "/nope").allowed, false);
  now += 1_000;
  assert.equal(lim.check(req, "/nope").allowed, true);
});

test("memory bound: size() never exceeds maxKeys", () => {
  const maxKeys = 10;
  const lim = createRateLimiter({ maxKeys, windowMs: 60_000 });
  for (let i = 1; i <= 3 * maxKeys; i++) {
    const octet3 = Math.floor((i - 1) / 200);
    const octet4 = ((i - 1) % 200) + 1;
    const req = mockReq("/nope", { ip: `203.0.${octet3}.${octet4}` });
    lim.check(req, "/nope");
    assert.ok(lim.size() <= maxKeys, `size ${lim.size()} after ${i} ips`);
  }
  assert.ok(lim.size() <= maxKeys);
});

test("clientIp uses CF-Connecting-IP, then rightmost XFF by hops, never socket", () => {
  assert.equal(
    clientIp({
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "6.6.6.6, 8.8.8.8",
      },
    }, { trustedProxyHops: 1 }),
    "203.0.113.9",
  );
  assert.equal(
    clientIp({ headers: { "cf-connecting-ip": "1.2.3.4:5678" } }),
    "1.2.3.4",
  );
  assert.equal(
    clientIp({ headers: { "cf-connecting-ip": "[2001:db8::1]:80" } }),
    "2001:db8::1",
  );
  assert.equal(
    clientIp({ headers: { "cf-connecting-ip": "::ffff:8.8.8.8" } }),
    "8.8.8.8",
  );
  assert.equal(
    clientIp({ headers: { "cf-connecting-ip": ["203.0.113.8", "1.1.1.1"] } }),
    "203.0.113.8",
  );
  assert.equal(
    clientIp({
      headers: {
        "cf-connecting-ip": "nope",
        "x-forwarded-for": "6.6.6.6, 203.0.113.5",
      },
    }, { trustedProxyHops: 1 }),
    "203.0.113.5",
  );

  const xff = { headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.2, 203.0.113.5" } };
  assert.equal(clientIp(xff, { trustedProxyHops: 0 }), "unknown");
  assert.equal(clientIp(xff, { trustedProxyHops: 1 }), "203.0.113.5");
  assert.equal(clientIp(xff, { trustedProxyHops: 2 }), "198.51.100.2");
  assert.equal(
    clientIp(
      { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.5" } },
      { trustedProxyHops: 1 },
    ),
    "203.0.113.5",
  );
  assert.equal(
    clientIp({ headers: { "x-forwarded-for": "1.2.3.4" } }, { trustedProxyHops: 2 }),
    "unknown",
  );
  assert.equal(
    clientIp(
      { headers: { "x-forwarded-for": "1.2.3.4, not-an-ip" } },
      { trustedProxyHops: 1 },
    ),
    "unknown",
  );
  assert.equal(
    clientIp({ headers: {}, socket: { remoteAddress: "9.9.9.9" } }),
    "unknown",
  );

  const pad = `${"8.8.8.8, ".repeat(150)}6.6.6.6, 203.0.113.44`;
  assert.ok(pad.length > 1024);
  assert.equal(
    clientIp({ headers: { "x-forwarded-for": pad } }, { trustedProxyHops: 1 }),
    "203.0.113.44",
  );
  assert.equal(
    clientIp({ headers: { "x-forwarded-for": pad } }, { trustedProxyHops: 2 }),
    "6.6.6.6",
  );
});

test("TRUSTED_PROXY_HOPS env parsing", () => {
  const xffReq = {
    headers: { "x-forwarded-for": "198.51.100.1, 198.51.100.2, 203.0.113.5" },
  };
  delete process.env.TRUSTED_PROXY_HOPS;
  assert.equal(trustedProxyHops(), 0);
  assert.equal(clientIp(xffReq), "unknown");
  process.env.TRUSTED_PROXY_HOPS = "0";
  assert.equal(trustedProxyHops(), 0);
  assert.equal(clientIp(xffReq), "unknown");
  process.env.TRUSTED_PROXY_HOPS = "2";
  assert.equal(trustedProxyHops(), 2);
  assert.equal(clientIp(xffReq), "198.51.100.2");
  process.env.TRUSTED_PROXY_HOPS = "-1";
  assert.equal(trustedProxyHops(), 0);
  assert.equal(clientIp(xffReq), "unknown");
  process.env.TRUSTED_PROXY_HOPS = "abc";
  assert.equal(trustedProxyHops(), 0);
  assert.equal(clientIp(xffReq), "unknown");
});

test("env overrides and invalid env fallback", () => {
  process.env.ET_RL_GLOBAL = "3";
  process.env.ET_RL_SEARCH = "2";
  process.env.ET_RL_ADD = "1";
  process.env.ET_RL_WINDOW_MS = "5000";
  const over = createRateLimiter();
  assert.equal(over.limits.global, 3);
  assert.equal(over.limits.search, 2);
  assert.equal(over.limits.add, 1);
  assert.equal(over.limits.windowMs, 5000);
  const req = mockReq("/nope");
  assert.equal(over.check(req, "/nope").allowed, true);
  assert.equal(over.check(req, "/nope").allowed, true);
  assert.equal(over.check(req, "/nope").allowed, true);
  assert.equal(over.check(req, "/nope").allowed, false);

  process.env.ET_RL_GLOBAL = "0";
  process.env.ET_RL_SEARCH = "-1";
  process.env.ET_RL_ADD = "nope";
  process.env.ET_RL_WINDOW_MS = "";
  const fallback = createRateLimiter();
  assert.equal(fallback.limits.global, 120);
  assert.equal(fallback.limits.search, 12);
  assert.equal(fallback.limits.add, 5);
  assert.equal(fallback.limits.windowMs, 60_000);
});

test("denied requests do not consume", () => {
  process.env.ET_RL_GLOBAL = "3";
  process.env.ET_RL_SEARCH = "2";
  const lim = createRateLimiter();
  const req = mockReq("/search?q=a");
  assert.equal(lim.check(req, "/search").allowed, true);
  assert.equal(lim.check(req, "/search").allowed, true);
  assert.equal(lim.check(req, "/search").allowed, false);
  assert.equal(lim.check(req, "/search").allowed, false);
  const home = mockReq("/");
  assert.equal(lim.check(home, "/").allowed, true);
  assert.equal(lim.check(home, "/").allowed, false);
});
