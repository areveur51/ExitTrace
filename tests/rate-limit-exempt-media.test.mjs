import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRateLimiter, isExemptPath, resetRateLimiter } from "../app/lib/rate-limit.mjs";
import { handle, resetRateLimiter as resetServerLimiter } from "../app/server.mjs";

// GET/HEAD /favicon.ico and /media/thumbs/<kind>/<stem>[.variant].(jpg|webp)
// skip the limiter. Nothing else changes: /search, POST /add, and other paths
// keep their buckets, and a POST to an exempt path is still counted.

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

after(() => {
  for (const [k, v] of Object.entries(PREV)) setEnv(k, v);
  resetRateLimiter();
  resetServerLimiter();
});

beforeEach(() => {
  process.env.ET_RL_GLOBAL = "120";
  process.env.ET_RL_SEARCH = "12";
  process.env.ET_RL_ADD = "5";
  process.env.ET_RL_WINDOW_MS = "60000";
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.ET_TRUST_CF_CONNECTING_IP;
  resetRateLimiter();
  resetServerLimiter();
});

function mockReq(url, { method = "GET", ip = "203.0.113.40", body = "" } = {}) {
  return {
    method,
    url,
    headers: { host: "127.0.0.1", "cf-connecting-ip": ip },
    socket: { remoteAddress: "127.0.0.1" },
    body,
  };
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = mockReq(url, opts);
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

// Slugs with no source file, so the thumb route answers 404 without rendering.
const THUMB = "/media/thumbs/people/zz-no-such-person.webp";
const HERO = "/media/thumbs/people/zz-no-such-person.hero.webp";

const EXEMPT_READS = [
  "/favicon.ico",
  THUMB,
  HERO,
  "/media/thumbs/people/zz-no-such-person.jpg",
  "/media/thumbs/people/zz-no-such-person.2x.jpg",
  "/media/thumbs/people/zz-no-such-person.2x.webp",
  "/media/thumbs/people/zz-no-such-person.card.webp",
  "/media/thumbs/people/zz-no-such-person.card2x.jpg",
  "/media/thumbs/agencies/zz-no-such-agency.webp",
  "/media/thumbs/dog-comms/zz-no-such-post.jpg",
  "/media/thumbs/people/ZZ-Upper.HERO.WEBP",
];

test("exempt table: each thumb shape and /favicon.ico for GET and HEAD", () => {
  for (const p of EXEMPT_READS) {
    for (const method of ["GET", "HEAD", "get", "head"]) {
      assert.equal(isExemptPath(p, method), true, `${method} ${p}`);
    }
  }
});

test("exempt table: same paths with a write method or no method stay counted", () => {
  for (const p of EXEMPT_READS) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", undefined, ""]) {
      assert.equal(isExemptPath(p, method), false, `${method} ${p}`);
    }
  }
});

const NOT_EXEMPT = [
  "/search",
  "/add",
  "/",
  "/tags/save-act",
  "/media/people/ron-wyden.jpg",
  "/media/agencies/fbi.png",
  "/media/thumbsevil/people/x.webp",
  "/media/thumbsX/people/x.webp",
  "/media/thumbs",
  "/media/thumbs/",
  "/media/thumbs/x.webp",
  "/media/thumbs/people/",
  "/media/thumbs/people/sub/x.webp",
  "/media/thumbs/people/x.webp/",
  "/media/thumbs/people/x.webp/extra",
  "/media/thumbs/people/x.png",
  "/media/thumbs/people/x.jpeg",
  "/media/thumbs/people/x.bogus.webp",
  "/media/thumbs/people/.x.webp",
  "/media/thumbs/people/-x.webp",
  "/media/thumbs/../search",
  "/media/thumbs/people/../../search",
  "/media/thumbs/%2e%2e/search",
  "/media/thumbs/%2E%2E/%2e%2e/search",
  "/media/thumbs/people/..%2f..%2fsearch.webp",
  "/media/thumbs/people/%2e%2e%2fx.webp",
  "/media/thumbs/people/x%2ewebp",
  "/media/thumbs/people/x.webp%00",
  "/media/thumbs/people/x.webp?p=7",
  "/media/thumbs/people/x.webp#frag",
  "/media/thumbs\\people\\x.webp",
  "//media/thumbs/people/x.webp",
  "/favicon.ico/",
  "/favicon.icox",
  "/favicon.ico?x=1",
  "/x/favicon.ico",
];

test("non-exempt neighbors, traversal, encoded, and querystring forms", () => {
  for (const p of NOT_EXEMPT) {
    for (const method of ["GET", "HEAD"]) {
      assert.equal(isExemptPath(p, method), false, `${method} ${p}`);
    }
  }
});

test("existing exemptions are unchanged and stay method-agnostic", () => {
  for (const p of ["/health", "/api/health", "/styles.css", "/app.js", "/empty-portrait.jpg", "/media/themes/glass-bg.webp"]) {
    assert.equal(isExemptPath(p), true, p);
    assert.equal(isExemptPath(p, "GET"), true, p);
    assert.equal(isExemptPath(p, "POST"), true, p);
  }
});

test("limiter.check: exempt thumbs do not touch any bucket; POST thumbs does", () => {
  const lim = createRateLimiter();
  const ip = "203.0.113.41";
  for (let i = 0; i < 130; i++) {
    const r = lim.check(mockReq(THUMB, { ip }), THUMB);
    assert.equal(r.allowed, true);
    assert.equal(r.exempt, true);
  }
  assert.equal(lim.usage(ip), null);
  const post = lim.check(mockReq(THUMB, { method: "POST", ip }), THUMB);
  assert.equal(post.exempt, undefined);
  assert.deepEqual(lim.usage(ip), { global: 1, search: 0, add: 0 });
  assert.equal(lim.limits.global, 120);
  assert.equal(lim.limits.search, 12);
  assert.equal(lim.limits.add, 5);
});

test("121+ thumb and favicon GETs never 429, while a normal page still trips at 121", async () => {
  for (let i = 0; i < 121; i++) {
    const r = await request(`${i % 2 ? HERO : THUMB}?p=7`);
    assert.notEqual(r.status, 429, `thumb ${i + 1}`);
  }
  for (let i = 0; i < 5; i++) {
    const head = await request(THUMB, { method: "HEAD" });
    assert.notEqual(head.status, 429, `head ${i + 1}`);
    const fav = await request("/favicon.ico");
    assert.notEqual(fav.status, 429, `favicon ${i + 1}`);
  }
  for (let i = 0; i < 120; i++) {
    const r = await request("/nope");
    assert.equal(r.status, 404, `page ${i + 1}`);
  }
  const denied = await request("/nope");
  assert.equal(denied.status, 429);
  assert.match(denied.body, /Too many requests\. Retry after \d+ seconds\./);
  assert.equal(denied.headers["ratelimit-limit"], "120");
  const thumbAfter = await request(`${HERO}?p=7`);
  assert.notEqual(thumbAfter.status, 429);
  const favAfter = await request("/favicon.ico");
  assert.notEqual(favAfter.status, 429);
});

test("POST to a thumb path or /favicon.ico is counted and trips global", async () => {
  for (let i = 0; i < 120; i++) {
    const p = i % 2 ? "/favicon.ico" : THUMB;
    const r = await request(p, { method: "POST" });
    assert.notEqual(r.status, 429, `post ${i + 1}`);
  }
  const denied = await request(THUMB, { method: "POST" });
  assert.equal(denied.status, 429);
});

test("/search is still limited at 12 after a thumb flood", async () => {
  for (let i = 0; i < 50; i++) await request(THUMB);
  for (let i = 0; i < 12; i++) {
    const r = await request("/search?q=z");
    assert.equal(r.status, 200, `search ${i + 1}`);
  }
  const denied = await request("/search?q=z");
  assert.equal(denied.status, 429);
  assert.equal(denied.headers["ratelimit-limit"], "12");
});

test("POST /add is still limited at 5 after a thumb flood", async () => {
  for (let i = 0; i < 50; i++) await request(THUMB);
  for (let i = 0; i < 5; i++) {
    const r = await request("/add", { method: "POST", body: "kind=person" });
    assert.notEqual(r.status, 429, `add ${i + 1}`);
  }
  const denied = await request("/add", { method: "POST", body: "kind=person" });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers["ratelimit-limit"], "5");
});

test("traversal through /media/thumbs/ resolves to /search and is search-limited", async () => {
  const forms = [
    "/media/thumbs/../../search?q=z",
    "/media/thumbs/%2e%2e/%2E%2e/search?q=z",
    "/media/thumbs/people/%2E%2E/../../search?q=z",
  ];
  for (let i = 0; i < 12; i++) {
    const r = await request(forms[i % forms.length]);
    assert.equal(r.status, 200, `traversal ${i + 1} should reach /search`);
  }
  for (const f of forms) {
    const denied = await request(f);
    assert.equal(denied.status, 429, f);
  }
});

test("encoded-slash and non-thumb media under /media/ stay on the global bucket", async () => {
  const forms = [
    "/media/thumbs/people/..%2f..%2fsearch.webp",
    "/media/thumbsevil/people/x.webp",
    "/media/people/zz-no-such-person.jpg",
    "/media/thumbs/people/zz%2dno-such-person.webp",
  ];
  for (let i = 0; i < 120; i++) {
    const r = await request(forms[i % forms.length]);
    assert.notEqual(r.status, 429, `media ${i + 1}`);
  }
  for (const f of forms) {
    const denied = await request(f);
    assert.equal(denied.status, 429, f);
  }
});
