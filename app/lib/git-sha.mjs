/**
 * Build sha for /api/health. Render sets RENDER_GIT_COMMIT; a lab checkout has none,
 * so fall back to the checkout HEAD, read once from .git files (no shell, no git binary).
 */
import fs from "fs";
import path from "path";
import { publicGitSha } from "./logical-heal.mjs";

const REF = /^refs\/[A-Za-z0-9._\/-]+$/;

function readText(readFile, file) {
  try {
    return String(readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * HEAD sha of the checkout at `root`, or null. Handles a normal .git dir, a worktree
 * `.git` file (`gitdir:` + `commondir`), a detached HEAD, loose refs and packed-refs.
 * Never throws. `readFile` is injectable for tests.
 */
export function readCheckoutGitSha(root, { readFile = fs.readFileSync } = {}) {
  try {
    const dotGit = path.join(String(root), ".git");
    let gitDir = dotGit;
    const asFile = readText(readFile, dotGit);
    if (asFile !== null) {
      const m = asFile.match(/^gitdir:\s*(.+?)\s*$/m);
      if (!m) return null;
      gitDir = path.resolve(String(root), m[1]);
    }
    const head = readText(readFile, path.join(gitDir, "HEAD"));
    if (head === null) return null;
    const h = head.trim();
    const direct = publicGitSha(h);
    if (direct && direct.length === 40) return direct;
    const ref = h.match(/^ref:\s*(\S+)$/)?.[1];
    if (!ref || !REF.test(ref) || ref.split("/").includes("..")) return null;
    const common = readText(readFile, path.join(gitDir, "commondir"));
    const commonDir = common === null ? gitDir : path.resolve(gitDir, common.trim());
    for (const dir of new Set([gitDir, commonDir])) {
      const loose = readText(readFile, path.join(dir, ref));
      const sha = loose === null ? null : publicGitSha(loose.trim());
      if (sha && sha.length === 40) return sha;
    }
    const packed = readText(readFile, path.join(commonDir, "packed-refs"));
    if (packed === null) return null;
    for (const line of packed.split("\n")) {
      const [sha, name] = line.trim().split(/\s+/);
      if (name === ref) {
        const ok = publicGitSha(sha);
        return ok && ok.length === 40 ? ok : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Env sha first (RENDER_GIT_COMMIT, then SOURCE_VERSION), else the cached checkout sha. */
export function healthGitSha(env, checkoutSha) {
  return publicGitSha(env?.RENDER_GIT_COMMIT || env?.SOURCE_VERSION) || publicGitSha(checkoutSha) || null;
}
