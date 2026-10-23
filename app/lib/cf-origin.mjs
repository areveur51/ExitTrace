/**
 * App-side Cloudflare-only origin check.
 * Env is read at call time. ET_CF_ONLY=off is a no-op (rollback is a restart).
 * The proxy hop is xffHop from rate-limit.mjs. The socket address is not read.
 * Secrets (ET_CF_ORIGIN_SECRET, ET_INTERNAL_BYPASS_TOKEN) are compared and dropped.
 * They are not logged, not returned, and not copied onto errors.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mentionRole } from "./mention-queue.mjs";
import {
  normalizeIp,
  trustCfConnectingIp,
  trustedProxyHops,
  xffHop,
} from "./rate-limit.mjs";

const RANGES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "cloudflare-ips.json",
);

const DEFAULT_HOSTS = ["exittrace.areveur.com"];
const DEFAULT_EXEMPT = ["/health", "/api/health"];
const PATH_CAP = 200;

function loadRanges(file = RANGES_PATH) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.ipv4) || !Array.isArray(parsed.ipv6)) {
    throw new Error("cloudflare-ips.json is missing ipv4 or ipv6 lists");
  }
  return {
    v4: parsed.ipv4.map(compileV4),
    v6: parsed.ipv6.map(compileV6),
  };
}

function compileV4(cidr) {
  const [addr, bitsRaw] = String(cidr).split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32 || String(bits) !== bitsRaw) {
    throw new Error(`bad cloudflare ipv4 cidr: ${cidr}`);
  }
  const ip = ipv4ToInt(addr);
  if (ip == null) throw new Error(`bad cloudflare ipv4 cidr: ${cidr}`);
  const mask = v4Mask(bits);
  return { network: (ip & mask) >>> 0, mask };
}

function compileV6(cidr) {
  const [addr, bitsRaw] = String(cidr).split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 128 || String(bits) !== bitsRaw) {
    throw new Error(`bad cloudflare ipv6 cidr: ${cidr}`);
  }
  const ip = ipv6ToBigInt(addr);
  if (ip == null) throw new Error(`bad cloudflare ipv6 cidr: ${cidr}`);
  const mask = v6Mask(bits);
  return { network: ip & mask, mask };
}

function v4Mask(bits) {
  if (bits <= 0) return 0;
  if (bits >= 32) return 0xffffffff;
  return (0xffffffff << (32 - bits)) >>> 0;
}

function v6Mask(bits) {
  if (bits <= 0) return 0n;
  if (bits >= 128) return (1n << 128n) - 1n;
  return ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
}

function ipv4ToInt(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = (n * 256 + octet) >>> 0;
  }
  return n;
}

function ipv6ToBigInt(input) {
  let s = String(input).trim().toLowerCase();
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end === -1) return null;
    s = s.slice(1, end);
  }
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (s.includes(".")) {
    const last = s.lastIndexOf(":");
    const oct = s.slice(last + 1).split(".");
    if (oct.length !== 4) return null;
    const nums = oct.map((part) => Number(part));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((nums[0] << 8) | nums[1]).toString(16);
    const lo = ((nums[2] << 8) | nums[3]).toString(16);
    s = `${s.slice(0, last + 1)}${hi}:${lo}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const side = (text) => (text ? text.split(":") : []);
  const left = side(halves[0]);
  const right = halves.length === 2 ? side(halves[1]) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(fill).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value;
}

const RANGES = loadRanges();

function headerFirst(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const want = String(name).toLowerCase();
  let value;
  if (Object.prototype.hasOwnProperty.call(headers, want)) {
    value = headers[want];
  } else {
    const key = Object.keys(headers).find((item) => item.toLowerCase() === want);
    if (!key) return "";
    value = headers[key];
  }
  if (value == null) return "";
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value);
}

function envHas(env, name) {
  return Boolean(env) && Object.prototype.hasOwnProperty.call(env, name);
}

function listFrom(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback.slice();
  return String(raw)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** "off" | "report" | "enforce". Unknown values are off. */
export function cfOnlyMode(env = process.env) {
  const raw = env?.ET_CF_ONLY;
  if (raw == null) return "off";
  const mode = String(raw).trim().toLowerCase();
  if (mode === "report" || mode === "enforce") return mode;
  return "off";
}

/** Hostnames, lowercase, no ports. Blank uses the default. */
export function cfHosts(env = process.env) {
  return listFrom(env?.ET_CF_HOSTS, DEFAULT_HOSTS);
}

/** Exact paths. Blank uses the default. A non-blank list that filters empty stays empty. */
export function cfExemptPaths(env = process.env) {
  if (env?.ET_CF_EXEMPT_PATHS == null || String(env.ET_CF_EXEMPT_PATHS).trim() === "") {
    return DEFAULT_EXEMPT.slice();
  }
  return String(env.ET_CF_EXEMPT_PATHS)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function cfHostName(raw) {
  let host = String(raw ?? "").trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  const colon = host.lastIndexOf(":");
  if (colon > -1 && host.indexOf(":") === colon && /^\d+$/.test(host.slice(colon + 1))) {
    return host.slice(0, colon);
  }
  return host;
}

/** True when the address (or a ::ffff: mapped v4) is inside the vendored ranges. */
export function isCloudflareIp(ip) {
  const norm = normalizeIp(ip);
  if (!norm) return false;
  if (norm.includes(":")) {
    const value = ipv6ToBigInt(norm);
    if (value == null) return false;
    return RANGES.v6.some((range) => (value & range.mask) === range.network);
  }
  const value = ipv4ToInt(norm);
  if (value == null) return false;
  return RANGES.v4.some((range) => ((value & range.mask) >>> 0) === range.network);
}

function secretEqual(left, right) {
  const a = createHash("sha256").update(String(left)).digest();
  const b = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function originSecret(env) {
  return String(env?.ET_CF_ORIGIN_SECRET ?? "").trim();
}

function originAuthOk(headers, env) {
  const secret = originSecret(env);
  if (!secret) return true;
  const got = headerFirst(headers, "x-et-origin-auth").trim();
  return secretEqual(got, secret);
}

function bearerExempt(pathname, headers, env) {
  if (!String(pathname || "").startsWith("/api/mention-queue")) return false;
  try {
    const role = mentionRole(headers || {}, env);
    return role != null && role !== "";
  } catch {
    return false;
  }
}

function internalExempt(req, env) {
  const method = String(req?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const token = String(env?.ET_INTERNAL_BYPASS_TOKEN ?? "").trim();
  if (!token) return false;
  const got = headerFirst(req?.headers, "x-et-internal").trim();
  return secretEqual(got, token);
}

function exemptionFor(req, env, pathname) {
  const pathName = String(pathname || "");
  if (cfExemptPaths(env).includes(pathName)) return "path";
  if (bearerExempt(pathName, req?.headers, env)) return "bearer";
  if (internalExempt(req, env)) return "internal";
  return null;
}

function failReason(headers, env, hop) {
  const host = cfHostName(headerFirst(headers, "host"));
  if (!cfHosts(env).includes(host)) return "host";
  if (!headerFirst(headers, "cf-ray").trim()) return "cf_ray";
  if (!normalizeIp(headerFirst(headers, "cf-connecting-ip"))) return "cf_ip";
  if (!hop || !isCloudflareIp(hop)) return "hop";
  if (!originAuthOk(headers, env)) return "origin_auth";
  return null;
}

function hopFrom(headers, env) {
  const raw = envHas(env, "TRUSTED_PROXY_HOPS") ? env.TRUSTED_PROXY_HOPS : undefined;
  const n = raw === undefined ? trustedProxyHops() : trustedProxyHops(raw);
  return xffHop(headers, n) || "";
}

function pathnameOf(req, pathname) {
  if (typeof pathname === "string") return pathname;
  try {
    return new URL(req?.url || "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

/**
 * CF decision for one request.
 * mode off: pass true, exempt null, trustCf false. The server does not pass
 * trustCf into the limiter, so #225 keeps ET_TRUST_CF_CONNECTING_IP.
 * report/enforce: trustCf is true only when the CF check passed and the
 * #225 switch is on. Exempt and failing requests do not trust CF-Connecting-IP.
 */
export function checkCfOrigin(req, { env = process.env, pathname } = {}) {
  const mode = cfOnlyMode(env);
  const hop = hopFrom(req?.headers, env);
  if (mode === "off") {
    return { pass: true, exempt: null, reason: null, hop, trustCf: false };
  }
  const reason = failReason(req?.headers, env, hop);
  const pass = reason == null;
  const exempt = pass ? null : exemptionFor(req, env, pathnameOf(req, pathname));
  const trustEnv = envHas(env, "ET_TRUST_CF_CONNECTING_IP")
    ? env.ET_TRUST_CF_CONNECTING_IP
    : undefined;
  const trustCf = pass && trustCfConnectingIp(trustEnv);
  return { pass, exempt, reason: pass ? null : reason, hop, trustCf };
}

let rejectedSinceBoot = 0;

export function recordCfReject() {
  rejectedSinceBoot += 1;
  return rejectedSinceBoot;
}

export function resetCfOnlyStats() {
  rejectedSinceBoot = 0;
}

export function cfOnlyStats(env = process.env) {
  return {
    mode: cfOnlyMode(env),
    rejected_since_boot: rejectedSinceBoot,
  };
}

function safeToken(value, fallback) {
  const text = String(value || "");
  if (/^[a-z0-9_]{1,32}$/.test(text)) return text;
  return fallback;
}

function safeHop(hop) {
  const text = String(hop || "");
  if (text && text.length <= 64 && /^[0-9a-f:.]+$/i.test(text)) return text;
  return "none";
}

export function sanitizeCfPath(pathname) {
  let text = String(pathname ?? "");
  const query = text.indexOf("?");
  if (query !== -1) text = text.slice(0, query);
  const hash = text.indexOf("#");
  if (hash !== -1) text = text.slice(0, hash);
  text = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "");
  if (text.length > PATH_CAP) text = text.slice(0, PATH_CAP);
  return text || "/";
}

/** One log line. No headers, no secrets. */
export function formatCfRejectLine(mode, decision, pathname) {
  const reason = safeToken(decision?.reason, "hop");
  const hop = safeHop(decision?.hop);
  const flag = safeToken(mode, "report");
  return `cf_only reject mode=${flag} reason=${reason} path=${sanitizeCfPath(pathname)} hop=${hop}`;
}
