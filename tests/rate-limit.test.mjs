import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  clientIp,
  createRateLimiter,
  getRateLimiter,
  isExemptPath,
  normalizeIp,
  resetRateLimiter,
  trustCfConnectingIp,
  trustedProxyHops,
} from "../app/lib/rate-limit.mjs";
import { handle, resetRateLimiter as resetServerLimiter } from "../app/server.mjs";

const PREV = {
  ET_RL_GLOBAL: process.env.ET_RL_GLOBAL,
  ET_RL_SEARCH: process.env.ET_RL_SEARCH,
  ET_RL_ADD: process.env.ET_RL_ADD,
  ET_RL_WINDOW_MS: process.env.ET_RL_WINDOW_MS,
  TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
  ET_TRUST_CF_CONNECTING_IP: process.env.ET_TRUST_CF_CONNECTING_IP,
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
  delete process.env.ET_TRUST_CF_CONNECTING_IP;
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

test("memory bound: map size() stays <= maxKeys and total with unknown stays <= maxKeys + 1", () => {
  const maxKeys = 10;
  const lim = createRateLimiter({ maxKeys, windowMs: 60_000 });
  for (let i = 1; i <= 3 * maxKeys; i++) {
    const octet3 = Math.floor((i - 1) / 200);
    const octet4 = ((i - 1) % 200) + 1;
    const req = mockReq("/nope", { ip: `203.0.${octet3}.${octet4}` });
    lim.check(req, "/nope");
    // size() is per-IP map entries. The dedicated unknown bucket is the extra one.
    assert.ok(lim.size() <= maxKeys, `map size ${lim.size()} after ${i} ips`);
    assert.ok(lim.size() + 1 <= maxKeys + 1, `total ${lim.size() + 1} after ${i} ips`);
  }
  assert.equal(lim.size(), maxKeys);
  assert.equal(lim.size() + 1, maxKeys + 1);
  assert.equal(lim.has("unknown"), true);
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

test("rotating IPs past maxKeys share unknown and get no fresh allowance", () => {
  let now = 8_000_000;
  const maxKeys = 50;
  const lim = createRateLimiter({ maxKeys, windowMs: 60_000, now: () => now });
  for (let i = 1; i <= maxKeys; i++) {
    const ip = `203.0.113.${i}`;
    assert.equal(lim.check(mockReq("/nope", { ip }), "/nope").allowed, true);
    assert.ok(lim.size() <= maxKeys);
    assert.ok(lim.size() + 1 <= maxKeys + 1);
    assert.equal(lim.has(ip), true);
  }
  assert.equal(lim.size(), maxKeys);
  let allowed = 0;
  for (let i = 0; i < 1000; i++) {
    const ip = `198.51.${Math.floor(i / 200)}.${(i % 200) + 1}`;
    const decision = lim.check(mockReq("/nope", { ip }), "/nope");
    assert.ok(lim.size() <= maxKeys, `map size ${lim.size()} at rotated ${i}`);
    assert.ok(lim.size() + 1 <= maxKeys + 1, `total ${lim.size() + 1} at rotated ${i}`);
    assert.equal(lim.has(ip), false);
    if (decision.allowed) allowed += 1;
  }
  assert.equal(lim.size(), maxKeys);
  assert.equal(lim.size() + 1, maxKeys + 1);
  assert.equal(lim.has("unknown"), true);
  assert.equal(allowed, lim.limits.global);
  assert.equal(lim.usage("unknown").global, lim.limits.global);
  assert.equal(lim.usage("203.0.113.1").global, 1);
  const extra = lim.check(mockReq("/nope", { ip: "198.51.9.9" }), "/nope");
  assert.equal(extra.allowed, false);
  assert.equal(lim.has("198.51.9.9"), false);
  assert.equal(lim.size(), maxKeys);
  assert.equal(lim.usage("203.0.113.1").global, 1);
});

test("rotated IPs cannot flush a full search bucket or a partial one", () => {
  let now = 9_000_000;
  const lim = createRateLimiter({ maxKeys: 50, windowMs: 60_000, now: () => now });
  const abuser = "203.0.113.10";
  const victim = "203.0.113.11";
  for (let i = 0; i < lim.limits.search; i++) {
    assert.equal(lim.check(mockReq("/search?q=a", { ip: abuser }), "/search").allowed, true);
  }
  assert.equal(lim.check(mockReq("/search?q=a", { ip: abuser }), "/search").allowed, false);
  for (let i = 0; i < 3; i++) {
    assert.equal(lim.check(mockReq("/search?q=a", { ip: victim }), "/search").allowed, true);
  }
  const victimBefore = lim.usage(victim);
  assert.deepEqual(victimBefore, { global: 3, search: 3, add: 0 });
  assert.equal(lim.usage(abuser).search, lim.limits.search);

  let n = 1;
  while (lim.size() < 50) {
    const ip = `203.0.113.${n}`;
    n += 1;
    if (ip === abuser || ip === victim) continue;
    lim.check(mockReq("/nope", { ip }), "/nope");
  }
  assert.equal(lim.size(), 50);

  for (let i = 0; i < 1000; i++) {
    const ip = `198.51.${Math.floor(i / 200)}.${(i % 200) + 1}`;
    lim.check(mockReq("/nope", { ip }), "/nope");
    assert.ok(lim.size() <= 50);
    assert.ok(lim.size() + 1 <= 51);
    assert.equal(lim.has(ip), false);
  }
  assert.equal(lim.has(abuser), true);
  assert.equal(lim.has(victim), true);
  assert.deepEqual(lim.usage(victim), victimBefore);
  assert.equal(lim.usage(abuser).search, lim.limits.search);
  assert.equal(lim.check(mockReq("/search?q=a", { ip: abuser }), "/search").allowed, false);
  assert.deepEqual(lim.usage(victim), victimBefore);
  const victimNext = lim.check(mockReq("/search?q=a", { ip: victim }), "/search");
  assert.equal(victimNext.allowed, true);
  assert.equal(victimNext.remaining, lim.limits.search - 4);
});

test("idle keys are evicted oldest-first after the window", () => {
  let now = 1_000_000;
  const lim = createRateLimiter({ maxKeys: 3, windowMs: 1_000, now: () => now });
  for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
    now += 10;
    assert.equal(lim.check(mockReq("/nope", { ip }), "/nope").allowed, true);
  }
  assert.equal(lim.size(), 3);
  now += 1_000;
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.4" }), "/nope").allowed, true);
  assert.equal(lim.has("203.0.113.1"), false);
  assert.equal(lim.has("203.0.113.2"), true);
  assert.equal(lim.has("203.0.113.3"), true);
  assert.equal(lim.has("203.0.113.4"), true);
  assert.equal(lim.has("unknown"), true);
  assert.deepEqual(lim.usage("unknown"), { global: 0, search: 0, add: 0 });
  assert.equal(lim.size(), 3);
  assert.equal(lim.size() + 1, 4);
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.5" }), "/nope").allowed, true);
  assert.equal(lim.has("203.0.113.2"), false);
  assert.equal(lim.has("203.0.113.5"), true);
  assert.equal(lim.size(), 3);

  let now2 = 5_000_000;
  const lim2 = createRateLimiter({ maxKeys: 2, windowMs: 1_000, now: () => now2 });
  lim2.check(mockReq("/nope", { ip: "203.0.113.21" }), "/nope");
  lim2.check(mockReq("/nope", { ip: "203.0.113.22" }), "/nope");
  assert.equal(lim2.check(mockReq("/nope", { ip: "203.0.113.23" }), "/nope").allowed, true);
  assert.equal(lim2.has("203.0.113.23"), false);
  assert.equal(lim2.has("unknown"), true);
  assert.equal(lim2.size(), 2);
  assert.equal(lim2.size() + 1, 3);
  now2 += 1_000;
  assert.equal(lim2.check(mockReq("/nope", { ip: "203.0.113.24" }), "/nope").allowed, true);
  assert.equal(lim2.has("203.0.113.24"), true);
  assert.equal(lim2.has("203.0.113.23"), false);
});

test("a live key under its limit is not evicted", () => {
  let now = 2_000_000;
  const lim = createRateLimiter({ maxKeys: 2, windowMs: 60_000, now: () => now });
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.1" }), "/nope").allowed, true);
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.2" }), "/nope").allowed, true);
  assert.deepEqual(lim.usage("203.0.113.1"), { global: 1, search: 0, add: 0 });
  for (let i = 0; i < 30; i++) {
    const ip = `198.51.100.${i + 1}`;
    lim.check(mockReq("/nope", { ip }), "/nope");
    assert.equal(lim.has(ip), false);
  }
  assert.equal(lim.has("203.0.113.1"), true);
  assert.equal(lim.has("203.0.113.2"), true);
  assert.equal(lim.size(), 2);
  assert.equal(lim.size() + 1, 3);
  assert.equal(lim.usage("unknown").global, 30);
  assert.deepEqual(lim.usage("203.0.113.1"), { global: 1, search: 0, add: 0 });
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.1" }), "/nope").allowed, true);
  assert.deepEqual(lim.usage("203.0.113.1"), { global: 2, search: 0, add: 0 });
});

test("spoofed leftmost XFF does not change the CF bucket", async () => {
  const ip = "203.0.113.50";
  for (let i = 0; i < 12; i++) {
    const r = await request("/search?q=z", {
      ip,
      headers: { "x-forwarded-for": `${i}.1.1.1, 198.51.100.${i + 1}` },
    });
    assert.equal(r.status, 200, `search ${i + 1}`);
  }
  const denied = await request("/search?q=z", {
    ip,
    headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.99" },
  });
  assert.equal(denied.status, 429);
});

test("CF-Connecting-IP wins over X-Forwarded-For", async () => {
  const xff = "1.2.3.4, 198.51.100.8";
  for (let i = 0; i < 12; i++) {
    const r = await request("/search?q=z", {
      ip: "203.0.113.60",
      headers: { "x-forwarded-for": xff },
    });
    assert.equal(r.status, 200);
  }
  const otherCf = await request("/search?q=z", {
    ip: "203.0.113.61",
    headers: { "x-forwarded-for": xff },
  });
  assert.equal(otherCf.status, 200);
  const sameCf = await request("/search?q=z", {
    ip: "203.0.113.60",
    headers: { "x-forwarded-for": "8.8.8.8, 198.51.100.8" },
  });
  assert.equal(sameCf.status, 429);
  assert.equal(
    clientIp({
      headers: {
        "cf-connecting-ip": "203.0.113.60",
        "x-forwarded-for": "8.8.8.8, 198.51.100.8",
      },
    }),
    "203.0.113.60",
  );
});

test("hop skip uses the right side and too few entries are unknown", () => {
  const req = { headers: { "x-forwarded-for": "203.0.113.1, 203.0.113.2, 203.0.113.3" } };
  assert.equal(clientIp(req, { trustCf: false, trustedProxyHops: 1 }), "203.0.113.3");
  assert.equal(clientIp(req, { trustCf: false, trustedProxyHops: 2 }), "203.0.113.2");
  assert.equal(clientIp(req, { trustCf: false, trustedProxyHops: 0 }), "unknown");
  assert.equal(
    clientIp(
      { headers: { "x-forwarded-for": "203.0.113.9" } },
      { trustCf: false, trustedProxyHops: 2 },
    ),
    "unknown",
  );
});

test("same hops result shares a bucket when the leftmost XFF is forged", () => {
  process.env.ET_TRUST_CF_CONNECTING_IP = "off";
  process.env.TRUSTED_PROXY_HOPS = "1";
  const lim = createRateLimiter();
  for (let i = 0; i < 12; i++) {
    const req = {
      method: "GET",
      url: "/search?q=a",
      headers: { "x-forwarded-for": `1.2.3.${i}, 203.0.113.70` },
    };
    assert.equal(lim.check(req, "/search").allowed, true);
  }
  const denied = lim.check(
    {
      method: "GET",
      url: "/search?q=a",
      headers: { "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.70" },
    },
    "/search",
  );
  assert.equal(denied.allowed, false);
  const other = lim.check(
    {
      method: "GET",
      url: "/search?q=a",
      headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.71" },
    },
    "/search",
  );
  assert.equal(other.allowed, true);
});

test("ET_TRUST_CF_CONNECTING_IP defaults on and each off value ignores CF", () => {
  const req = {
    headers: {
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "6.6.6.6, 198.51.100.7",
    },
  };
  delete process.env.ET_TRUST_CF_CONNECTING_IP;
  delete process.env.TRUSTED_PROXY_HOPS;
  assert.equal(trustCfConnectingIp(), true);
  assert.equal(clientIp(req), "203.0.113.9");
  for (const off of ["0", "false", "off", "no", " FALSE ", "Off"]) {
    process.env.ET_TRUST_CF_CONNECTING_IP = off;
    assert.equal(trustCfConnectingIp(), false, off);
    process.env.TRUSTED_PROXY_HOPS = "0";
    assert.equal(clientIp(req), "unknown", off);
    process.env.TRUSTED_PROXY_HOPS = "1";
    assert.equal(clientIp(req), "198.51.100.7", off);
  }
});

test("clientIp trustCf override wins over the env switch", () => {
  const req = {
    headers: {
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "6.6.6.6, 198.51.100.7",
    },
  };
  process.env.ET_TRUST_CF_CONNECTING_IP = "off";
  process.env.TRUSTED_PROXY_HOPS = "1";
  assert.equal(clientIp(req, { trustCf: true }), "203.0.113.9");
  process.env.ET_TRUST_CF_CONNECTING_IP = "yes";
  assert.equal(clientIp(req, { trustCf: false, trustedProxyHops: 1 }), "198.51.100.7");
  assert.equal(clientIp(req, { trustCf: false, trustedProxyHops: 0 }), "unknown");
  assert.equal(clientIp(req, { trustCf: "no", trustedProxyHops: 1 }), "198.51.100.7");
});

test("trust switch off uses the XFF or unknown path", async () => {
  process.env.ET_TRUST_CF_CONNECTING_IP = "off";
  delete process.env.TRUSTED_PROXY_HOPS;
  resetRateLimiter();
  resetServerLimiter();
  for (let i = 0; i < 12; i++) {
    const r = await request("/search?q=z", { ip: `203.0.113.${i + 1}` });
    assert.equal(r.status, 200, `unknown shared ${i + 1}`);
  }
  const blocked = await request("/search?q=z", { ip: "198.51.100.9" });
  assert.equal(blocked.status, 429);

  process.env.TRUSTED_PROXY_HOPS = "1";
  resetRateLimiter();
  resetServerLimiter();
  for (let i = 0; i < 12; i++) {
    const r = await request("/search?q=z", {
      ip: "203.0.113.8",
      headers: { "x-forwarded-for": `10.1.1.${i}, 198.51.100.40` },
    });
    assert.equal(r.status, 200, `xff ${i + 1}`);
  }
  const xffBlocked = await request("/search?q=z", {
    ip: "198.51.100.8",
    headers: { "x-forwarded-for": "8.8.8.8, 198.51.100.40" },
  });
  assert.equal(xffBlocked.status, 429);
  const otherHop = await request("/search?q=z", {
    ip: "198.51.100.8",
    headers: { "x-forwarded-for": "8.8.8.8, 198.51.100.41" },
  });
  assert.equal(otherHop.status, 200);
});

function noCf(extra = {}) {
  return {
    ...extra,
    headers: { ...(extra.headers || {}), "cf-connecting-ip": "" },
  };
}

test("CF header text unknown is the shared bucket, not a per-IP key", () => {
  assert.equal(normalizeIp("unknown"), "");
  assert.equal(normalizeIp("UNKNOWN"), "");
  const lim = createRateLimiter({ windowMs: 60_000 });
  const forged = mockReq("/nope", { headers: { "cf-connecting-ip": "unknown" } });
  assert.equal(clientIp(forged), "unknown");
  assert.equal(lim.check(forged, "/nope").allowed, true);
  assert.equal(lim.size(), 0);
  assert.equal(lim.has("unknown"), true);
  assert.equal(lim.usage("unknown").global, 1);
  assert.equal(lim.has("203.0.113.10"), false);
});

test("exhausted unknown buckets 429 while a CF-keyed client still gets 200", async () => {
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.ET_TRUST_CF_CONNECTING_IP;
  resetRateLimiter();
  resetServerLimiter();
  assert.equal(trustedProxyHops(), 0);
  const lim = getRateLimiter();
  const cfIp = "203.0.113.77";

  for (let i = 0; i < lim.limits.search; i++) {
    const r = await request("/search?q=z", noCf());
    assert.equal(r.status, 200, `unknown search ${i + 1}`);
  }
  const searchDenied = await request("/search?q=z", noCf());
  assert.equal(searchDenied.status, 429);

  for (let i = 0; i < lim.limits.add; i++) {
    const r = await request("/add", noCf({ method: "POST", body: "kind=person" }));
    assert.equal(r.status, 200, `unknown add ${i + 1}`);
  }
  const addDenied = await request("/add", noCf({ method: "POST", body: "kind=person" }));
  assert.equal(addDenied.status, 429);

  const globalLeft = lim.limits.global - lim.usage("unknown").global;
  assert.ok(globalLeft > 0);
  for (let i = 0; i < globalLeft; i++) {
    const r = await request("/nope", noCf());
    assert.equal(r.status, 404, `unknown global ${i + 1}`);
  }
  const homeDenied = await request("/", noCf());
  assert.equal(homeDenied.status, 429);
  assert.deepEqual(lim.usage("unknown"), {
    global: lim.limits.global,
    search: lim.limits.search,
    add: lim.limits.add,
  });
  assert.equal(lim.usage(cfIp), null);
  assert.equal(lim.size(), 0);

  const home = await request("/", { ip: cfIp });
  assert.equal(home.status, 200);
  const search = await request("/search?q=z", { ip: cfIp });
  assert.equal(search.status, 200);
  const add = await request("/add", { method: "POST", body: "kind=person", ip: cfIp });
  assert.equal(add.status, 200);
  assert.deepEqual(lim.usage(cfIp), { global: 3, search: 1, add: 1 });
  assert.deepEqual(lim.usage("unknown"), {
    global: lim.limits.global,
    search: lim.limits.search,
    add: lim.limits.add,
  });
  assert.equal(lim.has(cfIp), true);
  assert.equal(lim.size(), 1);
  assert.ok(lim.size() + 1 <= lim.limits.maxKeys + 1);
});

test("overflow IPs exhaust unknown and do not touch live CF-keyed counts", () => {
  let now = 6_000_000;
  const maxKeys = 4;
  const lim = createRateLimiter({ maxKeys, windowMs: 60_000, now: () => now });
  const ips = ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"];
  for (const ip of ips) {
    assert.equal(lim.check(mockReq("/", { ip }), "/").allowed, true);
  }
  assert.equal(lim.size(), maxKeys);
  const before = {};
  for (const ip of ips) before[ip] = lim.usage(ip);

  let allowed = 0;
  for (let i = 0; i < lim.limits.global + 5; i++) {
    const ip = `198.51.${Math.floor(i / 200)}.${(i % 200) + 1}`;
    assert.equal(ips.includes(ip), false);
    const decision = lim.check(mockReq("/", { ip }), "/");
    assert.equal(lim.has(ip), false);
    assert.ok(lim.size() <= maxKeys);
    assert.ok(lim.size() + 1 <= maxKeys + 1);
    if (decision.allowed) allowed += 1;
  }
  assert.equal(allowed, lim.limits.global);
  assert.equal(lim.size(), maxKeys);
  assert.equal(lim.size() + 1, maxKeys + 1);
  assert.equal(lim.has("unknown"), true);
  assert.equal(lim.usage("unknown").global, lim.limits.global);

  for (const ip of ips) {
    assert.deepEqual(lim.usage(ip), before[ip]);
    assert.equal(lim.check(mockReq("/", { ip }), "/").allowed, true);
  }
  for (const ip of ips) {
    assert.deepEqual(lim.usage(ip), {
      global: before[ip].global + 1,
      search: 0,
      add: 0,
    });
  }
  assert.equal(lim.usage("unknown").global, lim.limits.global);
  const blocked = lim.check(mockReq("/", noCf()), "/");
  assert.equal(blocked.allowed, false);
  assert.equal(lim.usage("unknown").global, lim.limits.global);
  for (const ip of ips) {
    assert.equal(lim.usage(ip).global, before[ip].global + 1);
  }
});

test("unknown is never evicted when idle eviction runs", () => {
  let now = 4_000_000;
  const maxKeys = 2;
  const lim = createRateLimiter({ maxKeys, windowMs: 1_000, now: () => now });
  const unknownReq = mockReq("/nope", noCf());

  assert.equal(lim.has("unknown"), true);
  assert.equal(lim.size(), 0);
  assert.deepEqual(lim.usage("unknown"), { global: 0, search: 0, add: 0 });

  now = 4_000_000;
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.1" }), "/nope").allowed, true);
  now = 4_000_010;
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.2" }), "/nope").allowed, true);
  assert.equal(lim.size(), maxKeys);

  now = 4_001_200;
  assert.equal(lim.check(unknownReq, "/nope").allowed, true);
  assert.equal(lim.usage("unknown").global, 1);
  assert.equal(lim.size(), maxKeys);

  now = 4_001_210;
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.3" }), "/nope").allowed, true);
  assert.equal(lim.has("203.0.113.1"), false);
  assert.equal(lim.has("unknown"), true);
  assert.equal(lim.usage("unknown").global, 1);
  assert.ok(lim.size() <= maxKeys);
  assert.ok(lim.size() + 1 <= maxKeys + 1);

  now = 4_002_300;
  assert.equal(lim.check(mockReq("/nope", { ip: "203.0.113.4" }), "/nope").allowed, true);
  assert.equal(lim.has("unknown"), true);
  assert.deepEqual(lim.usage("unknown"), { global: 0, search: 0, add: 0 });
  assert.equal(lim.check(unknownReq, "/nope").allowed, true);
  assert.equal(lim.usage("unknown").global, 1);
  assert.ok(lim.size() <= maxKeys);
  assert.ok(lim.size() + 1 <= maxKeys + 1);
});
