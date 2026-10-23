/**
 * App-side Cloudflare-only origin check.
 * Env is read at call time. ET_CF_ONLY=off is a no-op (rollback is a restart).
 * On Render, CF-Ray, CF-Connecting-IP, and a Cloudflare XFF hop arrive on every
 * request, because Render's edge is Cloudflare. Those are hygiene, not proof the
 * request used the areveur.com zone. Host does the practical work. The hop only
 * blocks traffic that never touched Cloudflare. ET_CF_ORIGIN_SECRET, carried as
 * X-ET-Origin-Auth from an areveur-zone Transform Rule, is the real control.
 * The proxy hop is xffHop from rate-limit.mjs. The socket address is not read.
 * Secrets (ET_CF_ORIGIN_SECRET, ET_INTERNAL_BYPASS_TOKEN) are compared and dropped.
 * They are not logged, not returned, and not copied onto errors. A non-empty
 * secret shorter than 32 characters is not accepted.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { BlockList, isIP } from "node:net";
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
const DEFAULT_EXEMPT = ["/health"];
const PATH_CAP = 200;
const SECRET_MIN = 32;
const SECRET_NAMES = ["ET_INTERNAL_BYPASS_TOKEN", "ET_CF_ORIGIN_SECRET"];
const REJECT_LOG_WINDOW_MS = 60_000;
const REJECT_LOG_CAP = 10;

function loadBlockList(file = RANGES_PATH) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.ipv4) || !Array.isArray(parsed.ipv6)) {
    throw new Error("cloudflare-ips.json is missing ipv4 or ipv6 lists");
  }
  const list = new BlockList();
  for (const cidr of parsed.ipv4) addCidr(list, cidr, "ipv4");
  for (const cidr of parsed.ipv6) addCidr(list, cidr, "ipv6");
  return list;
}

function addCidr(list, cidr, type) {
  const [addr, bitsRaw] = String(cidr).split("/");
  const bits = Number(bitsRaw);
  const max = type === "ipv4" ? 32 : 128;
  const family = type === "ipv4" ? 4 : 6;
  if (!Number.isInteger(bits) || bits < 0 || bits > max || String(bits) !== bitsRaw) {
    throw new Error(`bad cloudflare ${type} cidr: ${cidr}`);
  }
  if (isIP(addr) !== family) throw new Error(`bad cloudflare ${type} cidr: ${cidr}`);
  list.addSubnet(addr, bits, type);
}

// Built once at load from the vendored snapshot. The process does not fetch ranges.
const CF_LIST = loadBlockList();

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

function trimmedEnv(env, name) {
  return String(env?.[name] ?? "").trim();
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
  const family = isIP(norm);
  if (family === 4) return CF_LIST.check(norm, "ipv4");
  if (family === 6) return CF_LIST.check(norm, "ipv6");
  return false;
}

/**
 * Names of secrets that are set (non-empty after trim) and shorter than 32.
 * The values are not returned.
 */
export function cfSecretProblems(env = process.env) {
  const names = [];
  for (const name of SECRET_NAMES) {
    const value = trimmedEnv(env, name);
    if (value.length > 0 && value.length < SECRET_MIN) names.push(name);
  }
  return names;
}

/**
 * Lines to print before a non-zero exit. Empty when the mode is off, or when
 * every set secret is at least 32 characters. Names only, never the value.
 */
export function cfOnlyBootRefusals(env = process.env) {
  if (cfOnlyMode(env) === "off") return [];
  return cfSecretProblems(env).map(
    (name) => `cf_only refusing to start: ${name} must be at least 32 characters`,
  );
}

function secretEqual(left, right) {
  const a = createHash("sha256").update(String(left)).digest();
  const b = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function originAuthOk(headers, env) {
  const secret = trimmedEnv(env, "ET_CF_ORIGIN_SECRET");
  if (!secret) return true;
  if (secret.length < SECRET_MIN) return false;
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
  const token = trimmedEnv(env, "ET_INTERNAL_BYPASS_TOKEN");
  if (!token || token.length < SECRET_MIN) return false;
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
  // cf_ray and cf_ip are hygiene. On Render they are present on every request.
  if (!headerFirst(headers, "cf-ray").trim()) return "cf_ray";
  if (!normalizeIp(headerFirst(headers, "cf-connecting-ip"))) return "cf_ip";
  // The hop only blocks traffic that never touched Cloudflare.
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
 * report/enforce: trustCf is true only when the whole CF check passed and the
 * #225 switch is on. Exempt and failing requests do not trust CF-Connecting-IP.
 * Host does the practical work. The origin secret is the real control.
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

let rejectLogWindowStart = null;
let rejectLogKept = 0;
let rejectLogSuppressed = 0;

/** Clears the reject-log window. Does not change rejected_since_boot. */
export function resetCfRejectLog() {
  rejectLogWindowStart = null;
  rejectLogKept = 0;
  rejectLogSuppressed = 0;
}

export function resetCfOnlyStats() {
  rejectedSinceBoot = 0;
  resetCfRejectLog();
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

function hopToken(hop) {
  const text = String(hop ?? "").trim();
  if (!text) return "none";
  if (!isCloudflareIp(text)) return "masked";
  return normalizeIp(text);
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

/** One log line. No headers, no secrets. A non-Cloudflare hop is masked. */
export function formatCfRejectLine(mode, decision, pathname) {
  const reason = safeToken(decision?.reason, "hop");
  const hop = hopToken(decision?.hop);
  const flag = safeToken(mode, "report");
  return `cf_only reject mode=${flag} reason=${reason} path=${sanitizeCfPath(pathname)} hop=${hop}`;
}

/**
 * Lines to log for one counted reject. Call recordCfReject separately so the
 * counter still moves when a line is suppressed.
 * Fixed 60s window, opened by the first reject in the window. The first 10
 * rejects each return one formatCfRejectLine. The rest return nothing and
 * increment a suppressed count. The summary is lazy: there is no timer. When
 * the first reject of a later window arrives, and the previous window
 * suppressed K>0, the summary line is first:
 *   cf_only reject_summary suppressed=<K> window_s=60
 * A quiet process does not print that summary until the next reject.
 * A timestamp earlier than the open window also opens a new window.
 * Same function for report and enforce.
 */
export function cfRejectLogLines(mode, decision, pathname, now = Date.now()) {
  const ts = Number(now);
  const at = Number.isFinite(ts) ? ts : Date.now();
  const lines = [];
  const rolled =
    rejectLogWindowStart == null ||
    at < rejectLogWindowStart ||
    at >= rejectLogWindowStart + REJECT_LOG_WINDOW_MS;
  if (rolled) {
    if (rejectLogSuppressed > 0) {
      lines.push(`cf_only reject_summary suppressed=${rejectLogSuppressed} window_s=60`);
    }
    rejectLogWindowStart = at;
    rejectLogKept = 0;
    rejectLogSuppressed = 0;
  }
  if (rejectLogKept < REJECT_LOG_CAP) {
    lines.push(formatCfRejectLine(mode, decision, pathname));
    rejectLogKept += 1;
  } else {
    rejectLogSuppressed += 1;
  }
  return lines;
}
