import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  createRateLimiter,
  isExemptPath,
  noteThumbFailure,
  resetRateLimiter,
} from "../app/lib/rate-limit.mjs";
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
// Tracked thumbs (media/thumbs/agencies/atf.*), served 200 with no render.
const REAL = "/media/thumbs/agencies/atf.2x.webp";
const REAL_CARD = "/media/thumbs/agencies/atf.card.jpg";
const LONG_OK = `/media/thumbs/people/${"a".repeat(200)}.webp`;
const LONG_BAD = `/media/thumbs/people/${"a".repeat(201)}.webp`;

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
  "/media/thumbs/shot-comms/zz-no-such-post.card.webp",
  LONG_OK,
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
  // Worf F1/F3/F4 and O'Brien R1: case, kind list, stem cap, raw pathname.
  "/media/thumbs/zzkind/x.webp",
  "/media/thumbs/central-casting-comms/x.webp",
  "/media/thumbs/People/x.webp",
  "/media/thumbs/people/ZZ-Upper.HERO.WEBP",
  "/media/thumbs/people/x.WEBP",
  "/media/thumbs/people/x.Hero.webp",
  "/media/thumbs/people/x.webp;a=1",
  "/media/thumbs/people//x.webp",
  "/media/thumbs//people/x.webp",
  "/media/thumbs/people/zz%2dno-such-person.webp",
  LONG_BAD,
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
  assert.equal((await request(REAL)).status, 200, "tracked thumb is served");
  for (let i = 0; i < 121; i++) {
    const r = await request(`${i % 2 ? REAL_CARD : REAL}?p=7`);
    assert.notEqual(r.status, 429, `thumb ${i + 1}`);
  }
  for (let i = 0; i < 5; i++) {
    const head = await request(REAL, { method: "HEAD" });
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
  const thumbAfter = await request(`${REAL}?p=7`);
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

test("limiter.check: a missing method fails closed and still meters /search", () => {
  const lim = createRateLimiter();
  const ip = "203.0.113.42";
  const noMethod = (url) => ({ ...mockReq(url, { ip }), method: undefined });
  const r = lim.check(noMethod(THUMB), THUMB);
  assert.equal(r.exempt, undefined);
  assert.deepEqual(lim.usage(ip), { global: 1, search: 0, add: 0 });
  lim.check(noMethod("/favicon.ico"), "/favicon.ico");
  lim.check(noMethod("/search"), "/search");
  assert.deepEqual(lim.usage(ip), { global: 3, search: 1, add: 0 });
});

test("F2: a thumb that failed loses its exemption for 60 s, per kind/stem/variant/format", () => {
  const t0 = 5_000_000;
  assert.equal(isExemptPath(THUMB, "GET", t0), true);
  noteThumbFailure(THUMB, t0);
  assert.equal(isExemptPath(THUMB, "GET", t0 + 1), false);
  assert.equal(isExemptPath(THUMB, "HEAD", t0 + 59_999), false);
  assert.equal(isExemptPath(HERO, "GET", t0 + 1), true, "other variant keeps its exemption");
  assert.equal(isExemptPath(THUMB, "GET", t0 + 60_000), true, "expires after the TTL");
  noteThumbFailure("/search", t0);
  assert.equal(isExemptPath("/search", "GET", t0), false);
  noteThumbFailure(HERO);
  assert.equal(isExemptPath(HERO, "GET"), false);
  resetRateLimiter();
  assert.equal(isExemptPath(HERO, "GET"), true, "reset clears failures");
});

test("F2 end to end: a missing thumb is free once, then repeats are counted", async () => {
  const first = await request(THUMB);
  assert.equal(first.status, 404);
  for (let i = 0; i < 120; i++) {
    const r = await request(THUMB);
    assert.equal(r.status, 404, `repeat ${i + 1}`);
  }
  const denied = await request(THUMB);
  assert.equal(denied.status, 429);
  const real = await request(REAL);
  assert.equal(real.status, 200, "a good thumb stays exempt");
});

// Worf F5: each near-miss form goes through handle() and is counted.
const COUNTED_FORMS = [
  ["uppercase", "/media/thumbs/agencies/ATF.2x.webp", "GET"],
  ["uppercase ext", "/media/thumbs/agencies/atf.2x.WEBP", "GET"],
  ["double slash", "/media/thumbs//agencies/atf.2x.webp", "GET"],
  ["leading //", "//media/thumbs/agencies/atf.2x.webp", "GET"],
  [";params", "/media/thumbs/agencies/atf.2x.webp;a=1", "GET"],
  ["OPTIONS", REAL, "OPTIONS"],
  ["unknown kind", "/media/thumbs/zzkind/atf.2x.webp", "GET"],
  ["overlong name", LONG_BAD, "GET"],
];

for (const [label, url, method] of COUNTED_FORMS) {
  test(`F5 handle(): ${label} is counted and trips global at 121`, async () => {
    for (let i = 0; i < 120; i++) {
      const r = await request(url, { method });
      assert.notEqual(r.status, 429, `${label} ${i + 1}`);
    }
    const denied = await request(url, { method });
    assert.equal(denied.status, 429, label);
    assert.equal(denied.headers["ratelimit-limit"], "120");
  });
}
