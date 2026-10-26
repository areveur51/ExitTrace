/** No-unlink guard for the daily ingest and the control script.
 *  Static: the shell scripts and the apply driver carry no delete command
 *  (comments and quoted text are ignored only for the JS driver's prose).
 *  Behaviour: a daily run and a failed exittracectl start, with delete
 *  commands shadowed on PATH by recording stubs, call none of them, and the
 *  files they used to delete are found under retired/ with their content. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["scripts/et-daily-ingest.sh", "exittracectl.sh", "scripts/et-daily-apply.mjs", "scripts/lib/retire.sh", "scripts/et-retired-report.sh"];
// Delete verbs as words (built from a list so this file stays plain data).
const VERBS = ["rm", "rmdir", "unlink", "shred", "truncate"];
const SHELL_DELETE = new RegExp(`(^|[\\s;&|(\`])(${VERBS.join("|")})(\\s|$)`);
const FIND_DELETE = /\s-delete\b/;
const JS_DELETE = /\b(rmSync|rmdirSync|unlinkSync|truncateSync|fs\.rm|fs\.rmdir|fs\.unlink|fs\.truncate|promises\.rm|promises\.unlink)\b/;
const CTL_FAIL_STUB = 'process.exit(3);\n';

function codeLines(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return text.split("\n").map((line, i) => ({ n: i + 1, line })).filter(({ line }) => {
    const t = line.trim();
    return t && !t.startsWith("#") && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  });
}

for (const rel of FILES) {
  test(`no-unlink: ${rel} has no delete command`, () => {
    const hits = codeLines(rel).filter(({ line }) =>
      SHELL_DELETE.test(line) || FIND_DELETE.test(line) || JS_DELETE.test(line));
    assert.deepEqual(hits, [], `delete commands found in ${rel}`);
  });
}

test("no-unlink: the grok prompt carries the no-delete line", () => {
  const text = fs.readFileSync(path.join(ROOT, "scripts/et-daily-ingest.sh"), "utf8");
  assert.match(text, /^no rm\/shred\/unlink \(mv to retired\/\), no lab :5220, no desktop browser$/m);
});

function stubBin(dir) {
  const bin = path.join(dir, "stub-bin");
  fs.mkdirSync(bin);
  for (const v of VERBS) {
    fs.writeFileSync(path.join(bin, v), `#!/bin/bash\necho "${v} $*" >> "${dir}/delete-calls"\nexit 1\n`, { mode: 0o755 });
  }
  return bin;
}

function deleteCalls(dir) {
  const f = path.join(dir, "delete-calls");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean) : [];
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Every path under dir (dirs included): type, mode, mtime and file content. */
function snapshot(dir) {
  const out = [];
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p);
      out.push([p, e.isDirectory() ? "d" : e.isSymbolicLink() ? "l" : "f", st.mode, st.mtimeMs, e.isFile() ? fs.readFileSync(p, "utf8") : ""]);
      if (e.isDirectory()) visit(p);
    }
  };
  const st = fs.lstatSync(dir);
  out.push([dir, "d", st.mode, st.mtimeMs, ""]);
  visit(dir);
  return out;
}

test("no-unlink: exittracectl failed start retires the pid file into var/retired/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-ctl-retire-"));
  fs.copyFileSync(path.join(ROOT, "exittracectl.sh"), path.join(dir, "exittracectl.sh"));
  // exittracectl sources scripts/lib/retire.sh and scripts/lib/proc.sh (main's retire_path).
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  for (const lib of ["retire.sh", "proc.sh"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", "lib", lib), path.join(dir, "scripts", "lib", lib));
  }
  fs.mkdirSync(path.join(dir, "app"));
  fs.writeFileSync(path.join(dir, "app", "server.mjs"), CTL_FAIL_STUB);
  const bin = stubBin(dir);
  const r = spawnSync("bash", [path.join(dir, "exittracectl.sh"), "start"], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      EXITTRACE_NODE: process.execPath,
      DATABASE_URL: "",
      PORT: "0",
      DATA_DIR: path.join(dir, "data"),
      MEDIA_DIR: path.join(dir, "media"),
    },
    encoding: "utf8",
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Failed to start/);
  assert.ok(!fs.existsSync(path.join(dir, "exittrace.pid")), "pid file no longer at its live path");
  const retired = path.join(dir, "var", "retired");
  assert.equal(fs.statSync(retired).mode & 0o777, 0o700);
  const moved = fs.readdirSync(retired).filter((n) => /^exittrace\.pid\.\d{8}-\d{6}\.start-fail(\.\d+)?$/.test(n));
  assert.equal(moved.length, 1, `one retired pid file: ${fs.readdirSync(retired)}`);
  assert.match(fs.readFileSync(path.join(retired, moved[0]), "utf8"), /^\d+\n$/);
  assert.deepEqual(deleteCalls(dir), []);

  // stop with no pid file is a no-op and still deletes nothing.
  const s = spawnSync("bash", [path.join(dir, "exittracectl.sh"), "stop"], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8",
  });
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /Stopped/);
  assert.deepEqual(deleteCalls(dir), []);
});

test("no-unlink: a daily rerun retires the earlier run's files instead of deleting them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-daily-retire-"));
  const bin = stubBin(dir);
  const day = spawnSync("date", ["+%Y%m%d"], { env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8" }).stdout.trim();
  const grok = path.join(dir, "grok-stub.sh");
  fs.writeFileSync(grok, "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const stale = {
    [`et-daily-${day}-apply.json`]: '{"rows":[{"subject":"Stale Row"}]}',
    [`et-daily-${day}-apply-summary.json`]: '{"picked":9}',
    [`et-daily-${day}-report.md`]: "prove=PASS stale-report\n",
    [`et-daily-${day}-prompt.md`]: "stale prompt\n",
  };
  for (const [n, body] of Object.entries(stale)) fs.writeFileSync(path.join(dir, n), body);
  const r = spawnSync("bash", [path.join(ROOT, "scripts", "et-daily-ingest.sh")], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "",
      ET_DAILY_DRY_RUN: "1",
      ET_DAILY_ROOT: ROOT,
      ET_DAILY_NODE: process.execPath,
      ET_DAILY_GROK: grok,
      ET_DAILY_HELPER: path.join(dir, "no-helper.mjs"),
      ET_DAILY_TMP: dir,
      ET_DAILY_LOCK: path.join(dir, "et-daily-ingest.lock"),
    },
    encoding: "utf8",
  });
  const rep = fs.readFileSync(path.join(dir, `et-daily-${day}-report.md`), "utf8");
  assert.equal(r.status, 1, rep);
  assert.match(rep, /prove=FAIL reason=missing-apply-json/, "the stale apply.json was not re-applied");
  assert.doesNotMatch(rep, /stale-report/, "new report starts fresh");
  assert.ok(!fs.existsSync(path.join(dir, `et-daily-${day}-apply.json`)));
  const rdir = path.join(dir, "retired");
  assert.equal(fs.statSync(rdir).mode & 0o777, 0o700);
  const runs = fs.readdirSync(rdir);
  assert.equal(runs.length, 1, `one retired run dir: ${runs}`);
  assert.match(runs[0], /^\d{8}-\d{6}-\d+$/);
  assert.equal(fs.statSync(path.join(rdir, runs[0])).mode & 0o777, 0o700);
  // main's retire_path names each file <base>.<YYYYmmdd-HHMMSS>.rerun[.N].
  const moved = fs.readdirSync(path.join(rdir, runs[0]));
  assert.equal(moved.length, Object.keys(stale).length, `one retired file per stale file: ${moved}`);
  for (const [n, body] of Object.entries(stale)) {
    const re = new RegExp(`^${n.replace(/[.]/g, "\\.")}\\.\\d{8}-\\d{6}\\.rerun(\\.\\d+)?$`);
    const hit = moved.filter((m) => re.test(m));
    assert.equal(hit.length, 1, `${n} retired once as <base>.<stamp>.rerun: ${moved}`);
    assert.equal(fs.readFileSync(path.join(rdir, runs[0], hit[0]), "utf8"), body, `${n} kept with its content`);
  }
  const prompt = fs.readFileSync(path.join(dir, `et-daily-${day}-prompt.md`), "utf8");
  assert.match(prompt, /^no rm\/shred\/unlink \(mv to retired\/\), no lab :5220, no desktop browser$/m);
  assert.deepEqual(deleteCalls(dir), [], "no delete command was called");
  assert.ok(walk(dir).length >= Object.keys(stale).length);
});

test("no-unlink: a daily rerun under a symlinked work dir fails closed and keeps the earlier files", () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "et-daily-symlink-"));
  const real = path.join(base, "real");
  fs.mkdirSync(real, { mode: 0o700 });
  const link = path.join(base, "link");
  fs.symlinkSync(real, link);
  const bin = stubBin(base);
  const day = spawnSync("date", ["+%Y%m%d"], { env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8" }).stdout.trim();
  const grok = path.join(base, "grok-stub.sh");
  fs.writeFileSync(grok, "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const apply = `et-daily-${day}-apply.json`;
  fs.writeFileSync(path.join(real, apply), '{"rows":[{"subject":"Stale Row"}]}');
  const r = spawnSync("bash", [path.join(ROOT, "scripts", "et-daily-ingest.sh")], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "",
      ET_DAILY_DRY_RUN: "1",
      ET_DAILY_ROOT: ROOT,
      ET_DAILY_NODE: process.execPath,
      ET_DAILY_GROK: grok,
      ET_DAILY_HELPER: path.join(base, "no-helper.mjs"),
      ET_DAILY_TMP: link,
      ET_DAILY_LOCK: path.join(base, "et-daily-ingest.lock"),
    },
    encoding: "utf8",
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /cannot retire earlier run files/);
  assert.equal(fs.readFileSync(path.join(real, apply), "utf8"), '{"rows":[{"subject":"Stale Row"}]}', "stale apply.json left in place");
  const rdir = path.join(real, "retired");
  assert.deepEqual(fs.existsSync(rdir) ? fs.readdirSync(rdir) : [], [], "nothing moved through the symlink");
  assert.deepEqual(deleteCalls(base), [], "no delete command was called");
});

test("no-unlink: et-retired-report lists retired/ by age, flags over-keep, and changes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-retired-report-"));
  const bin = stubBin(dir);
  const rdir = path.join(dir, "retired");
  fs.mkdirSync(rdir, { mode: 0o700 });
  const day = 86400;
  const now = Date.now() / 1000;
  const mk = (name, ageDays, files) => {
    const d = path.join(rdir, name);
    fs.mkdirSync(d, { mode: 0o700 });
    for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(d, n), body);
    const t = now - ageDays * day;
    fs.utimesSync(d, t, t);
  };
  mk("20260901-080000-111", 40, { "a.json.20260901-080000.rerun": "old-a", "b.md.20260901-080000.rerun": "old-b" });
  mk("20261020-080000-222", 3, { "c.json.20261020-080000.rerun": "new-c" });
  const loose = path.join(rdir, "loose.log");
  fs.writeFileSync(loose, "x");
  fs.utimesSync(loose, now - 20 * day, now - 20 * day);
  const before = snapshot(rdir);
  const run = (args, extra = {}) => spawnSync("bash", [path.join(ROOT, "scripts", "et-retired-report.sh"), ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extra }, encoding: "utf8",
  });
  const r = run([rdir]);
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split("\n");
  assert.equal(rows[0], "age_days\tfiles\tbytes\tstatus\tentry");
  const body = rows.slice(1, -1).map((l) => l.split("\t"));
  assert.deepEqual(body.map((c) => c[4]), ["20260901-080000-111", "loose.log", "20261020-080000-222"], "oldest first");
  assert.deepEqual(body.map((c) => c[3]), ["over-keep", "over-keep", "keep"]);
  assert.deepEqual(body.map((c) => c[1]), ["2", "1", "1"]);
  assert.deepEqual(body.map((c) => c[2]), ["10", "1", "5"], "bytes = the regular files' sizes");
  assert.ok(Number(body[0][0]) >= 39 && Number(body[2][0]) <= 3, `ages: ${body.map((c) => c[0])}`);
  assert.match(rows.at(-1), /^summary=entries:3 bytes:\d+ over_keep:2 over_keep_bytes:\d+ keep_days:14 dir:/);
  // A longer keep window flags only the 40-day run dir; the env default dir is $ET_DAILY_TMP/retired.
  const r30 = run([], { ET_DAILY_TMP: dir, ET_RETIRED_KEEP_DAYS: "30" });
  assert.equal(r30.status, 0, r30.stderr);
  assert.match(r30.stdout, /over_keep:1 .*keep_days:30 /);
  // Bad input fails with 2 and prints no rows.
  assert.equal(run([path.join(dir, "missing")]).status, 2);
  fs.symlinkSync(rdir, path.join(dir, "retired-link"));
  assert.equal(run([path.join(dir, "retired-link")]).status, 2);
  assert.equal(run([rdir], { ET_RETIRED_KEEP_DAYS: "2w" }).status, 2);
  // Report only: every path is still in place with its type, mode, mtime and content,
  // and no delete command ran.
  assert.deepEqual(snapshot(rdir), before);
  assert.deepEqual(deleteCalls(dir), []);
});

test("no-unlink: et-retired-report never evaluates an entry name (Worf MED-1, NIT-4)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-retired-name-"));
  const bin = stubBin(dir);
  const rdir = path.join(dir, "retired");
  fs.mkdirSync(rdir, { mode: 0o700 });
  // Worf's probe5 name: a newline, then text that bash arithmetic would evaluate.
  const evil = "z\nNOW[$(touch PWNED)]";
  fs.mkdirSync(path.join(rdir, evil), { mode: 0o700 });
  fs.writeFileSync(path.join(rdir, evil, "f.rerun"), "abc");
  fs.writeFileSync(path.join(rdir, "tab\tname.log"), "xy");
  const before = snapshot(rdir);
  const run = (extra = {}, binDir = bin) => spawnSync("bash", [path.join(ROOT, "scripts", "et-retired-report.sh"), rdir], {
    cwd: dir, env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...extra }, encoding: "utf8",
  });
  const r = run();
  assert.equal(fs.existsSync(path.join(dir, "PWNED")), false, "the name was not executed (cwd)");
  assert.equal(fs.existsSync(path.join(ROOT, "PWNED")), false, "the name was not executed (repo)");
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split("\n");
  assert.equal(rows.length, 4, "header + 2 rows + summary: a newline or tab in a name forges no row");
  const body = rows.slice(1, -1).map((l) => l.split("\t"));
  for (const c of body) assert.equal(c.length, 5, `5 columns: ${JSON.stringify(c)}`);
  const names = body.map((c) => c[4]).sort();
  assert.deepEqual(names, ["$'tab\\tname.log'", "$'z\\nNOW[$(touch PWNED)]'"], "names printed with printf %q");
  const byName = Object.fromEntries(body.map((c) => [c[4], c]));
  assert.equal(byName["$'z\\nNOW[$(touch PWNED)]'"][2], "3");
  assert.match(rows.at(-1), /^summary=entries:2 bytes:5 over_keep:0 /);
  // A size, count or mtime that is not a plain number fails closed (exit 3) and is never evaluated.
  const bad = path.join(dir, "bad-bin");
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, "stat"), `#!/bin/bash\necho 'NOW[$(touch ${dir}/PWNED2)]'\n`, { mode: 0o755 });
  const r3 = run({}, `${bad}:${bin}`);
  assert.equal(r3.status, 3, r3.stderr);
  assert.match(r3.stderr, /FAIL mtime is not a whole number/);
  assert.equal(fs.existsSync(path.join(dir, "PWNED2")), false, "stat output was not evaluated");
  assert.deepEqual(snapshot(rdir), before);
  assert.deepEqual(deleteCalls(dir), []);
});

test("no-unlink: et-retired-report refuses a '-dir' argument; ./-dir is read as a path (Worf LOW-2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-retired-dash-"));
  const bin = stubBin(dir);
  for (const name of ["-true", "-delete"]) {
    fs.mkdirSync(path.join(dir, name), { mode: 0o700 });
    fs.writeFileSync(path.join(dir, name, "keep.rerun"), name);
  }
  fs.writeFileSync(path.join(dir, "cwd-file"), "stays");
  const before = snapshot(dir);
  const run = (arg) => spawnSync("bash", [path.join(ROOT, "scripts", "et-retired-report.sh"), arg], {
    cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8",
  });
  for (const arg of ["-true", "-delete"]) {
    const r = run(arg);
    assert.equal(r.status, 2, `${arg}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /starts with '-'/);
    assert.equal(r.stdout, "", "no rows: find never ran with the argument as an expression");
  }
  const ok = run("./-delete");
  assert.equal(ok.status, 0, ok.stderr);
  const rows = ok.stdout.trim().split("\n");
  assert.deepEqual(rows.slice(1, -1).map((l) => l.split("\t")[4]), ["keep.rerun"], "./-delete lists its own entry, not the cwd");
  assert.match(rows.at(-1), new RegExp(`dir:${dir.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/-delete$`));
  assert.deepEqual(snapshot(dir), before, "nothing under the cwd changed");
  assert.deepEqual(deleteCalls(dir), []);
});
