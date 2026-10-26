import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SELECT_TAGGED, UPDATE_TAGS, retireTagMain } from "../scripts/ops/et-retire-tag.mjs";
import { SELECT_IDS, retireTagUndoMain } from "../scripts/ops/et-retire-tag-undo.mjs";
import {
  CONFIRM_ENV,
  buildManifest,
  defaultManifestPath,
  LAB_IDENTITY,
  LAB_IDENTITY_SQL,
  labConnectionConfig,
  labGuard,
  labIdentityCheck,
  planStrip,
  planUndo,
  retiredTagCheck,
  stripTag,
  tagSpellings,
  tagsEqual,
  withClient,
  writePrivateJson,
} from "../scripts/ops/retire-tag-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "retire-tag");
const LAB_URL = "postgres://lab-user@127.0.0.1:5433/exittrace";
const TAG_ARGS = ["--tag", "federal_investigation"];
const SPELL = tagSpellings("federal_investigation");
const CONFIRM = { [CONFIRM_ENV]: "lab" };

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE, name), "utf8"));
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `et-retire-tag-${label}-`));
}

function peopleClient(rows, { failSlug = "", onUpdate = null } = {}) {
  const state = new Map(rows.map((row) => [row.id, row.tags.slice()]));
  const queries = [];
  return {
    queries,
    state,
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.startsWith(SELECT_TAGGED)) {
        const want = new Set(params || []);
        const out = [...state.entries()]
          .filter(([, tags]) => tags.some((t) => want.has(t)))
          .map(([id, tags]) => ({ id, tags: tags.slice() }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return { rows: out, rowCount: out.length };
      }
      if (text.startsWith(SELECT_IDS)) {
        const ids = new Set(params?.[0] || []);
        const out = [...state.entries()]
          .filter(([id]) => ids.has(id))
          .map(([id, tags]) => ({ id, tags: tags.slice() }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return { rows: out, rowCount: out.length };
      }
      if (text.startsWith("UPDATE")) {
        if (onUpdate) onUpdate({ sql: text, params });
        if (params?.[1] === failSlug) return { rows: [], rowCount: 0 };
        const current = state.get(params[1]);
        if (!tagsEqual(current, JSON.parse(params[2]))) return { rows: [], rowCount: 0 };
        state.set(params[1], JSON.parse(params[0]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

function bombClient() {
  const queries = [];
  return {
    queries,
    async query() {
      queries.push({ sql: "unexpected" });
      throw new Error("client should not be used");
    },
  };
}

function labEnv(extra = {}) {
  return { DATABASE_URL: LAB_URL, ...extra };
}

function strip(argv) {
  return ["node", "et-retire-tag.mjs", ...TAG_ARGS, ...argv];
}

function undo(argv) {
  return ["node", "et-retire-tag-undo.mjs", ...TAG_ARGS, ...argv];
}

test("TAG and HYPHEN are derived from --tag, and a live tag is refused", () => {
  assert.deepEqual(tagSpellings("federal_investigation"), {
    ok: true,
    TAG: "federal_investigation",
    HYPHEN: "federal-investigation",
  });
  assert.equal(tagSpellings("federal-investigation").TAG, "federal_investigation");
  assert.deepEqual(tagSpellings("some_old_tag"), { ok: true, TAG: "some_old_tag", HYPHEN: "some-old-tag" });
  assert.equal(tagSpellings("Bad Tag").ok, false);
  assert.equal(tagSpellings("").ok, false);
  assert.equal(retiredTagCheck("federal_investigation").ok, true);
  assert.match(retiredTagCheck("fraud").message, /still a live tag/);
  assert.match(retiredTagCheck("official").message, /still a live tag/);
});

test("stripTag keeps fraud and other values, drops both spellings, and copies", () => {
  const people = readJson("people.json");
  const both = people.find((row) => row.id === "fictional-both-spellings");
  const sage = people.find((row) => row.id === "fictional-sage-clear");
  const look = people.find((row) => row.id === "fictional-lookalike");
  const original = both.tags.slice();
  assert.deepEqual(stripTag(both.tags, SPELL), ["fraud", "official", "kept-unknown"]);
  assert.deepEqual(both.tags, original);
  const same = stripTag(sage.tags, SPELL);
  assert.deepEqual(same, ["official", "fraud"]);
  assert.notEqual(same, sage.tags);
  assert.deepEqual(stripTag(look.tags, SPELL), ["Federal_Investigation", "fraud"]);
  assert.deepEqual(stripTag(null, SPELL), []);
  const other = tagSpellings("some_old_tag");
  assert.deepEqual(stripTag(["fraud", "some-old-tag", "some_old_tag", "federal_investigation"], other), [
    "fraud",
    "federal_investigation",
  ]);
});

test("planStrip, buildManifest, and planUndo use the fixtures", () => {
  const people = readJson("people.json");
  const plan = planStrip(people, SPELL);
  assert.deepEqual(
    plan.map((card) => card.slug),
    ["fictional-both-spellings", "fictional-quinn-example", "fictional-river-sample"],
  );
  const quinn = plan.find((card) => card.slug === "fictional-quinn-example");
  const stored = people.find((row) => row.id === "fictional-quinn-example");
  assert.deepEqual(quinn.prior_tags, stored.tags);
  assert.notEqual(quinn.prior_tags, stored.tags);
  assert.deepEqual(quinn.next_tags, ["official", "fraud", "kept-unknown"]);

  const manifest = buildManifest(plan, SPELL, { created_at: "2026-10-22T00:00:00.000Z", db_label: "lab" });
  assert.equal(manifest.kind, "et-retire-tag");
  assert.equal(manifest.tag, "federal_investigation");
  assert.deepEqual(Object.keys(manifest.cards[0]).sort(), ["prior_tags", "slug"]);
  assert.deepEqual(manifest.cards[1].prior_tags, quinn.prior_tags);

  const plannedUndo = planUndo(readJson("manifest.json"), readJson("current-rows.json"));
  assert.deepEqual(
    plannedUndo.map((card) => [card.slug, card.status]),
    [
      ["fictional-quinn-example", "restore"],
      ["fictional-missing-card", "missing"],
      ["fictional-noop-card", "noop"],
      ["fictional-already-prior", "noop"],
    ],
  );
  assert.deepEqual(plannedUndo[0].next_tags, ["official", "federal_investigation", "fraud", "kept-unknown"]);
});

test("dry-run reads inside a read-only transaction and writes nothing", async () => {
  const cwd = tempDir("dry");
  const client = peopleClient(readJson("people.json"));
  const result = await retireTagMain({ argv: strip(["--dry-run"]), env: labEnv(), client, cwd });
  assert.equal(result.code, 0);
  assert.deepEqual(client.queries.map((q) => q.sql), ["BEGIN READ ONLY", SELECT_TAGGED, "ROLLBACK"]);
  assert.deepEqual(client.queries[1].params, ["federal_investigation", "federal-investigation"]);
  assert.equal(client.queries.some((q) => /UPDATE/i.test(q.sql)), false);
  assert.equal(fs.existsSync(path.join(cwd, "var")), false);
  const out = result.lines.join("\n");
  assert.match(out, /host-kind lab/);
  assert.match(out, /tag federal_investigation/);
  assert.match(out, /count 3/);
  assert.equal(out.includes(LAB_URL), false);
});

test("dry-run is the default when no mode flag is given", async () => {
  const client = peopleClient(readJson("people.json"));
  const result = await retireTagMain({ argv: strip([]), env: labEnv(CONFIRM), client, cwd: tempDir("default") });
  assert.equal(result.code, 0);
  assert.equal(client.queries[0].sql, "BEGIN READ ONLY");
  assert.equal(client.queries.some((q) => q.sql.startsWith("UPDATE")), false);
});

test("apply writes a 0600 manifest in a 0700 dir before updating only the tags column", async () => {
  const dir = tempDir("apply");
  const manifestPath = path.join(dir, "private", "manifest.json");
  let manifestAtUpdate = null;
  let fileMode = null;
  let dirMode = null;
  const people = readJson("people.json");
  const client = peopleClient(people, {
    onUpdate() {
      manifestAtUpdate = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      fileMode = fs.statSync(manifestPath).mode & 0o777;
      dirMode = fs.statSync(path.dirname(manifestPath)).mode & 0o777;
    },
  });
  const result = await retireTagMain({
    argv: strip(["--apply", "--manifest", manifestPath]),
    env: labEnv(CONFIRM),
    client,
    cwd: dir,
  });
  assert.equal(result.code, 0);
  assert.ok(manifestAtUpdate);
  assert.equal(fileMode, 0o600);
  assert.equal(dirMode, 0o700);
  const plan = planStrip(people, SPELL);
  assert.deepEqual(manifestAtUpdate.cards, buildManifest(plan, SPELL).cards);
  const sqls = client.queries.map((q) => q.sql);
  assert.equal(sqls[0], "BEGIN");
  assert.equal(sqls[1], `${SELECT_TAGGED} FOR UPDATE`);
  assert.equal(sqls.at(-1), "COMMIT");
  const updates = client.queries.filter((q) => q.sql.startsWith("UPDATE"));
  assert.equal(updates.length, plan.length);
  for (const query of updates) {
    assert.equal(query.sql, UPDATE_TAGS);
    const card = plan.find((item) => item.slug === query.params[1]);
    assert.deepEqual(JSON.parse(query.params[0]), card.next_tags);
    assert.deepEqual(JSON.parse(query.params[2]), card.prior_tags);
    assert.deepEqual(client.state.get(card.slug), card.next_tags);
  }
  assert.deepEqual(client.state.get("fictional-sage-clear"), ["official", "fraud"]);
  assert.deepEqual(client.state.get("fictional-lookalike"), ["Federal_Investigation", "fraud"]);
});

test("the default manifest lands under cwd/var/ops (gitignored) with 0700 and 0600", async () => {
  const cwd = tempDir("default-manifest");
  const now = new Date("2026-10-22T15:04:05.000Z");
  const expected = defaultManifestPath(cwd, SPELL, now);
  const client = peopleClient(readJson("people.json"));
  const result = await retireTagMain({ argv: strip(["--apply"]), env: labEnv(CONFIRM), client, cwd, now });
  assert.equal(result.code, 0);
  assert.equal(result.manifestPath, expected);
  assert.match(expected, /var\/ops\/et-retire-tag\/manifest-federal_investigation-20261022T150405Z\.json$/);
  assert.equal(fs.statSync(expected).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(expected)).mode & 0o777, 0o700);
  const ignore = fs.readFileSync(path.join(HERE, "..", ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
  assert.ok(ignore.includes("var/"), ".gitignore must keep var/ so manifests are never committed");
});

test("writePrivateJson tightens an existing looser manifest dir to 0700", () => {
  const dir = path.join(tempDir("loose"), "m");
  fs.mkdirSync(dir, { mode: 0o755 });
  fs.chmodSync(dir, 0o755);
  writePrivateJson(path.join(dir, "x.json"), { a: 1 });
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, "x.json")).mode & 0o777, 0o600);
});

test("a failed tags update rolls the transaction back", async () => {
  const dir = tempDir("fail");
  const client = peopleClient(readJson("people.json"), { failSlug: "fictional-quinn-example" });
  const result = await retireTagMain({
    argv: strip(["--apply", "--manifest", path.join(dir, "manifest.json")]),
    env: labEnv(CONFIRM),
    client,
    cwd: dir,
  });
  assert.notEqual(result.code, 0);
  const sqls = client.queries.map((q) => q.sql);
  assert.equal(sqls.includes("COMMIT"), false);
  assert.equal(sqls.at(-1), "ROLLBACK");
});

test("undo restores exact prior tags and skips missing, noop, and diverged cards", async () => {
  const dir = tempDir("undo");
  const manifest = {
    kind: "et-retire-tag",
    tag: "federal_investigation",
    created_at: "2026-10-22T00:00:00.000Z",
    db_label: "lab",
    cards: [
      { slug: "fictional-quinn-example", prior_tags: ["official", "federal_investigation", "fraud", "kept-unknown"] },
      { slug: "fictional-missing-card", prior_tags: ["federal_investigation"] },
      { slug: "fictional-noop-card", prior_tags: ["fraud", "official"] },
      { slug: "fictional-edited", prior_tags: ["fraud", "federal_investigation"] },
    ],
  };
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const rows = [
    { id: "fictional-quinn-example", tags: ["official", "fraud", "kept-unknown"] },
    { id: "fictional-noop-card", tags: ["fraud", "official"] },
    { id: "fictional-edited", tags: ["fraud", "some-other-fact"] },
  ];
  const dry = peopleClient(rows);
  const dryResult = await retireTagUndoMain({ argv: undo(["--manifest", manifestPath]), env: labEnv(), client: dry, cwd: dir });
  assert.equal(dryResult.code, 0);
  assert.deepEqual(dry.queries.map((q) => q.sql), ["BEGIN READ ONLY", SELECT_IDS, "ROLLBACK"]);
  const dryOut = dryResult.lines.join("\n");
  assert.match(dryOut, /restore fictional-quinn-example/);
  assert.match(dryOut, /noop fictional-noop-card/);
  assert.match(dryOut, /skipped missing fictional-missing-card/);
  assert.match(dryOut, /skipped changed fictional-edited/);

  const apply = peopleClient(rows);
  const applied = await retireTagUndoMain({
    argv: undo(["--manifest", manifestPath, "--apply"]),
    env: labEnv(CONFIRM),
    client: apply,
    cwd: dir,
  });
  assert.equal(applied.code, 0);
  const updates = apply.queries.filter((q) => q.sql.startsWith("UPDATE"));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].sql, UPDATE_TAGS);
  assert.deepEqual(JSON.parse(updates[0].params[0]), manifest.cards[0].prior_tags);
  assert.deepEqual(JSON.parse(updates[0].params[2]), ["official", "fraud", "kept-unknown"]);
  assert.deepEqual(apply.state.get("fictional-quinn-example"), manifest.cards[0].prior_tags);
  assert.deepEqual(apply.state.get("fictional-edited"), ["fraud", "some-other-fact"]);
  assert.equal(apply.queries.at(-1).sql, "COMMIT");

  const forced = peopleClient(rows);
  const forceResult = await retireTagUndoMain({
    argv: undo(["--manifest", manifestPath, "--apply", "--force"]),
    env: labEnv(CONFIRM),
    client: forced,
    cwd: dir,
  });
  assert.equal(forceResult.code, 0);
  assert.deepEqual(forced.state.get("fictional-edited"), ["fraud", "federal_investigation"]);
});

test("undo refuses a manifest for another tag and a dry-run preview", async () => {
  const dir = tempDir("undo-refuse");
  const other = path.join(dir, "other.json");
  fs.writeFileSync(other, JSON.stringify({ kind: "et-retire-tag", tag: "some_old_tag", cards: [] }));
  const preview = path.join(dir, "preview.json");
  fs.writeFileSync(preview, JSON.stringify({ kind: "et-retire-tag", tag: "federal_investigation", dry_run: true, cards: [] }));
  for (const [file, pattern] of [[other, /does not match --tag/], [preview, /dry-run preview/]]) {
    const client = bombClient();
    const result = await retireTagUndoMain({ argv: undo(["--manifest", file]), env: labEnv(), client, cwd: dir });
    assert.notEqual(result.code, 0);
    assert.match(result.lines.join("\n"), pattern);
    assert.equal(client.queries.length, 0);
  }
});

test("lab guard is an allowlist: loopback on the lab port only", () => {
  for (const url of [
    "postgres://lab-user@127.0.0.1:5433/exittrace",
    "postgres://lab-user@localhost:5433/exittrace",
    "postgresql://lab-user:x@LOCALHOST:5433/exittrace",
  ]) {
    assert.equal(labGuard({ DATABASE_URL: url }).ok, true, "allowed");
    assert.equal(labGuard({ DATABASE_URL: url }).label, "lab");
  }
  const refused = [
    ["postgres://u@dpg-abc123xyz/exittrace", /hosted database/],
    ["postgres://u@dpg-abc123xyz-a:5433/exittrace", /hosted database/],
    ["postgres://u@dpg-abc123xyz-a.oregon-postgres.render.com/exittrace", /hosted database/],
    ["postgres://u@db.example.render.com:5433/exittrace", /hosted database/],
    ["postgres://u@x.oregon-postgres.internal/exittrace", /hosted database/],
    ["postgres://u@127.0.0.1:5434/exittrace", /not the lab/],
    ["postgres://u@127.0.0.1/exittrace", /not the lab/],
    ["postgres://u@10.1.2.3:5433/exittrace", /not the lab/],
    ["postgres://u@db.example.com:5433/exittrace", /not the lab/],
    // Worf r5 MED-3: node-postgres honours these over the URL host.
    ["postgres://u@127.0.0.1:5433/exittrace?host=db.example.invalid", /query string or fragment/],
    ["postgres://u@127.0.0.1:5433/exittrace?hostaddr=203.0.113.9&port=5432", /query string or fragment/],
    ["postgres://u@127.0.0.1:5433/exittrace?host=dpg-abc123xyz-a.oregon-postgres.render.com", /query string or fragment/],
    ["postgresql://u:x@LOCALHOST:5433/exittrace?sslmode=disable", /query string or fragment/],
    ["postgres://u@127.0.0.1:5433/exittrace?", /query string or fragment/],
    ["postgres://u@127.0.0.1:5433/exittrace#x", /query string or fragment/],
    ["postgres://u@127.0.0.1:5433/postgres", /not the lab database/],
    ["postgres://u@127.0.0.1:5433/exittrace/x", /not the lab database/],
    ["postgres://u@127.0.0.1:5433/", /not the lab database/],
    ["postgres://u:%E0%A4%A@127.0.0.1:5433/exittrace", /not a usable/],
  ];
  for (const [url, pattern] of refused) {
    const guard = labGuard({ DATABASE_URL: url });
    assert.equal(guard.ok, false, "refused");
    assert.match(guard.message, pattern);
    assert.equal(guard.message.includes("dpg-"), false);
    assert.equal(guard.message.includes("render.com"), false);
  }
});

test("CLI guards refuse a missing URL, a hosted database, and an unconfirmed apply", async () => {
  const cases = [
    { run: retireTagMain, argv: strip(["--dry-run"]), env: { DATABASE_URL: "" }, pattern: /DATABASE_URL is missing or empty/ },
    { run: retireTagMain, argv: strip(["--dry-run"]), env: {}, pattern: /DATABASE_URL is missing or empty/ },
    { run: retireTagMain, argv: strip(["--dry-run"]), env: { DATABASE_URL: "postgres://lab-user@dpg-abc123xyz/exittrace" }, pattern: /hosted database/ },
    { run: retireTagMain, argv: strip(["--dry-run"]), env: { DATABASE_URL: "postgres://lab-user@db.example.render.com/exittrace" }, pattern: /hosted database/ },
    { run: retireTagMain, argv: strip(["--dry-run"]), env: labEnv({ RENDER: "true" }), pattern: /RENDER is set/ },
    { run: retireTagMain, argv: strip(["--apply"]), env: labEnv(), pattern: /ET_RETIRE_TAG_CONFIRM=lab/ },
    { run: retireTagMain, argv: strip(["--apply"]), env: labEnv({ ET_RETIRE_TAG_CONFIRM: "yes" }), pattern: /ET_RETIRE_TAG_CONFIRM=lab/ },
    { run: retireTagMain, argv: strip(["--dry-run", "--apply"]), env: labEnv(), pattern: /mutually exclusive/ },
    { run: retireTagMain, argv: ["node", "et-retire-tag.mjs", "--dry-run"], env: labEnv(), pattern: /--tag <id> is required/ },
    { run: retireTagMain, argv: ["node", "et-retire-tag.mjs", "--tag", "fraud"], env: labEnv(), pattern: /still a live tag/ },
    { run: retireTagUndoMain, argv: undo(["--manifest", "/tmp/et-retire-tag-unused.json"]), env: {}, pattern: /DATABASE_URL is missing or empty/ },
    { run: retireTagUndoMain, argv: undo(["--manifest", "/tmp/et-retire-tag-unused.json"]), env: { DATABASE_URL: "postgres://lab-user@dpg-abc123xyz/exittrace" }, pattern: /hosted database/ },
    { run: retireTagUndoMain, argv: undo(["--manifest", "/tmp/et-retire-tag-unused.json", "--apply"]), env: labEnv(), pattern: /ET_RETIRE_TAG_CONFIRM=lab/ },
    { run: retireTagUndoMain, argv: undo(["--apply"]), env: labEnv(CONFIRM), pattern: /--manifest is required/ },
  ];
  for (const item of cases) {
    const client = bombClient();
    const result = await item.run({ argv: item.argv, env: item.env, client, cwd: tempDir("guard") });
    assert.notEqual(result.code, 0, String(item.pattern));
    const out = result.lines.join("\n");
    assert.match(out, item.pattern);
    for (const secretish of ["lab-user", "render.com", "dpg-", LAB_URL]) assert.equal(out.includes(secretish), false);
    assert.equal(client.queries.length, 0);
  }
});

test("lab connect uses explicit fields and checks the lab identity tuple before any query (Worf r5 MED-3)", async () => {
  assert.deepEqual(labConnectionConfig("postgres://lab-user:p%40ss@127.0.0.1:5433/exittrace"), {
    host: "127.0.0.1", port: 5433, database: "exittrace", user: "lab-user", password: "p@ss",
  });
  assert.deepEqual(labConnectionConfig("postgres://localhost:5433/exittrace"), { host: "localhost", port: 5433, database: "exittrace" });
  for (const bad of ["postgres://u@127.0.0.1:5433/exittrace?host=db.example.invalid", "postgres://u@127.0.0.1:5433/exittrace#h", "postgres://u@db.example.invalid:5433/exittrace", "postgres://u@127.0.0.1:5432/exittrace", "postgres://u@127.0.0.1:5433/postgres", "nope"]) {
    assert.equal(labConnectionConfig(bad), null, bad);
  }
  assert.deepEqual({ ...LAB_IDENTITY }, { addr: "172.19.0.2", port: 5432, database: "exittrace", publication: "exittrace_lab_pub", slot: "exittrace_lab_sub" });

  const good = { addr: "172.19.0.2", port: 5432, db: "exittrace", publication: true, slot: true };
  const idClient = (row, opts = {}) => ({
    calls: [],
    ended: 0,
    async connect() {},
    async end() { this.ended += 1; },
    async query(text, params) {
      this.calls.push({ text, params });
      if (opts.throws) throw new Error("permission denied");
      return { rows: [row] };
    },
  });
  const c = idClient(good);
  assert.deepEqual(await labIdentityCheck(c), { ok: true });
  assert.equal(c.calls[0].text, LAB_IDENTITY_SQL);
  assert.deepEqual(c.calls[0].params, ["exittrace_lab_pub", "exittrace_lab_sub"]);
  for (const [extra, re] of [
    [{ addr: "127.0.0.1" }, /server address is not the lab/],
    [{ addr: null }, /server address is not the lab/],
    [{ addr: "" }, /server address is not the lab/],
    [{ addr: "203.0.113.9" }, /server address is not the lab/],
    [{ port: 5433 }, /server port is not the lab/],
    [{ db: "postgres" }, /database is not the lab database/],
    [{ publication: false }, /no lab publication/],
    [{ slot: false }, /no lab replication slot/],
    [{ slot: "t" }, /no lab replication slot/],
  ]) {
    const r = await labIdentityCheck(idClient({ ...good, ...extra }));
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.match(r.message, re);
    assert.equal(r.message.includes("203.0.113.9") || r.message.includes("172.19"), false);
  }
  assert.deepEqual(await labIdentityCheck(idClient(good, { throws: true })), { ok: false, message: "refused: lab identity check failed" });

  // withClient's own connection: explicit config, identity checked before fn; refused -> fn never runs, client ended.
  const fakePg = (row) => {
    const made = [];
    return { made, Client: class { constructor(cfg) { this.cfg = cfg; this.inner = idClient(row); made.push(this); } connect() { return this.inner.connect(); } end() { return this.inner.end(); } query(t, p) { return this.inner.query(t, p); } } };
  };
  let ran = 0;
  const fn = async () => { ran += 1; return { code: 0, lines: ["ran"], manifestPath: null }; };
  const okPg = fakePg(good);
  assert.deepEqual(await withClient(null, "postgres://lab-user:x@127.0.0.1:5433/exittrace", fn, { pg: okPg }), { code: 0, lines: ["ran"], manifestPath: null });
  assert.equal(ran, 1);
  assert.deepEqual(okPg.made[0].cfg, { host: "127.0.0.1", port: 5433, database: "exittrace", user: "lab-user", password: "x" });
  assert.equal(Object.hasOwn(okPg.made[0].cfg, "connectionString"), false);
  assert.equal(okPg.made[0].inner.ended, 1);
  const elsewhere = fakePg({ ...good, addr: "203.0.113.9", publication: false, slot: false });
  const refusedRun = await withClient(null, "postgres://lab-user:x@127.0.0.1:5433/exittrace", fn, { pg: elsewhere });
  assert.equal(refusedRun.code, 1);
  assert.match(refusedRun.lines.join("\n"), /server address is not the lab/);
  assert.equal(ran, 1, "fn did not run");
  assert.equal(elsewhere.made[0].inner.ended, 1);
  assert.equal(elsewhere.made[0].inner.calls.length, 1, "only the identity query ran");
  const neverPg = fakePg(good);
  const q = await withClient(null, "postgres://u@127.0.0.1:5433/exittrace?host=db.example.invalid", fn, { pg: neverPg });
  assert.equal(q.code, 1);
  assert.equal(neverPg.made.length, 0, "no client is built for a URL with a query string");
  assert.equal(ran, 1);
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts/ops/retire-tag-lib.mjs"), "utf8");
  assert.doesNotMatch(src, /connectionString\s*:/);
  assert.doesNotMatch(src, /new pg\.Client\(\s*\{/);
});
