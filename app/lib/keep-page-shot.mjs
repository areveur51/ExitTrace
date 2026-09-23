/**
 * Host screenshot of the public KEEP detail page.
 * The URL is for capture only. It is not placed in the X reply text.
 * The world-open production page only. Not lab-auth, admin, localhost, or port 5220.
 * Tests may stub the browser. Production capture does not read a local HTML file.
 */

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DETAIL_PATH = /^\/(?:people|operations)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const SCRUBBED = [
  "MENTION_QUEUE_BOT_TOKEN",
  "MENTION_QUEUE_WORKER_TOKEN",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "DATABASE_URL",
];

export function keepDetailPath(slug, kind = "person") {
  const id = String(slug || "").trim();
  if (!SLUG.test(id)) return "";
  const root = kind === "operation" ? "operations" : "people";
  return `/${root}/${id}`;
}

function isPrivateHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "lab-auth" || host.startsWith("lab-auth.") || host.includes("lab-auth")) return true;
  if (host === "admin" || host.startsWith("admin.")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** Public https detail URL. Empty when the origin is private, lab-auth, or port 5220. */
export function publicKeepPageUrl(origin, detailPath) {
  const base = String(origin || "").trim();
  const route = String(detailPath || "").trim();
  if (!base || !DETAIL_PATH.test(route)) return "";
  let root;
  let page;
  try {
    root = new URL(base);
    page = new URL(route, root);
  } catch {
    return "";
  }
  if (root.protocol !== "https:" || page.protocol !== "https:") return "";
  if (root.username || root.password || page.username || page.password) return "";
  if ((root.pathname && root.pathname !== "/") || root.search || root.hash) return "";
  if (page.port === "5220" || root.port === "5220") return "";
  if (page.search || page.hash) return "";
  if (page.origin !== root.origin) return "";
  if (isPrivateHost(page.hostname)) return "";
  if (!DETAIL_PATH.test(page.pathname)) return "";
  return `${page.origin}${page.pathname}`;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function assertPublicGlassPage(pageUrl, fetchImpl) {
  if (typeof fetchImpl !== "function") throw fail("public_page_required");
  const res = await fetchImpl(pageUrl, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "text/html" },
  });
  const status = Number(res?.status ?? res?.statusCode ?? 0);
  if (status !== 200) throw fail("public_page_unavailable");
  const html = await res.text();
  if (!String(html || "").includes('data-theme="glass"')) throw fail("public_theme_required");
  return html;
}

function isPng(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= PNG.length && bytes.subarray(0, PNG.length).equals(PNG);
}

async function resolveShotBin(env) {
  const custom = String(env.MENTION_PAGE_SHOT_BIN || "").trim();
  if (custom) return custom;
  const dirs = String(env.PATH || "").split(":");
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
      const full = path.join(dir, name);
      try {
        await access(full, constants.X_OK);
        return full;
      } catch {
        /* try the next binary */
      }
    }
  }
  return "";
}

function browserEnv(env) {
  const next = { ...env };
  for (const key of SCRUBBED) delete next[key];
  return next;
}

function chromiumKeepShot(pageUrl, { env, timeoutMs = 40_000 } = {}) {
  return resolveShotBin(env).then((bin) => {
    if (!bin) return Promise.reject(fail("page_shot_command_unset"));
    return mkdtemp(path.join(tmpdir(), "et-keep-shot-")).then(
      (dir) =>
        new Promise((resolve, reject) => {
          const out = path.join(dir, "keep.png");
          let settled = false;
          const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
          };
          const child = spawn(
            bin,
            [
              "--headless=new",
              "--disable-gpu",
              "--hide-scrollbars",
              "--no-first-run",
              "--window-size=1280,1600",
              `--screenshot=${out}`,
              "--virtual-time-budget=10000",
              pageUrl,
            ],
            { cwd: dir, env: browserEnv(env), stdio: ["ignore", "ignore", "pipe"] },
          );
          const timer = setTimeout(() => {
            child.kill("SIGTERM");
            finish(reject, fail("page_shot_timeout"));
          }, timeoutMs);
          child.on("error", (err) => finish(reject, err));
          child.on("close", (code) => {
            if (code !== 0) {
              finish(reject, fail("page_shot_failed"));
              return;
            }
            readFile(out).then(
              (bytes) => finish(resolve, bytes),
              (err) => finish(reject, err),
            );
          });
        }).finally(() => rm(dir, { recursive: true, force: true })),
    );
  });
}

/**
 * Confirm the public glass page, then capture it on this host.
 * captureImpl skips the browser. The page URL is still the public detail URL.
 */
export async function capturePublicKeepPage({
  origin,
  detailPath,
  fetchImpl,
  captureImpl,
  env = process.env,
  timeoutMs,
} = {}) {
  const pageUrl = publicKeepPageUrl(origin || env.EXITTRACE_PUBLIC_ORIGIN, detailPath);
  if (!pageUrl) throw fail("public_page_required");
  await assertPublicGlassPage(pageUrl, fetchImpl);
  const raw = captureImpl
    ? await captureImpl(pageUrl)
    : await chromiumKeepShot(pageUrl, { env, timeoutMs });
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
  if (!isPng(bytes)) throw fail("page_shot_invalid");
  return { pageUrl, bytes };
}
