/**
 * Dig capture profile directories live outside any git work tree.
 * resolveCaptureProfileDir does not create anything.
 * ensureCaptureProfileDir creates the leaf and keeps mode 0o700.
 * A symlink component, any git work tree, the wrong owner, or a mode
 * missing owner access is refused. This module does not launch a browser.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CASE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// Literal default. ET_CAPTURE_PROFILE_DIR overrides it.
export const DEFAULT_CAPTURE_PROFILE_BASE = "/opt/GrokBuild/exittrace/capture-profiles";

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
  return fs.realpathSync.native(root);
}

function envTable(env) {
  if (env && typeof env === "object") return env;
  return process.env;
}

function baseFromEnv(env) {
  const table = envTable(env);
  const raw = table.ET_CAPTURE_PROFILE_DIR;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return DEFAULT_CAPTURE_PROFILE_BASE;
}

function euidOf(opts) {
  if (opts && Number.isInteger(opts.euid)) return opts.euid;
  return process.geteuid();
}

function gitBinary(gitBin) {
  if (typeof gitBin === "string" && gitBin.length > 0) return gitBin;
  return "git";
}

function isSameOrInside(candidate, rootReal) {
  const child = path.resolve(candidate);
  const root = path.resolve(rootReal);
  if (child === root) return true;
  if (root === path.sep) return child.startsWith(path.sep);
  return child.startsWith(`${root}${path.sep}`);
}

function assertOutsideRepo(abs, repo) {
  if (isSameOrInside(abs, repo)) {
    throw refusal("capture_profile_in_repo", "capture profile resolves inside the repo");
  }
}

function lstatOrNull(abs) {
  try {
    return fs.lstatSync(abs);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function assertNotSymlink(st) {
  if (st && st.isSymbolicLink()) {
    throw refusal("capture_profile_symlink", "capture profile path is a symlink");
  }
}

function assertOwner(st, euid) {
  if (!st || st.uid !== euid) {
    throw refusal("capture_profile_owner", "capture profile path owner mismatch");
  }
}

function assertNoSymlinkPath(abs) {
  const parts = String(abs).split(path.sep);
  const stack = [];
  let missing = 0;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (missing > 0) missing -= 1;
      else stack.pop();
      continue;
    }
    if (missing > 0) {
      missing += 1;
      continue;
    }
    stack.push(part);
    const cursor = path.join(path.sep, ...stack);
    const st = lstatOrNull(cursor);
    if (!st) {
      stack.pop();
      missing = 1;
      continue;
    }
    assertNotSymlink(st);
    if (!st.isDirectory()) {
      stack.pop();
      missing = 1;
    }
  }
}

// realpathSync.native of the nearest existing ancestor, then the rest.
// ".." is applied to that real directory, not to a lexical prefix.
function locatePhysical(absPath) {
  const parts = String(absPath).split(path.sep);
  let real = path.sep;
  const pending = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (pending.length > 0) pending.pop();
      else real = path.dirname(real);
      continue;
    }
    if (pending.length > 0) {
      pending.push(part);
      continue;
    }
    const next = path.join(real, part);
    let st;
    try {
      st = fs.lstatSync(next);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
        pending.push(part);
        continue;
      }
      throw err;
    }
    if (!st.isSymbolicLink() && !st.isDirectory()) {
      pending.push(part);
      continue;
    }
    try {
      real = fs.realpathSync.native(next);
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR" || err.code === "ELOOP")) {
        pending.push(part);
        continue;
      }
      throw err;
    }
  }
  let dir = real;
  for (const part of pending) dir = path.join(dir, part);
  return { dir, ancestor: real };
}

function lexicalJoin(base, caseName) {
  if (base.endsWith(path.sep)) return `${base}${caseName}`;
  return `${base}${path.sep}${caseName}`;
}

function hasGitEntry(dir) {
  try {
    fs.lstatSync(path.join(dir, ".git"));
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
}

function ancestorsHaveGit(start) {
  let cursor = start;
  while (cursor) {
    if (hasGitEntry(cursor)) return true;
    if (cursor === path.sep) return false;
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
  return false;
}

function envWithoutGitVars() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

function gitCommonMainContains(abs, ancestor, stdout) {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const toplevel = lines[0] ? path.resolve(ancestor, lines[0]) : "";
  const commonRaw = lines[1] || "";
  if (toplevel && isSameOrInside(abs, toplevel)) return true;
  if (!commonRaw) return false;
  const commonAbs = path.resolve(ancestor, commonRaw);
  if (path.basename(commonAbs) !== ".git") return false;
  return isSameOrInside(abs, path.dirname(commonAbs));
}

function assertOutsideGitTree(abs, ancestor, gitBin) {
  if (ancestorsHaveGit(ancestor)) {
    throw refusal("capture_profile_in_git_tree", "capture profile resolves inside a git tree");
  }
  const run = spawnSync(
    gitBinary(gitBin),
    ["-C", ancestor, "rev-parse", "--show-toplevel", "--git-common-dir"],
    {
      encoding: "utf8",
      env: envWithoutGitVars(),
      timeout: 20000,
    },
  );
  if (run.error && run.error.code === "ENOENT") return;
  if (run.error) throw run.error;
  if (run.status !== 0) return;
  // Success means this ancestor is a work tree or git dir.
  // A common dir named .git also names that repo's main checkout.
  const inMain = gitCommonMainContains(abs, ancestor, run.stdout);
  if (inMain || run.status === 0) {
    throw refusal("capture_profile_in_git_tree", "capture profile resolves inside a git tree");
  }
}

function splitAbs(abs) {
  const root = path.parse(abs).root;
  return {
    root,
    parts: abs.slice(root.length).split(path.sep).filter(Boolean),
  };
}

function resolveCaptureProfile(opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  assertCaseName(options.caseName);
  const base = baseFromEnv(options.env);
  if (!path.isAbsolute(base)) {
    throw refusal("capture_base_not_absolute", "capture profile base is not absolute");
  }
  const repo = realRepo(options.repoRoot);
  const lexical = lexicalJoin(base, options.caseName);
  const located = locatePhysical(lexical);
  const baseLocated = locatePhysical(base);
  assertNoSymlinkPath(lexical);
  assertNoSymlinkPath(located.dir);
  assertOutsideRepo(path.resolve(lexical), repo);
  assertOutsideRepo(located.dir, repo);
  assertOutsideGitTree(located.dir, located.ancestor, options.gitBin);
  return {
    dir: located.dir,
    repo,
    base: baseLocated.dir,
    gitBin: options.gitBin,
    lexical,
  };
}

function createProfileTree(dir, lexical, base, repo, euid) {
  assertNoSymlinkPath(lexical);
  assertNoSymlinkPath(dir);
  const { root, parts } = splitAbs(dir);
  let cursor = root;
  let prevUmask = null;
  try {
    for (let i = 0; i < parts.length; i += 1) {
      cursor = path.join(cursor, parts[i]);
      const st = lstatOrNull(cursor);
      assertNotSymlink(st);
      if (st && !st.isDirectory()) {
        throw refusal("capture_profile_not_dir", "capture profile path is not a directory");
      }
      if (st) {
        if (isSameOrInside(cursor, base)) assertOwner(st, euid);
        continue;
      }
      assertOutsideRepo(cursor, repo);
      if (prevUmask === null) prevUmask = process.umask(0o077);
      try {
        fs.mkdirSync(cursor, { mode: 0o700 });
      } catch (err) {
        if (!err || err.code !== "EEXIST") throw err;
      }
      const made = fs.lstatSync(cursor);
      assertNotSymlink(made);
      if (!made.isDirectory()) {
        throw refusal("capture_profile_not_dir", "capture profile path is not a directory");
      }
      if (isSameOrInside(cursor, base)) assertOwner(made, euid);
    }
  } finally {
    if (prevUmask !== null) process.umask(prevUmask);
  }
}

function tightenLeaf(dir, st) {
  const mode = st.mode & 0o777;
  if ((mode & 0o700) !== 0o700) {
    throw refusal("capture_profile_mode", "capture profile directory is missing owner access");
  }
  const newMode = mode & 0o700;
  if (newMode !== mode) fs.chmodSync(dir, newMode);
}

export function resolveCaptureProfileDir(opts = {}) {
  return resolveCaptureProfile(opts).dir;
}

export function ensureCaptureProfileDir(opts = {}) {
  const resolved = resolveCaptureProfile(opts);
  const euid = euidOf(opts);
  createProfileTree(resolved.dir, resolved.lexical, resolved.base, resolved.repo, euid);
  const leafStat = fs.lstatSync(resolved.dir);
  assertNotSymlink(leafStat);
  if (!leafStat.isDirectory()) {
    throw refusal("capture_profile_not_dir", "capture profile path is not a directory");
  }
  assertOwner(leafStat, euid);
  tightenLeaf(resolved.dir, leafStat);
  const leaf = fs.realpathSync.native(resolved.dir);
  assertNoSymlinkPath(leaf);
  assertOutsideRepo(leaf, resolved.repo);
  const again = locatePhysical(leaf);
  assertOutsideGitTree(leaf, again.ancestor, resolved.gitBin);
  return leaf;
}
