import { isIP } from "node:net";
import { nonNegativeInt, positiveInt } from "./num.mjs";

/**
 * Client IP for rate limits, in this order:
 * 1. CF-Connecting-IP when ET_TRUST_CF_CONNECTING_IP is on (default).
 *    Cloudflare overwrites that header. A request that reaches the origin
 *    directly can forge it. When ET_CF_ONLY is report or enforce, the server
 *    passes trustCf from app/lib/cf-origin.mjs. Only a request that passed
 *    the whole CF check keeps this header. On Render, CF-Ray, CF-Connecting-IP,
 *    and the hop are hygiene. Host does the practical work. The origin secret
 *    is the real control. When ET_CF_ONLY is off, this switch alone applies.
 *    Off when the env value trims/lowercases to 0, false, off, or no.
 * 2. Rightmost X-Forwarded-For after TRUSTED_PROXY_HOPS (N-th from the
 *    right). Never leftmost — XFF is client-forgeable; CF and Render append.
 *    hops=0 (default) ignores XFF completely.
 * 3. "unknown". With no usable CF header and hops=0 (or not enough hops),
 *    every such request shares one dedicated "unknown" entry. That entry is
 *    not an LRU key and is not counted against maxKeys. Overflow IPs use it
 *    only when the per-IP map is full of live keys, so it never spends a
 *    CF-keyed or XFF-keyed client's own buckets. clientIp returns a
 *    normalized address or this sentinel, never an address whose text is
 *    "unknown".
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
const CF_OFF = new Set(["0", "false", "off", "no"]);

const EXEMPT_EXACT = new Set([
  "/health",
  "/api/health",
  "/styles.css",
  "/app.js",
  "/empty-portrait.jpg",
]);

function envPositive(name, fallback, env = process.env) {
  return positiveInt(env[name], fallback);
}

/**
 * GET/HEAD-only exemptions. These are cheap static reads that a single page
 * load can request dozens of times (a /tags page loads two thumbs per person).
 * Thumbs must match the derived-thumb shape exactly: one kind directory, one
 * stem, an optional known variant, and .jpg or .webp. No "%", no dot segment,
 * no extra directory, so a decoded or traversed path cannot match.
 * Callers pass the URL pathname (dot segments already resolved, no query).
 */
const EXEMPT_GET_EXACT = new Set(["/favicon.ico"]);
const EXEMPT_GET_THUMB =
  /^\/media\/thumbs\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*(?:\.(?:2x|card2x|card|hero))?\.(?:jpg|webp)$/i;

function isReadMethod(method) {
  const m = String(method || "").toUpperCase();
  return m === "GET" || m === "HEAD";
}

/**
 * True when the limiter skips this request.
 * method is optional. Without it only the method-agnostic exemptions apply;
 * /favicon.ico and /media/thumbs/* need GET or HEAD.
 */
export function isExemptPath(pathname, method) {
  const p = String(pathname || "");
  if (EXEMPT_EXACT.has(p)) return true;
  if (p.startsWith("/media/themes/")) return true;
  if (!isReadMethod(method)) return false;
  if (EXEMPT_GET_EXACT.has(p)) return true;
  return EXEMPT_GET_THUMB.test(p);
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
  // The limiter's shared bucket is the sentinel "unknown". Reject that word
  // before isIP so a parsed address can never be stored under the same key.
  if (s.toLowerCase() === "unknown") return "";
  if (!isIP(s)) return "";
  return s;
}

export function trustedProxyHops(value = process.env.TRUSTED_PROXY_HOPS) {
  if (value === undefined || value === null || value === "") return 0;
  return Math.min(HOPS_CAP, nonNegativeInt(value, 0));
}

/** Default on. Read at call time. */
export function trustCfConnectingIp(value = process.env.ET_TRUST_CF_CONNECTING_IP) {
  if (value === undefined || value === null || value === true) return true;
  if (value === false) return false;
  const s = String(value).trim().toLowerCase();
  if (!s) return true;
  return !CF_OFF.has(s);
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

/**
 * N-th X-Forwarded-For entry from the right, N = hops.
 * hops <= 0, a short list, or an unusable entry returns "".
 * Same clipping as before: last 1024 characters, last 20 entries.
 * Does not read socket.remoteAddress.
 */
export function xffHop(headers, hops) {
  const n = hops === undefined ? trustedProxyHops() : trustedProxyHops(hops);
  if (!(n > 0)) return "";
  const xff = headerRaw(headers, "x-forwarded-for");
  const raw = Array.isArray(xff) ? xff.join(",") : xff;
  if (!raw) return "";
  const clipped = raw.length > XFF_MAX_CHARS ? raw.slice(-XFF_MAX_CHARS) : raw;
  const parts = clipped
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(-XFF_MAX_ENTRIES);
  if (parts.length < n) return "";
  return normalizeIp(parts[parts.length - n]);
}

export function clientIp(req, { trustCf, trustedProxyHops: hopsOpt } = {}) {
  const headers = req?.headers;
  const trust = trustCf !== undefined ? trustCfConnectingIp(trustCf) : trustCfConnectingIp();
  if (trust) {
    const cf = normalizeIp(headerFirst(headers, "cf-connecting-ip"));
    if (cf) return cf;
  }

  const hops = hopsOpt !== undefined ? trustedProxyHops(hopsOpt) : trustedProxyHops();
  const fromXff = xffHop(headers, hops);
  if (fromXff) return fromXff;

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
  /**
   * One entry per charged IP. Map order is LRU by lastSeen.
   * lastSeen is the newest counted timestamp (denials do not refresh it).
   * Idle means every bucket is empty. A live entry's lastSeen is inside
   * the window, so if the front entry is not idle, no entry is idle.
   * "unknown" is not a key here. It is `unknownEntry` below: created with
   * the limiter, never evicted, and not counted against maxKeys.
   * size() reports this map only. Map size stays <= maxKeys, so the map
   * plus the dedicated unknown entry stays <= maxKeys + 1.
   * @type {Map<string, { lastSeen: number, times: { global: number[], search: number[], add: number[] } }>}
   */
  const store = new Map();

  function freshEntry(nowTs) {
    return {
      lastSeen: nowTs,
      times: { global: [], search: [], add: [] },
    };
  }

  /**
   * Shared bucket for clientIp() "unknown" and for overflow IPs when the
   * map is already full of live keys. Own counters. Never inserted, never evicted.
   */
  const unknownEntry = freshEntry(clock());

  function pruneEntry(entry, nowTs) {
    const cutoff = nowTs - win;
    for (const name of ["global", "search", "add"]) {
      const times = entry.times[name];
      let i = 0;
      while (i < times.length && times[i] <= cutoff) i += 1;
      if (i) times.splice(0, i);
    }
  }

  function isIdle(entry) {
    return (
      entry.times.global.length === 0 &&
      entry.times.search.length === 0 &&
      entry.times.add.length === 0
    );
  }

  function evictFrontIfIdle(nowTs) {
    const first = store.entries().next().value;
    if (!first) return false;
    const [key, entry] = first;
    pruneEntry(entry, nowTs);
    if (!isIdle(entry)) return false;
    store.delete(key);
    return true;
  }

  /** Free a per-IP slot. Unknown is outside the map, so size never exceeds cap. */
  function makeRoom(nowTs) {
    let guard = 0;
    while (store.size >= cap && guard < 2) {
      if (!evictFrontIfIdle(nowTs)) return;
      guard += 1;
    }
  }

  function takeLive(ip, nowTs) {
    const entry = store.get(ip);
    if (!entry) return null;
    pruneEntry(entry, nowTs);
    if (isIdle(entry)) {
      store.delete(ip);
      return null;
    }
    return entry;
  }

  function useUnknown(nowTs) {
    pruneEntry(unknownEntry, nowTs);
    return { key: "unknown", entry: unknownEntry };
  }

  function resolveEntry(ip, nowTs) {
    if (ip === "unknown") return useUnknown(nowTs);
    const live = takeLive(ip, nowTs);
    if (live) return { key: ip, entry: live };
    makeRoom(nowTs);
    if (store.size >= cap) return useUnknown(nowTs);
    const entry = freshEntry(nowTs);
    store.set(ip, entry);
    return { key: ip, entry };
  }

  function remember(key, entry, nowTs) {
    entry.lastSeen = nowTs;
    if (key === "unknown") return;
    store.delete(key);
    store.set(key, entry);
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

  /**
   * opts.trustCf, when set, overrides ET_TRUST_CF_CONNECTING_IP for this call.
   * Omitted leaves the #225 switch. cf-origin passes it only when ET_CF_ONLY
   * is report or enforce.
   */
  function check(req, pathname, opts) {
    const method = String(req?.method || "GET").toUpperCase();
    if (isExemptPath(pathname, method)) {
      return { allowed: true, exempt: true, limit: 0, remaining: 0, reset: 0, retryAfter: 0 };
    }
    const ipOpts = {};
    if (hopsOverride !== undefined) ipOpts.trustedProxyHops = hopsOverride;
    if (opts && opts.trustCf !== undefined) ipOpts.trustCf = opts.trustCf;
    const ip = clientIp(req, ipOpts);
    const nowTs = clock();
    const { key, entry } = resolveEntry(ip, nowTs);
    const buckets = applicableBuckets(method, pathname);
    const peeks = buckets.map((b) => {
      const times = entry.times[b.name];
      const count = times.length;
      return {
        ...b,
        count,
        remaining: Math.max(0, b.limit - count),
        denied: count >= b.limit,
        retryAfter: retryAfterSec(times, nowTs, win),
      };
    });
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
    for (const b of buckets) entry.times[b.name].push(nowTs);
    remember(key, entry, nowTs);
    const after = buckets.map((b) => {
      const times = entry.times[b.name];
      const count = times.length;
      return {
        ...b,
        count,
        remaining: Math.max(0, b.limit - count),
        retryAfter: retryAfterSec(times, nowTs, win),
      };
    });
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
    // Per-IP map entries only. The dedicated "unknown" bucket is not included.
    // Total tracked entries are size() + 1 and stay <= maxKeys + 1.
    size() {
      return store.size;
    },
    has(ip) {
      if (ip === "unknown") return true;
      return store.has(ip);
    },
    usage(ip) {
      const entry = ip === "unknown" ? unknownEntry : store.get(ip);
      if (!entry) return null;
      pruneEntry(entry, clock());
      return {
        global: entry.times.global.length,
        search: entry.times.search.length,
        add: entry.times.add.length,
      };
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
