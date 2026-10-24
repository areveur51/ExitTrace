import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultCaptureProfileBase,
  ensureCaptureProfileDir,
  resolveCaptureProfileDir,
} from "../scripts/lib/capture-profile.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "scripts", "capture-profile-dir.mjs");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "et-capture-test."));

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

function gitPorcelainIgnored(repo) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const run = spawnSync("git", ["status", "--porcelain", "--ignored"], {
    cwd: repo,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  eq(run.status, 0, run.stderr || "");
  return run.stdout;
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
  ok(scratchRel.startsWith("..") || path.isAbsolute(scratchRel));
});

test("default base follows the repo and stays outside it", () => {
  const caseName = "guilfoyle-newsom";
  const repoReal = fs.realpathSync(repoRoot);
  const base = path.resolve(repoReal, "..", "..", "exittrace", "capture-profiles");
  const expected = path.resolve(base, caseName);
  eq(fs.existsSync(base), false);
  eq(fs.existsSync(expected), false);
  eq(defaultCaptureProfileBase(repoRoot), base);
  eq(resolveCaptureProfileDir({ caseName, env: {}, repoRoot }), expected);
  eq(
    resolveCaptureProfileDir({ caseName, env: { ET_CAPTURE_PROFILE_DIR: "" }, repoRoot }),
    expected,
  );
  const rel = path.relative(repoReal, expected);
  ok(rel.startsWith("..") || path.isAbsolute(rel));
  ok(expected !== repoReal && !expected.startsWith(`${repoReal}${path.sep}`));
  eq(fs.existsSync(base), false);
  eq(fs.existsSync(expected), false);
});

test("default base follows a caller repo root", () => {
  const levelA = path.join(scratch, "level-a");
  const levelB = path.join(levelA, "level-b");
  const fakeRepo = path.join(levelB, "fake-repo");
  fs.mkdirSync(levelA, { mode: 0o700 });
  fs.mkdirSync(levelB, { mode: 0o700 });
  fs.mkdirSync(fakeRepo, { mode: 0o700 });
  const caseName = "fake-case";
  const fakeReal = fs.realpathSync(fakeRepo);
  const base = path.resolve(fakeReal, "..", "..", "exittrace", "capture-profiles");
  const expected = path.resolve(base, caseName);
  eq(defaultCaptureProfileBase(fakeRepo), base);
  eq(resolveCaptureProfileDir({ caseName, env: {}, repoRoot: fakeRepo }), expected);
  eq(
    resolveCaptureProfileDir({ caseName, env: { ET_CAPTURE_PROFILE_DIR: "" }, repoRoot: fakeRepo }),
    expected,
  );
  const rel = path.relative(fakeReal, expected);
  ok(rel.startsWith("..") || path.isAbsolute(rel));
  ok(expected !== fakeReal && !expected.startsWith(`${fakeReal}${path.sep}`));
  const scratchReal = fs.realpathSync(scratch);
  ok(base.startsWith(`${scratchReal}${path.sep}`));
  eq(fs.existsSync(base), false);
  eq(fs.existsSync(expected), false);
  eq(modeOf(scratch), 0o700);
  eq(modeOf(fakeRepo), 0o700);
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
        repoRoot,
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
      repoRoot,
    }),
    "capture_base_not_absolute",
  );
  eq(fs.existsSync(path.join(repoRoot, "capture-profile-relative")), false);
});

test("profile inside the repo is refused", () => {
  const before = gitPorcelainIgnored(repoRoot);
  const link = path.join(scratch, "repo-link");
  fs.symlinkSync(repoRoot, link);
  const cases = [
    ["inrepo-scratch", path.join(repoRoot, "scratch")],
    ["inrepo-root", repoRoot],
    ["inrepo-link", link],
  ];
  for (const [caseName, base] of cases) {
    const opts = { caseName, env: { ET_CAPTURE_PROFILE_DIR: base }, repoRoot };
    throwsCode(() => resolveCaptureProfileDir(opts), "capture_profile_in_repo");
    throwsCode(() => ensureCaptureProfileDir(opts), "capture_profile_in_repo");
  }
  eq(fs.existsSync(path.join(repoRoot, "scratch", "inrepo-scratch")), false);
  eq(fs.existsSync(path.join(repoRoot, "inrepo-root")), false);
  eq(fs.existsSync(path.join(repoRoot, "inrepo-link")), false);
  const cliRun = runCli(["inrepo-cli"], { ET_CAPTURE_PROFILE_DIR: repoRoot });
  eq(cliRun.status, 2);
  eq(cliRun.stdout, "");
  ok(/^ALERT capture profile capture_profile_in_repo: .+\n$/.test(cliRun.stderr));
  eq(fs.existsSync(path.join(repoRoot, "inrepo-cli")), false);
  eq(gitPorcelainIgnored(repoRoot), before);
  eq(modeOf(scratch), 0o700);
  ok(fs.lstatSync(link).isSymbolicLink());
});

test("ensure creates mode 700 and tightens a 755 leaf", () => {
  const base = path.join(scratch, "deep", "profiles");
  const created = ensureCaptureProfileDir({
    caseName: "hunter-biden",
    env: { ET_CAPTURE_PROFILE_DIR: base },
    repoRoot,
  });
  eq(created, path.join(base, "hunter-biden"));
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
  eq(tightened, leaf);
  eq(modeOf(leaf), 0o700);
  eq(modeOf(scratch), 0o700);
  eq(modeOf(tightenBase), 0o700);
});

test("CLI prints the path or an alert", () => {
  const base = path.join(scratch, "cli-home");
  const okRun = runCli(["cli-case"], { ET_CAPTURE_PROFILE_DIR: base });
  eq(okRun.status, 0);
  eq(okRun.stdout, `${path.join(base, "cli-case")}\n`);
  eq(okRun.stderr, "");
  eq(modeOf(base), 0o700);
  eq(modeOf(path.join(base, "cli-case")), 0o700);

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
  throwsCode(
    () => ensureCaptureProfileDir({
      caseName: "linked",
      env: { ET_CAPTURE_PROFILE_DIR: base },
      repoRoot,
    }),
    "capture_profile_symlink",
  );
  ok(fs.lstatSync(leaf).isSymbolicLink());
  eq(modeOf(target), 0o700);
  eq(modeOf(scratch), 0o700);
});
