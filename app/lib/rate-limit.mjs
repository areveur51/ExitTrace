import { BlockList, isIP } from "node:net";

/**
 * Render sits behind Cloudflare; XFF is client-controllable, so spoofing is only
 * a concern if someone hits the origin directly without CF — accepted for this
 * increment per design lock.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 10_000;
const DEFAULT_GLOBAL = 120;
const DEFAULT_SEARCH = 12;
const DEFAULT_ADD = 5;
const XFF_MAX_CHARS = 1024;
const XFF_MAX_ENTRIES = 20;

const PRIVATE = new BlockList();
const v4 = (...octets) => octets.join(".");
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet(v4(10, 0, 0, 0), 8, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet(v4(192, 168, 0, 0), 16, "ipv4");
PRIVATE.addSubnet(v4(100, 64, 0, 0), 10, "ipv4");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");

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

function isPublicIp(ip) {
  const v = isIP(ip);
  if (v === 4) return !PRIVATE.check(ip, "ipv4");
  if (v === 6) return !PRIVATE.check(ip, "ipv6");
  return false;
}

export function clientIp(req) {
  const hdr = req?.headers?.["x-forwarded-for"];
  if (hdr != null && hdr !== "") {
    const raw = Array.isArray(hdr) ? hdr.join(",") : String(hdr);
    const clipped = raw.length > XFF_MAX_CHARS ? raw.slice(0, XFF_MAX_CHARS) : raw;
    const parts = clipped.split(",").slice(0, XFF_MAX_ENTRIES);
    for (const part of parts) {
      const ip = normalizeIp(part);
      if (ip && isPublicIp(ip)) return ip;
    }
  }
  const sock = normalizeIp(
    req?.socket?.remoteAddress || req?.connection?.remoteAddress || "",
  );
  if (sock) return sock;
  return "unknown";
}

function retryAfterSec(times, nowTs, windowMs) {
  const oldest = times.length ? times[0] : nowTs;
  return Math.max(1, Math.ceil((oldest + windowMs - nowTs) / 1000));
}

export function createRateLimiter({ windowMs, maxKeys, now } = {}) {
  const win = positiveInt(windowMs, envPositive("ET_RL_WINDOW_MS", DEFAULT_WINDOW_MS));
  const cap = positiveInt(maxKeys, DEFAULT_MAX_KEYS);
  const clock = typeof now === "function" ? now : Date.now;
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
    const ip = clientIp(req);
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
