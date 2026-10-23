import { isIP } from "node:net";

/**
 * Client IP for rate limits, in this order:
 * 1. CF-Connecting-IP (Cloudflare overwrites it). Trusted only because
 *    production traffic arrives via Cloudflare; a request that reaches the
 *    origin directly can forge that header (best-effort; origin lock-down
 *    to CF is a follow-up).
 * 2. Rightmost X-Forwarded-For after TRUSTED_PROXY_HOPS (N-th from the
 *    right). Never leftmost — XFF is client-forgeable; CF and Render append.
 *    hops=0 (default) ignores XFF completely.
 * 3. "unknown". With no CF header and hops=0 (or not enough hops), every
 *    such request shares the single "unknown" bucket, so the limits apply
 *    to all of that traffic combined (lab direct hits, or origin hits that
 *    bypass Cloudflare).
 * Do not fall back to socket.remoteAddress — that fallback is being
 * reconciled between Riker and Worf.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 10_000;
const DEFAULT_GLOBAL = 120;
const DEFAULT_SEARCH = 12;
const DEFAULT_ADD = 5;
const XFF_MAX_CHARS = 1024;
const XFF_MAX_ENTRIES = 20;
const HOPS_CAP = 10;

const EXEMPT_EXACT = new Set([
  "/health",
  "/api/health",
  "/styles.css",
  "/app.js",
  "/empty-portrait.jpg",
]);

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function envPositive(name, fallback, env = process.env) {
  return positiveInt(env[name], fallback);
}

export function isExemptPath(pathname) {
  const p = String(pathname || "");
  if (EXEMPT_EXACT.has(p)) return true;
  return p.startsWith("/media/themes/");
}

export function normalizeIp(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end !== -1) s = s.slice(1, end);
  } else {
    const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
    const m = s.match(v4port);
    if (m) s = m[1];
  }
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) s = mapped[1];
  if (!isIP(s)) return "";
  return s;
}

export function trustedProxyHops(value = process.env.TRUSTED_PROXY_HOPS) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(HOPS_CAP, Math.floor(n));
}

function headerRaw(headers, name) {
  const v = headers?.[name];
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v;
  return String(v);
}

function headerFirst(headers, name) {
  const v = headerRaw(headers, name);
  if (Array.isArray(v)) return String(v[0] ?? "");
  return v;
}

export function clientIp(req, { trustedProxyHops: hopsOpt } = {}) {
  const headers = req?.headers;
  const cf = normalizeIp(headerFirst(headers, "cf-connecting-ip"));
  if (cf) return cf;

  const hops = hopsOpt !== undefined ? trustedProxyHops(hopsOpt) : trustedProxyHops();
  if (hops > 0) {
    const xff = headerRaw(headers, "x-forwarded-for");
    const raw = Array.isArray(xff) ? xff.join(",") : xff;
    if (raw) {
      const clipped = raw.length > XFF_MAX_CHARS ? raw.slice(-XFF_MAX_CHARS) : raw;
      const parts = clipped
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(-XFF_MAX_ENTRIES);
      if (parts.length >= hops) {
        const ip = normalizeIp(parts[parts.length - hops]);
        if (ip) return ip;
      }
    }
  }

  // Do not fall back to socket.remoteAddress — that fallback is being
  // reconciled between Riker and Worf.
  return "unknown";
}

function retryAfterSec(times, nowTs, windowMs) {
  const oldest = times.length ? times[0] : nowTs;
  return Math.max(1, Math.ceil((oldest + windowMs - nowTs) / 1000));
}

export function createRateLimiter({ windowMs, maxKeys, now, trustedProxyHops: hopsOpt } = {}) {
  const win = positiveInt(windowMs, envPositive("ET_RL_WINDOW_MS", DEFAULT_WINDOW_MS));
  const cap = positiveInt(maxKeys, DEFAULT_MAX_KEYS);
  const clock = typeof now === "function" ? now : Date.now;
  const hopsOverride = hopsOpt !== undefined ? trustedProxyHops(hopsOpt) : undefined;
  const limits = {
    global: envPositive("ET_RL_GLOBAL", DEFAULT_GLOBAL),
    search: envPositive("ET_RL_SEARCH", DEFAULT_SEARCH),
    add: envPositive("ET_RL_ADD", DEFAULT_ADD),
  };
  /** @type {Map<string, { times: number[] }>} */
  const store = new Map();
  const sweepEvery = Math.max(1000, win / 10);
  let lastSweep = Number.NEGATIVE_INFINITY;

  function prune(entry, nowTs) {
    const cutoff = nowTs - win;
    const times = entry.times;
    let i = 0;
    while (i < times.length && times[i] <= cutoff) i += 1;
    if (i) times.splice(0, i);
  }

  function ensureCapacity() {
    if (store.size < cap) return;
    const nowTs = clock();
    if (nowTs - lastSweep >= sweepEvery) {
      lastSweep = nowTs;
      for (const [key, entry] of store) {
        prune(entry, nowTs);
        if (entry.times.length === 0) store.delete(key);
      }
    }
    while (store.size >= cap) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  function peek(bucket, ip, limit, nowTs) {
    const key = `${bucket}:${ip}`;
    const entry = store.get(key);
    if (!entry) {
      return { key, count: 0, remaining: limit, denied: false, retryAfter: 1 };
    }
    prune(entry, nowTs);
    const count = entry.times.length;
    const denied = count >= limit;
    return {
      key,
      count,
      remaining: Math.max(0, limit - count),
      denied,
      retryAfter: retryAfterSec(entry.times, nowTs, win),
    };
  }

  function take(bucket, ip, limit, nowTs) {
    const key = `${bucket}:${ip}`;
    let entry = store.get(key);
    if (!entry) {
      ensureCapacity();
      entry = { times: [] };
      store.set(key, entry);
    }
    prune(entry, nowTs);
    if (entry.times.length < limit) entry.times.push(nowTs);
  }

  function applicableBuckets(method, pathname) {
    const buckets = [{ name: "global", limit: limits.global }];
    if ((method === "GET" || method === "HEAD") && pathname === "/search") {
      buckets.push({ name: "search", limit: limits.search });
    }
    if (method === "POST" && pathname === "/add") {
      buckets.push({ name: "add", limit: limits.add });
    }
    return buckets;
  }

  function check(req, pathname) {
    if (isExemptPath(pathname)) {
      return { allowed: true, exempt: true, limit: 0, remaining: 0, reset: 0, retryAfter: 0 };
    }
    const method = String(req?.method || "GET").toUpperCase();
    const ip = clientIp(
      req,
      hopsOverride !== undefined ? { trustedProxyHops: hopsOverride } : {},
    );
    const nowTs = clock();
    const buckets = applicableBuckets(method, pathname);
    const peeks = buckets.map((b) => ({
      ...b,
      ...peek(b.name, ip, b.limit, nowTs),
    }));
    const denying = peeks.filter((p) => p.denied);
    if (denying.length) {
      const retryAfter = Math.max(1, ...denying.map((d) => d.retryAfter));
      let worst = denying[0];
      for (const d of denying) {
        if (d.retryAfter > worst.retryAfter) worst = d;
      }
      return {
        allowed: false,
        retryAfter,
        limit: worst.limit,
        remaining: 0,
        reset: retryAfter,
      };
    }
    for (const b of buckets) take(b.name, ip, b.limit, nowTs);
    const after = buckets.map((b) => ({
      ...b,
      ...peek(b.name, ip, b.limit, nowTs),
    }));
    let tightest = after[0];
    for (const row of after) {
      if (row.remaining < tightest.remaining) tightest = row;
    }
    return {
      allowed: true,
      retryAfter: 0,
      limit: tightest.limit,
      remaining: tightest.remaining,
      reset: tightest.retryAfter,
    };
  }

  return {
    check,
    size() {
      return store.size;
    },
    limits: { ...limits, windowMs: win, maxKeys: cap },
  };
}

let sharedLimiter = null;

export function getRateLimiter() {
  if (!sharedLimiter) sharedLimiter = createRateLimiter();
  return sharedLimiter;
}

export function resetRateLimiter() {
  sharedLimiter = createRateLimiter();
  return sharedLimiter;
}
