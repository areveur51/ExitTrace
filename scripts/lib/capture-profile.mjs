/**
 * Dig capture profile directories live outside the repo.
 * resolveCaptureProfileDir does not create anything.
 * ensureCaptureProfileDir creates the leaf at mode 0o700.
 * This module does not launch a browser.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CASE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function refusal(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertCaseName(caseName) {
  if (typeof caseName !== "string" || caseName === "." || caseName === ".." || !CASE_NAME.test(caseName)) {
    throw refusal("capture_case_invalid", "invalid capture case");
  }
}

function realRepo(repoRoot) {
  const root = typeof repoRoot === "string" && repoRoot.length > 0
    ? path.resolve(repoRoot)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  return fs.realpathSync(root);
}

// Two levels above the real repo root, then exittrace/capture-profiles.
// No host string. This does not create a directory.
export function defaultCaptureProfileBase(repoRoot) {
  return path.resolve(realRepo(repoRoot), "..", "..", "exittrace", "capture-profiles");
}

function baseFromEnv(env, repoRoot) {
  const table = env && typeof env === "object" ? env : {};
  const raw = table.ET_CAPTURE_PROFILE_DIR;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return defaultCaptureProfileBase(repoRoot);
}

function isSameOrInside(candidate, rootReal) {
  const child = path.resolve(candidate);
  const root = path.resolve(rootReal);
  if (child === root) return true;
  if (root === path.sep) return child.startsWith(path.sep);
  return child.startsWith(`${root}${path.sep}`);
}

// Realpath of the nearest existing ancestor, then the remaining components.
function locate(absPath) {
  const parts = String(absPath).split("/").filter((part) => part.length > 0 && part !== ".");
  let real = path.sep;
  const pending = [];
  for (const part of parts) {
    if (pending.length > 0) {
      if (part === "..") pending.pop();
      else pending.push(part);
      continue;
    }
    if (part === "..") {
      real = path.dirname(real);
      continue;
    }
    const next = path.join(real, part);
    try {
      real = fs.realpathSync(next);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR" || err.code === "ELOOP")) {
        pending.push(part);
        continue;
      }
      throw err;
    }
  }
  let out = real;
  for (const part of pending) out = path.join(out, part);
  return out;
}

function lstatOrNull(abs) {
  try {
    return fs.lstatSync(abs);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function splitAbs(abs) {
  const root = path.parse(abs).root;
  return {
    root,
    parts: abs.slice(root.length).split(path.sep).filter(Boolean),
  };
}

export function resolveCaptureProfileDir({ caseName, env = process.env, repoRoot } = {}) {
  assertCaseName(caseName);
  const base = baseFromEnv(env, repoRoot);
  if (!path.isAbsolute(base)) {
    throw refusal("capture_base_not_absolute", "capture profile base is not absolute");
  }
  const lexical = path.resolve(base, caseName);
  const raw = base.endsWith("/") ? `${base}${caseName}` : `${base}/${caseName}`;
  const repo = realRepo(repoRoot);
  if (isSameOrInside(lexical, repo) || isSameOrInside(locate(raw), repo)) {
    throw refusal("capture_profile_in_repo", "capture profile resolves inside the repo");
  }
  return lexical;
}

function createProfileTree(dir, repo) {
  if (isSameOrInside(locate(dir), repo)) {
    throw refusal("capture_profile_in_repo", "capture profile resolves inside the repo");
  }
  const { root, parts } = splitAbs(dir);
  let cursor = root;
  let creating = false;
  let prevUmask = null;
  try {
    for (let i = 0; i < parts.length; i += 1) {
      cursor = path.join(cursor, parts[i]);
      const st = lstatOrNull(cursor);
      if (st && st.isSymbolicLink() && (creating || i === parts.length - 1)) {
        throw refusal("capture_profile_symlink", "capture profile path is a symlink");
      }
      if (st && st.isSymbolicLink()) continue;
      if (st && !st.isDirectory()) {
        throw refusal("capture_profile_not_dir", "capture profile path is not a directory");
      }
      if (st) continue;
      if (!creating) {
        creating = true;
        prevUmask = process.umask(0o077);
      }
      if (isSameOrInside(locate(cursor), repo)) {
        throw refusal("capture_profile_in_repo", "capture profile resolves inside the repo");
      }
      try {
        fs.mkdirSync(cursor, { mode: 0o700 });
      } catch (err) {
        if (!err || err.code !== "EEXIST") throw err;
      }
      const made = fs.lstatSync(cursor);
      if (made.isSymbolicLink()) {
        throw refusal("capture_profile_symlink", "capture profile path is a symlink");
      }
      if (!made.isDirectory()) {
        throw refusal("capture_profile_not_dir", "capture profile path is not a directory");
      }
    }
  } finally {
    if (prevUmask !== null) process.umask(prevUmask);
  }
}

export function ensureCaptureProfileDir(opts = {}) {
  const dir = resolveCaptureProfileDir(opts);
  const repo = realRepo(opts.repoRoot);
  createProfileTree(dir, repo);
  const leafStat = fs.lstatSync(dir);
  if (leafStat.isSymbolicLink()) {
    throw refusal("capture_profile_symlink", "capture profile path is a symlink");
  }
  // Drop group and other permission bits. Never grant those bits.
  if ((leafStat.mode & 0o077) !== 0) {
    fs.chmodSync(dir, 0o700);
  }
  if (isSameOrInside(fs.realpathSync(dir), repo)) {
    throw refusal("capture_profile_in_repo", "capture profile resolves inside the repo");
  }
  return dir;
}
