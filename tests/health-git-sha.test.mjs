import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { healthGitSha, readCheckoutGitSha } from "../app/lib/git-sha.mjs";

const A = "a".repeat(40);
const B = "0123456789abcdef0123456789abcdef01234567";
const ROOT = path.resolve("/srv/exittrace");

/**
 * In-memory readFile over absolute paths; a missing path throws like fs does.
 * Without a `.git` file entry, ROOT/.git acts as a directory (EISDIR).
 */
function fakeFs(files) {
  const map = new Map(Object.entries(files).map(([k, v]) => [path.resolve(k), v]));
  const dotGit = path.join(ROOT, ".git");
  return (file) => {
    const key = path.resolve(file);
    if (key === dotGit && !map.has(key)) throw Object.assign(new Error("EISDIR"), { code: "EISDIR" });
    if (!map.has(key)) throw Object.assign(new Error(`ENOENT ${key}`), { code: "ENOENT" });
    const v = map.get(key);
    if (v instanceof Error) throw v;
    return v;
  };
}

test("env set: RENDER_GIT_COMMIT wins over the checkout sha (public unchanged)", () => {
  assert.equal(healthGitSha({ RENDER_GIT_COMMIT: B.toUpperCase() }, A), B);
  assert.equal(healthGitSha({ SOURCE_VERSION: B }, A), B);
  assert.equal(healthGitSha({ RENDER_GIT_COMMIT: B, SOURCE_VERSION: A }, null), B);
});

test("env unset: falls back to the checkout HEAD sha", () => {
  assert.equal(healthGitSha({}, A), A);
  assert.equal(healthGitSha({ RENDER_GIT_COMMIT: "" }, A), A);
  assert.equal(healthGitSha({ RENDER_GIT_COMMIT: "not-a-sha" }, A), A);
});

test("fallback reads HEAD from .git files: branch ref, detached, packed-refs, worktree", () => {
  const cases = [
    ["loose branch ref", { "/srv/exittrace/.git/HEAD": "ref: refs/heads/main\n", "/srv/exittrace/.git/refs/heads/main": `${B}\n` }, B],
    ["detached HEAD", { "/srv/exittrace/.git/HEAD": `${A}\n` }, A],
    ["packed ref", { "/srv/exittrace/.git/HEAD": "ref: refs/heads/main\n", "/srv/exittrace/.git/packed-refs": `# pack-refs with: peeled\n${B} refs/heads/main\n` }, B],
    [
      "worktree .git file + commondir",
      {
        "/srv/exittrace/.git": "gitdir: /srv/main/.git/worktrees/wt\n",
        "/srv/main/.git/worktrees/wt/HEAD": "ref: refs/heads/fix/x\n",
        "/srv/main/.git/worktrees/wt/commondir": "../..\n",
        "/srv/main/.git/refs/heads/fix/x": `${A}\n`,
      },
      A,
    ],
  ];
  for (const [name, files, want] of cases) {
    assert.equal(readCheckoutGitSha(ROOT, { readFile: fakeFs(files) }), want, name);
  }
});

test("unreadable or bad checkout returns null and never throws", () => {
  const cases = [
    ["no .git at all", {}],
    ["HEAD unreadable", { "/srv/exittrace/.git/HEAD": new Error("EACCES") }],
    ["ref file missing", { "/srv/exittrace/.git/HEAD": "ref: refs/heads/main\n" }],
    ["ref is not a sha", { "/srv/exittrace/.git/HEAD": "ref: refs/heads/main\n", "/srv/exittrace/.git/refs/heads/main": "garbage\n" }],
    ["ref escapes .git", { "/srv/exittrace/.git/HEAD": "ref: refs/../../etc/passwd\n" }],
    ["shell-ish ref is not run", { "/srv/exittrace/.git/HEAD": "ref: refs/heads/$(id)\n" }],
    ["bad .git file", { "/srv/exittrace/.git": "nonsense\n" }],
  ];
  for (const [name, files] of cases) {
    assert.doesNotThrow(() => readCheckoutGitSha(ROOT, { readFile: fakeFs(files) }), name);
    assert.equal(readCheckoutGitSha(ROOT, { readFile: fakeFs(files) }), null, name);
  }
  assert.equal(readCheckoutGitSha(ROOT, { readFile: () => { throw new Error("boom"); } }), null);
  assert.equal(readCheckoutGitSha(undefined, { readFile: () => { throw new Error("boom"); } }), null);
  assert.equal(healthGitSha({}, null), null);
  assert.equal(healthGitSha(undefined, undefined), null);
});

test("the real checkout reads the same sha git would, or null outside a checkout", () => {
  const sha = readCheckoutGitSha(path.resolve(import.meta.dirname, ".."));
  assert.ok(sha === null || /^[0-9a-f]{40}$/.test(sha));
});
