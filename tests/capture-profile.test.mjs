import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CAPTURE_PROFILE_BASE,
  captureProfileBase,
  ensureCaptureProfileDir,
  resolveCaptureProfileDir,
} from "../scripts/lib/capture-profile.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "scripts", "capture-profile-dir.mjs");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "et-capture-test."));
const anchor = path.join(scratch, "anchor");
const gitHome = path.join(scratch, "home");
fs.mkdirSync(anchor, { mode: 0o700 });
fs.mkdirSync(gitHome, { mode: 0o700 });

const scratchRel = path.relative(repoRoot, scratch);
if (scratchRel === "" || (!scratchRel.startsWith("..") && !path.isAbsolute(scratchRel))) {
  throw new Error("scratch directory is inside the repo");
}

let checks = 0;

function eq(actual, expected, message) {
  checks += 1;
  assert.equal(actual, expected, message);
}

function ok(value, message) {
  checks += 1;
  assert.ok(value, message);
}

function throwsCode(fn, code) {
  checks += 1;
  assert.throws(fn, (err) => err instanceof Error && err.code === code);
}

function modeOf(abs) {
  return fs.statSync(abs).mode & 0o777;
}

function listing(abs) {
  return fs.readdirSync(abs).sort().join("\n");
}

function treeList(abs) {
  const out = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      out.push(path.relative(abs, full));
      if (fs.lstatSync(full).isDirectory()) visit(full);
    }
  };
  visit(abs);
  return out.join("\n");
}

function physical(abs) {
  return fs.realpathSync.native(abs);
}

function optsFor(base, caseName, extra = {}) {
  return {
    caseName,
    env: { ET_CAPTURE_PROFILE_DIR: base },
    repoRoot: anchor,
    ...extra,
  };
}

const gitConfigArgs = [
  "-c", "commit.gpgsign=false",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "user.name=t",
  "-c", "user.email=t@example.invalid",
  "-c", "init.defaultBranch=main",
];

function git(args) {
  const env = {
    PATH: process.env.PATH,
    HOME: gitHome,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const run = spawnSync("git", [...gitConfigArgs, ...args], { env, encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    const detail = (run.stderr || run.stdout || "git failed").trim();
    throw new Error(detail);
  }
  return run;
}

function initCommittedRepo(dir) {
  fs.mkdirSync(dir, { mode: 0o700 });
  git(["init", dir]);
  git(["-C", dir, "commit", "--allow-empty", "-m", "init"]);
}

function addWorktree(main, wt) {
  git(["-C", main, "worktree", "add", wt]);
}

function runCli(args, extraEnv) {
  const env = { ...process.env, ...extraEnv };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    timeout: 20000,
  });
}

process.on("exit", () => {
  process.stderr.write(`capture-profile checks ${checks}\n`);
});

test("scratch directory is mode 700", () => {
  eq(modeOf(scratch), 0o700);
  eq(modeOf(anchor), 0o700);
  eq(modeOf(gitHome), 0o700);
  ok(scratchRel.startsWith("..") || path.isAbsolute(scratchRel));
});

test("default base is the absolute constant", () => {
  eq(captureProfileBase({}), DEFAULT_CAPTURE_PROFILE_BASE);
  ok(path.isAbsolute(captureProfileBase({})));
  ok(path.isAbsolute(DEFAULT_CAPTURE_PROFILE_BASE));
  const expected = path.join(captureProfileBase({}), "c1");
  eq(expected, path.join(DEFAULT_CAPTURE_PROFILE_BASE, "c1"));
  ok(path.isAbsolute(expected));
  eq(captureProfileBase({ ET_CAPTURE_PROFILE_DIR: "" }), DEFAULT_CAPTURE_PROFILE_BASE);
  eq(captureProfileBase({ ET_CAPTURE_PROFILE_DIR: "/x/y" }), "/x/y");
});

test("default base ignores the caller repo root", () => {
  const before = DEFAULT_CAPTURE_PROFILE_BASE;
  const other = path.join(scratch, "other-root");
  fs.mkdirSync(other, { mode: 0o700 });
  const base = path.join(scratch, "repo-independent");
  const caseName = "fake-case";
  const expected = path.join(base, caseName);
  eq(
    resolveCaptureProfileDir({
      caseName,
      env: { ET_CAPTURE_PROFILE_DIR: base },
      repoRoot: other,
    }),
    expected,
  );
  eq(
    resolveCaptureProfileDir({
      caseName,
      env: { ET_CAPTURE_PROFILE_DIR: base },
      repoRoot: anchor,
    }),
    expected,
  );
  eq(captureProfileBase({}), before);
  eq(captureProfileBase({ ET_CAPTURE_PROFILE_DIR: "" }), before);
  eq(DEFAULT_CAPTURE_PROFILE_BASE, before);
  eq(fs.existsSync(expected), false);
  eq(fs.existsSync(base), false);
  eq(modeOf(other), 0o700);
});

test("env override is honored", () => {
  const base = path.join(scratch, "override-only");
  const caseName = "a".repeat(64);
  eq(
    resolveCaptureProfileDir({
      caseName,
      env: { ET_CAPTURE_PROFILE_DIR: base },
      repoRoot,
    }),
    path.join(base, caseName),
  );
  eq(fs.existsSync(base), false);
});

test("invalid case names are rejected", () => {
  const names = ["", "..", "a/b", "../x", "UP", "a".repeat(65), "."];
  for (const caseName of names) {
    throwsCode(
      () => resolveCaptureProfileDir({
        caseName,
        env: { ET_CAPTURE_PROFILE_DIR: path.join(scratch, "invalid-names") },
        repoRoot: anchor,
      }),
      "capture_case_invalid",
    );
  }
  eq(fs.existsSync(path.join(scratch, "invalid-names")), false);
});

test("relative base is rejected", () => {
  throwsCode(
    () => resolveCaptureProfileDir({
      caseName: "memphis-safe",
      env: { ET_CAPTURE_PROFILE_DIR: "capture-profile-relative" },
      repoRoot: anchor,
    }),
    "capture_base_not_absolute",
  );
  eq(fs.existsSync(path.join(repoRoot, "capture-profile-relative")), false);
  eq(fs.existsSync(path.join(anchor, "capture-profile-relative")), false);
});

test("profile inside the repo is refused", () => {
  const fake = path.join(scratch, "plain-repo");
  fs.mkdirSync(fake, { mode: 0o700 });
  const cases = [
    ["inrepo-scratch", path.join(fake, "scratch")],
    ["inrepo-root", fake],
  ];
  for (const [caseName, base] of cases) {
    const opts = { caseName, env: { ET_CAPTURE_PROFILE_DIR: base }, repoRoot: fake };
    throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_in_repo");
    throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_in_repo");
  }
  eq(fs.existsSync(path.join(fake, "scratch")), false);
  eq(fs.existsSync(path.join(fake, "inrepo-root")), false);
  eq(modeOf(fake), 0o700);
});

test("ensure creates mode 700 and tightens a 755 leaf", () => {
  const base = path.join(scratch, "deep", "profiles");
  const created = ensureCaptureProfileDir({
    caseName: "hunter-biden",
    env: { ET_CAPTURE_PROFILE_DIR: base },
    repoRoot,
  });
  eq(created, path.join(base, "hunter-biden"));
  eq(created, physical(created));
  eq(modeOf(path.join(scratch, "deep")), 0o700);
  eq(modeOf(base), 0o700);
  eq(modeOf(created), 0o700);
  const again = ensureCaptureProfileDir({
    caseName: "hunter-biden",
    env: { ET_CAPTURE_PROFILE_DIR: base },
    repoRoot,
  });
  eq(again, created);
  eq(modeOf(created), 0o700);

  const tightenBase = path.join(scratch, "tighten");
  fs.mkdirSync(tightenBase, { mode: 0o700 });
  const leaf = path.join(tightenBase, "oldcase");
  fs.mkdirSync(leaf, { mode: 0o700 });
  fs.chmodSync(leaf, 0o755);
  eq(modeOf(leaf), 0o755);
  const tightened = ensureCaptureProfileDir({
    caseName: "oldcase",
    env: { ET_CAPTURE_PROFILE_DIR: tightenBase },
    repoRoot,
  });
  eq(tightened, physical(leaf));
  eq(modeOf(leaf), 0o700);
  eq(modeOf(scratch), 0o700);
  eq(modeOf(tightenBase), 0o700);
});

test("an existing 0555 leaf is refused and keeps its mode", () => {
  const base = path.join(scratch, "mode-0555");
  fs.mkdirSync(base, { mode: 0o700 });
  const leaf = path.join(base, "locked");
  fs.mkdirSync(leaf, { mode: 0o700 });
  fs.chmodSync(leaf, 0o555);
  eq(modeOf(leaf), 0o555);
  throwsCode(
    () => ensureCaptureProfileDir(optsFor(base, "locked")),
    "capture_profile_mode",
  );
  eq(modeOf(leaf), 0o555);
  eq(modeOf(base), 0o700);
});

test("components at or below the base must match euid", () => {
  const base = path.join(scratch, "owner-base");
  fs.mkdirSync(base, { mode: 0o700 });
  const mine = process.geteuid();
  const other = mine === 0 ? 1 : mine + 1;
  throwsCode(
    () => ensureCaptureProfileDir(optsFor(base, "owned", { euid: other })),
    "capture_profile_owner",
  );
  eq(fs.existsSync(path.join(base, "owned")), false);
  eq(modeOf(base), 0o700);

  const okBase = path.join(scratch, "owner-ok");
  const made = ensureCaptureProfileDir(optsFor(okBase, "owned", { euid: mine }));
  eq(made, physical(path.join(okBase, "owned")));
  eq(modeOf(made), 0o700);
  eq(fs.lstatSync(made).uid, mine);
});

test("CLI prints the path or an alert", () => {
  const base = path.join(scratch, "cli-home");
  const okRun = runCli(["cli-case"], { ET_CAPTURE_PROFILE_DIR: base });
  const leaf = path.join(base, "cli-case");
  eq(okRun.status, 0);
  eq(okRun.stdout, `${physical(leaf)}\n`);
  eq(okRun.stderr, "");
  eq(modeOf(base), 0o700);
  eq(modeOf(leaf), 0o700);

  const badRun = runCli(["../x"], { ET_CAPTURE_PROFILE_DIR: path.join(scratch, "cli-bad") });
  eq(badRun.status, 2);
  eq(badRun.stdout, "");
  ok(/^ALERT capture profile capture_case_invalid: .+\n$/.test(badRun.stderr));
  eq(fs.existsSync(path.join(scratch, "cli-bad")), false);
});

test("a symlink leaf is refused", () => {
  const base = path.join(scratch, "leaf-base");
  const target = path.join(scratch, "leaf-target");
  fs.mkdirSync(base, { mode: 0o700 });
  fs.mkdirSync(target, { mode: 0o700 });
  const leaf = path.join(base, "linked");
  fs.symlinkSync(target, leaf);
  const before = listing(target);
  throwsCode(
    () => ensureCaptureProfileDir(optsFor(base, "linked")),
    "capture_profile_symlink",
  );
  ok(fs.lstatSync(leaf).isSymbolicLink());
  eq(listing(target), before);
  eq(modeOf(target), 0o700);
  eq(modeOf(scratch), 0o700);
});

test("a symlinked ancestor with a missing leaf is refused", () => {
  const parent = path.join(scratch, "sym-missing");
  const target = path.join(parent, "target");
  const link = path.join(parent, "link");
  fs.mkdirSync(parent, { mode: 0o700 });
  fs.mkdirSync(target, { mode: 0o700 });
  fs.symlinkSync(target, link);
  const before = listing(target);
  const opts = optsFor(link, "newleaf");
  throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_symlink");
  throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_symlink");
  eq(listing(target), before);
  eq(fs.existsSync(path.join(target, "newleaf")), false);
  ok(fs.lstatSync(link).isSymbolicLink());
  eq(modeOf(target), 0o700);
});

test("a symlinked ancestor with an existing leaf is refused", () => {
  const parent = path.join(scratch, "sym-existing");
  const target = path.join(parent, "target");
  const link = path.join(parent, "link");
  const leaf = path.join(target, "leaf");
  fs.mkdirSync(parent, { mode: 0o700 });
  fs.mkdirSync(target, { mode: 0o700 });
  fs.mkdirSync(leaf, { mode: 0o700 });
  fs.symlinkSync(target, link);
  const before = listing(target);
  eq(modeOf(leaf), 0o700);
  const opts = optsFor(link, "leaf");
  throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_symlink");
  throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_symlink");
  eq(listing(target), before);
  eq(modeOf(leaf), 0o700);
  eq(fs.existsSync(path.join(target, "leaf")), true);
  ok(fs.lstatSync(link).isSymbolicLink());
});

test("refuses any git work tree, git dir, and main checkout", () => {
  const main = path.join(scratch, "git-main");
  initCommittedRepo(main);
  const wt = path.join(main, ".worktrees", "wt");
  addWorktree(main, wt);
  ok(fs.lstatSync(path.join(main, ".git")).isDirectory());
  ok(fs.lstatSync(path.join(wt, ".git")).isFile());

  const worf = path.join(main, "exittrace", "capture-profiles");
  const worfOpts = optsFor(worf, "worf-case");
  throwsCode(() => resolveCaptureProfileDir(worfOpts), "capture_profile_in_git_tree");
  throwsCode(() => ensureCaptureProfileDir(worfOpts), "capture_profile_in_git_tree");
  eq(fs.existsSync(path.join(main, "exittrace")), false);

  const wtOpts = optsFor(wt, "wt-case");
  throwsCode(() => resolveCaptureProfileDir(wtOpts), "capture_profile_in_git_tree");
  throwsCode(() => ensureCaptureProfileDir(wtOpts), "capture_profile_in_git_tree");
  eq(fs.existsSync(path.join(wt, "wt-case")), false);

  const gitdir = path.join(main, ".git");
  const gitOpts = optsFor(gitdir, "gitdir-case");
  throwsCode(() => resolveCaptureProfileDir(gitOpts), "capture_profile_in_git_tree");
  throwsCode(() => ensureCaptureProfileDir(gitOpts), "capture_profile_in_git_tree");
  eq(fs.existsSync(path.join(gitdir, "gitdir-case")), false);

  const sibling = path.join(scratch, "git-sibling");
  const sibOpts = optsFor(sibling, "sibling-case");
  eq(resolveCaptureProfileDir(sibOpts), path.join(sibling, "sibling-case"));
  const made = ensureCaptureProfileDir(sibOpts);
  eq(made, physical(path.join(sibling, "sibling-case")));
  eq(modeOf(made), 0o700);

  const ghost = path.join(scratch, "ghost-repo");
  fs.mkdirSync(ghost, { mode: 0o700 });
  fs.writeFileSync(path.join(ghost, ".git"), "gitdir: /nonexistent\n", { mode: 0o600 });
  ok(fs.lstatSync(path.join(ghost, ".git")).isFile());
  const ghostBase = path.join(ghost, "nested");
  const ghostOpts = optsFor(ghostBase, "ghost-case", { gitBin: "/nonexistent" });
  throwsCode(() => resolveCaptureProfileDir(ghostOpts), "capture_profile_in_git_tree");
  throwsCode(() => ensureCaptureProfileDir(ghostOpts), "capture_profile_in_git_tree");
  eq(fs.existsSync(ghostBase), false);
});

test("CLI refuses a profile inside a fake git repo in scratch", () => {
  const main = path.join(scratch, "cli-git");
  initCommittedRepo(main);
  const cliRun = runCli(["cli-git-case"], { ET_CAPTURE_PROFILE_DIR: main });
  eq(cliRun.status, 2);
  eq(cliRun.stdout, "");
  ok(/^ALERT capture profile capture_profile_in_git_tree: .+\n$/.test(cliRun.stderr));
  eq(fs.existsSync(path.join(main, "cli-git-case")), false);
  eq(fs.existsSync(path.join(repoRoot, "cli-git-case")), false);
});

test("dotdot into a repo is refused", () => {
  const main = path.join(scratch, "fakerepo");
  initCommittedRepo(main);
  const base = `${scratch}${path.sep}elsewhere${path.sep}..${path.sep}fakerepo${path.sep}scratch`;
  ok(base.includes(`${path.sep}..${path.sep}`));
  const opts = optsFor(base, "dotdot-case");
  throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_in_git_tree");
  throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_in_git_tree");
  eq(fs.existsSync(path.join(scratch, "elsewhere")), false);
  eq(fs.existsSync(path.join(main, "scratch")), false);
});

test("prefix boundary accepts a sibling name and refuses the repo", () => {
  const repo = path.join(scratch, "ExitTrace");
  initCommittedRepo(repo);
  const evil = path.join(scratch, "ExitTrace-evil", "profiles");
  const evilOpts = optsFor(evil, "ok-case", { repoRoot: repo });
  eq(resolveCaptureProfileDir(evilOpts), path.join(evil, "ok-case"));
  const made = ensureCaptureProfileDir(evilOpts);
  eq(made, physical(path.join(evil, "ok-case")));
  eq(modeOf(made), 0o700);
  ok(made.includes(`${path.sep}ExitTrace-evil${path.sep}`));
  eq(made.includes(`${path.sep}ExitTrace${path.sep}`), false);

  const inside = `${repo}${path.sep}`;
  const insideOpts = optsFor(inside, "nope", { repoRoot: repo });
  throwsCode(() => resolveCaptureProfileDir(insideOpts), "capture_profile_in_repo");
  throwsCode(() => ensureCaptureProfileDir(insideOpts), "capture_profile_in_repo");
  eq(fs.existsSync(path.join(repo, "nope")), false);
});

test("trailing slashes inside a repo are refused", () => {
  const repo = path.join(scratch, "slash-repo");
  fs.mkdirSync(repo, { mode: 0o700 });
  const base = `${repo}${path.sep}${path.sep}scratch${path.sep}${path.sep}${path.sep}`;
  ok(base.endsWith(`${path.sep}${path.sep}${path.sep}`));
  const opts = optsFor(base, "slash-case", { repoRoot: repo });
  throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_in_repo");
  throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_in_repo");
  eq(fs.existsSync(path.join(repo, "scratch")), false);
  eq(fs.existsSync(path.join(repo, "slash-case")), false);
});

test("bare git dirs are refused", () => {
  const bare = path.join(scratch, "bare.git");
  git(["init", "--bare", bare]);
  const before = treeList(bare);
  const bareOpts = optsFor(bare, "bare-case");
  throwsCode(() => resolveCaptureProfileDir(bareOpts), "capture_profile_in_git_tree");
  throwsCode(() => ensureCaptureProfileDir(bareOpts), "capture_profile_in_git_tree");
  eq(treeList(bare), before);

  const nested = path.join(bare, "objects", "x");
  const nestedOpts = optsFor(nested, "nested-case");
  throwsCode(() => resolveCaptureProfileDir(nestedOpts), "capture_profile_in_git_tree");
  throwsCode(() => ensureCaptureProfileDir(nestedOpts), "capture_profile_in_git_tree");
  eq(treeList(bare), before);
  eq(fs.existsSync(nested), false);
});

test("missing git fails closed", () => {
  const plain = path.join(scratch, "plain-nongit");
  fs.mkdirSync(plain, { mode: 0o700 });
  const opts = optsFor(plain, "plain-case", { gitBin: "/nonexistent" });
  throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_git_missing");
  throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_git_missing");
  eq(fs.existsSync(path.join(plain, "plain-case")), false);
  eq(modeOf(plain), 0o700);

  const emptyBin = path.join(scratch, "empty-bin");
  fs.mkdirSync(emptyBin, { mode: 0o700 });
  const cliBase = path.join(scratch, "cli-no-git");
  const cliRun = runCli(["no-git-case"], {
    PATH: emptyBin,
    ET_CAPTURE_PROFILE_DIR: cliBase,
  });
  eq(cliRun.status, 2);
  eq(cliRun.stdout, "");
  ok(/^ALERT capture profile capture_profile_git_missing: .+\n$/.test(cliRun.stderr));
  eq(fs.existsSync(cliBase), false);
});

test("an existing 0777 base is refused and keeps its mode", () => {
  const base = path.join(scratch, "open-base");
  fs.mkdirSync(base, { mode: 0o700 });
  fs.chmodSync(base, 0o777);
  eq(modeOf(base), 0o777);
  const opts = optsFor(base, "open-case");
  throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_writable");
  throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_writable");
  eq(modeOf(base), 0o777);
  eq(fs.existsSync(path.join(base, "open-case")), false);
});

test("a non-sticky 0777 ancestor is refused", () => {
  const ww = path.join(scratch, "ww");
  fs.mkdirSync(ww, { mode: 0o700 });
  fs.chmodSync(ww, 0o777);
  eq(modeOf(ww), 0o777);
  const base = path.join(ww, "base");
  const opts = optsFor(base, "ww-case");
  throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_ancestor_perm");
  throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_ancestor_perm");
  eq(modeOf(ww), 0o777);
  eq(fs.existsSync(base), false);
});

test("a sticky 01777 ancestor is accepted", () => {
  const sticky = path.join(scratch, "sticky");
  fs.mkdirSync(sticky, { mode: 0o700 });
  fs.chmodSync(sticky, 0o1777);
  eq(fs.statSync(sticky).mode & 0o7777, 0o1777);
  const base = path.join(sticky, "base");
  const made = ensureCaptureProfileDir(optsFor(base, "leaf"));
  eq(made, physical(path.join(base, "leaf")));
  eq(modeOf(made), 0o700);
  eq(modeOf(base), 0o700);
  eq(fs.statSync(sticky).mode & 0o7777, 0o1777);
});

test("an ancestor owned by someone else is refused", () => {
  const base = path.join(scratch, "anc-owner", "base");
  const mine = process.geteuid();
  const other = mine === 0 ? 1 : mine + 1;
  const predOpts = optsFor(base, "pred-case", { ancestorOwnerOk: () => false });
  throwsCode(() => resolveCaptureProfileDir(predOpts), "capture_profile_ancestor_owner");
  throwsCode(() => ensureCaptureProfileDir(predOpts), "capture_profile_ancestor_owner");
  if (fs.lstatSync(scratch).uid !== 0) {
    const euidOpts = optsFor(base, "euid-case", { euid: other });
    throwsCode(() => resolveCaptureProfileDir(euidOpts), "capture_profile_ancestor_owner");
    throwsCode(() => ensureCaptureProfileDir(euidOpts), "capture_profile_ancestor_owner");
  }
  eq(fs.existsSync(path.join(scratch, "anc-owner")), false);
});

test("the mkdtemp parent is sticky, root-owned, and accepted", () => {
  const parent = fs.realpathSync.native(path.dirname(scratch));
  const st = fs.lstatSync(parent);
  eq(parent, fs.realpathSync.native(os.tmpdir()));
  eq(st.uid, 0);
  eq(st.mode & 0o7777, 0o1777);
  const made = ensureCaptureProfileDir(optsFor(path.join(scratch, "under-tmp"), "ok-case"));
  eq(modeOf(made), 0o700);
  eq(fs.lstatSync(made).uid, process.geteuid());
});
