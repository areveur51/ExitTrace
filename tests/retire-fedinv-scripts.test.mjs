import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { retireFedinvMain } from "../scripts/ops/et-retire-fedinv-tag.mjs";
import { retireFedinvUndoMain } from "../scripts/ops/et-retire-fedinv-tag-undo.mjs";
import {
  TAG,
  buildManifest,
  defaultManifestPath,
  labGuard,
  planStrip,
  planUndo,
  stripTag,
  tagsEqual,
} from "../scripts/ops/retire-fedinv-lib.mjs";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "retire-fedinv",
);
const SELECT_RETIRED =
  "SELECT id, tags FROM people WHERE tags ? 'federal_investigation' OR tags ? 'federal-investigation' ORDER BY id";
const UPDATE_TAGS =
  "UPDATE people SET tags = $1::jsonb WHERE id = $2 AND tags = $3::jsonb";
const SELECT_IDS = "SELECT id, tags FROM people WHERE id = ANY($1::text[]) ORDER BY id";
const LAB_URL = "postgres://lab-user@127.0.0.1/exittrace";

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE, name), "utf8"));
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `et-retire-fedinv-${label}-`));
}

function hasRetired(tags) {
  return tags.includes("federal_investigation") || tags.includes("federal-investigation");
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
      const trimmed = text.trim();
      if (trimmed.startsWith("SELECT") && trimmed.includes("tags ?")) {
        const out = [...state.entries()]
          .filter(([, tags]) => hasRetired(tags))
          .map(([id, tags]) => ({ id, tags: tags.slice() }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return { rows: out, rowCount: out.length };
      }
      if (trimmed.startsWith("SELECT") && trimmed.includes("id = ANY")) {
        const ids = new Set(params?.[0] || []);
        const out = [...state.entries()]
          .filter(([id]) => ids.has(id))
          .map(([id, tags]) => ({ id, tags: tags.slice() }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return { rows: out, rowCount: out.length };
      }
      if (trimmed.startsWith("UPDATE")) {
        if (onUpdate) onUpdate({ sql: text, params });
        if (params?.[1] === failSlug) return { rows: [], rowCount: 0 };
        const next = JSON.parse(params[0]);
        const prior = JSON.parse(params[2]);
        const current = state.get(params[1]);
        if (!tagsEqual(current, prior)) return { rows: [], rowCount: 0 };
        state.set(params[1], next);
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

test("stripTag keeps fraud and other values, drops both spellings, and copies", () => {
  const people = readJson("people.json");
  const both = people.find((row) => row.id === "fictional-both-spellings");
  const sage = people.find((row) => row.id === "fictional-sage-clear");
  const look = people.find((row) => row.id === "fictional-lookalike");
  const original = both.tags.slice();
  assert.equal(TAG, "federal_investigation");
  assert.deepEqual(stripTag(both.tags), ["fraud", "official", "kept-unknown"]);
  assert.deepEqual(both.tags, original);
  const same = stripTag(sage.tags);
  assert.deepEqual(same, ["official", "fraud"]);
  assert.notEqual(same, sage.tags);
  assert.deepEqual(stripTag(look.tags), ["Federal_Investigation", "fraud"]);
  assert.deepEqual(stripTag(null), []);
});

test("planStrip, buildManifest, and planUndo use the fixtures", () => {
  const people = readJson("people.json");
  const plan = planStrip(people);
  assert.deepEqual(
    plan.map((card) => card.slug),
    ["fictional-both-spellings", "fictional-quinn-example", "fictional-river-sample"],
  );
  const quinn = plan.find((card) => card.slug === "fictional-quinn-example");
  const stored = people.find((row) => row.id === "fictional-quinn-example");
  assert.deepEqual(quinn.prior_tags, stored.tags);
  assert.notEqual(quinn.prior_tags, stored.tags);
  assert.deepEqual(quinn.next_tags, ["official", "fraud", "kept-unknown"]);
  assert.equal(
    plan.some((card) => card.slug === "fictional-sage-clear" || card.slug === "fictional-lookalike"),
    false,
  );

  const manifest = buildManifest(plan, {
    created_at: "2026-10-22T00:00:00.000Z",
    db_label: "lab",
  });
  assert.equal(manifest.kind, "et-retire-fedinv-tag");
  assert.equal(manifest.tag, TAG);
  assert.equal(manifest.created_at, "2026-10-22T00:00:00.000Z");
  assert.equal(manifest.db_label, "lab");
  assert.deepEqual(
    manifest.cards.map((card) => card.slug),
    plan.map((card) => card.slug),
  );
  assert.deepEqual(Object.keys(manifest.cards[0]).sort(), ["prior_tags", "slug"]);
  assert.deepEqual(manifest.cards[1].prior_tags, quinn.prior_tags);

  const undo = planUndo(readJson("manifest.json"), readJson("current-rows.json"));
  assert.deepEqual(
    undo.map((card) => [card.slug, card.status]),
    [
      ["fictional-quinn-example", "restore"],
      ["fictional-missing-card", "missing"],
      ["fictional-noop-card", "noop"],
      ["fictional-already-prior", "noop"],
    ],
  );
  assert.deepEqual(undo[0].next_tags, [
    "official",
    "federal_investigation",
    "fraud",
    "kept-unknown",
  ]);
  assert.deepEqual(undo[0].current_tags, ["official", "fraud", "kept-unknown"]);
  assert.equal(undo[1].status, "missing");
  assert.deepEqual(undo[2].prior_tags, ["fraud", "official"]);
});

test("dry-run reads inside a read-only transaction and writes nothing", async () => {
  const cwd = tempDir("dry");
  const client = peopleClient(readJson("people.json"));
  const result = await retireFedinvMain({
    argv: ["node", "et-retire-fedinv-tag.mjs", "--dry-run"],
    env: labEnv(),
    client,
    cwd,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(
    client.queries.map((query) => query.sql),
    ["BEGIN READ ONLY", SELECT_RETIRED, "ROLLBACK"],
  );
  assert.equal(client.queries.some((query) => /UPDATE/i.test(query.sql)), false);
  assert.equal(fs.existsSync(path.join(cwd, "var")), false);
  assert.match(result.lines.join("\n"), /host-kind lab/);
  assert.match(result.lines.join("\n"), /count 3/);
  assert.match(result.lines.join("\n"), /fictional-quinn-example \["official","federal_investigation","fraud","kept-unknown"\]/);
  assert.equal(result.lines.join("\n").includes(LAB_URL), false);
});

test("dry-run writes a preview only when --manifest is explicit", async () => {
  const dir = tempDir("preview");
  const manifestPath = path.join(dir, "preview.json");
  const client = peopleClient(readJson("people.json"));
  const result = await retireFedinvMain({
    argv: ["node", "et-retire-fedinv-tag.mjs", "--manifest", manifestPath],
    env: labEnv(),
    client,
    cwd: dir,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(
    client.queries.map((query) => query.sql),
    ["BEGIN READ ONLY", SELECT_RETIRED, "ROLLBACK"],
  );
  const preview = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(preview.dry_run, true);
  assert.equal(preview.kind, "et-retire-fedinv-tag");
  assert.deepEqual(
    preview.cards.map((card) => card.slug),
    planStrip(readJson("people.json")).map((card) => card.slug),
  );
});

test("apply writes the manifest before updating only the tags column", async () => {
  const dir = tempDir("apply");
  const manifestPath = path.join(dir, "manifest.json");
  let manifestAtUpdate = null;
  let modeAtUpdate = null;
  const people = readJson("people.json");
  const client = peopleClient(people, {
    onUpdate() {
      manifestAtUpdate = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      modeAtUpdate = fs.statSync(manifestPath).mode & 0o777;
    },
  });
  const result = await retireFedinvMain({
    argv: ["node", "et-retire-fedinv-tag.mjs", "--apply", "--manifest", manifestPath],
    env: labEnv({ ET_RETIRE_FEDINV_CONFIRM: "lab" }),
    client,
    cwd: dir,
  });
  assert.equal(result.code, 0);
  assert.ok(manifestAtUpdate);
  assert.equal(modeAtUpdate, 0o600);
  const plan = planStrip(people);
  assert.deepEqual(manifestAtUpdate.cards, buildManifest(plan, manifestAtUpdate).cards);
  assert.equal(manifestAtUpdate.dry_run, undefined);
  const sqls = client.queries.map((query) => query.sql);
  assert.equal(sqls[0], "BEGIN");
  assert.equal(sqls[1], `${SELECT_RETIRED} FOR UPDATE`);
  assert.equal(sqls.at(-1), "COMMIT");
  const updates = client.queries.filter((query) => query.sql === UPDATE_TAGS);
  assert.equal(updates.length, plan.length);
  assert.equal(sqls.filter((sql) => sql.startsWith("UPDATE")).length, updates.length);
  for (const query of updates) {
    assert.equal(query.sql.includes("updated_at"), false);
    const card = plan.find((item) => item.slug === query.params[1]);
    assert.deepEqual(JSON.parse(query.params[0]), card.next_tags);
    assert.deepEqual(JSON.parse(query.params[2]), card.prior_tags);
    assert.deepEqual(client.state.get(card.slug), card.next_tags);
  }
  assert.deepEqual(client.state.get("fictional-sage-clear"), ["official", "fraud"]);
  assert.deepEqual(client.state.get("fictional-lookalike"), ["Federal_Investigation", "fraud"]);
  assert.match(result.lines.join("\n"), new RegExp(`manifest ${manifestPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("apply without an explicit manifest writes under cwd/var/ops", async () => {
  const cwd = tempDir("default-manifest");
  const now = new Date("2026-10-22T15:04:05.000Z");
  const expected = defaultManifestPath(cwd, now);
  const client = peopleClient(readJson("people.json"));
  const result = await retireFedinvMain({
    argv: ["node", "et-retire-fedinv-tag.mjs", "--apply"],
    env: labEnv({ ET_RETIRE_FEDINV_CONFIRM: "lab" }),
    client,
    cwd,
    now,
  });
  assert.equal(result.code, 0);
  assert.equal(result.manifestPath, expected);
  assert.equal(fs.existsSync(expected), true);
  assert.equal(expected.startsWith(`${cwd}${path.sep}`), true);
  assert.match(expected, /var\/ops\/et-retire-fedinv-tag\/manifest-20261022T150405Z\.json$/);
});

test("a failed tags update rolls the transaction back", async () => {
  const dir = tempDir("fail");
  const manifestPath = path.join(dir, "manifest.json");
  const client = peopleClient(readJson("people.json"), { failSlug: "fictional-quinn-example" });
  const result = await retireFedinvMain({
    argv: ["node", "et-retire-fedinv-tag.mjs", "--apply", "--manifest", manifestPath],
    env: labEnv({ ET_RETIRE_FEDINV_CONFIRM: "lab" }),
    client,
    cwd: dir,
  });
  assert.notEqual(result.code, 0);
  const sqls = client.queries.map((query) => query.sql);
  assert.equal(sqls.includes("COMMIT"), false);
  assert.equal(sqls.at(-1), "ROLLBACK");
  assert.match(result.lines.join("\n"), /fictional-quinn-example/);
});

test("undo restores exact prior tags and skips missing, noop, and diverged cards", async () => {
  const dir = tempDir("undo");
  const manifest = {
    kind: "et-retire-fedinv-tag",
    tag: TAG,
    created_at: "2026-10-22T00:00:00.000Z",
    db_label: "lab",
    cards: [
      {
        slug: "fictional-quinn-example",
        prior_tags: ["official", "federal_investigation", "fraud", "kept-unknown"],
      },
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
  const dryResult = await retireFedinvUndoMain({
    argv: ["node", "et-retire-fedinv-tag-undo.mjs", "--manifest", manifestPath, "--dry-run"],
    env: labEnv(),
    client: dry,
    cwd: dir,
  });
  assert.equal(dryResult.code, 0);
  assert.deepEqual(
    dry.queries.map((query) => query.sql),
    ["BEGIN READ ONLY", SELECT_IDS, "ROLLBACK"],
  );
  assert.match(dryResult.lines.join("\n"), /restore fictional-quinn-example/);
  assert.match(dryResult.lines.join("\n"), /noop fictional-noop-card/);
  assert.match(dryResult.lines.join("\n"), /skipped missing fictional-missing-card/);
  assert.match(dryResult.lines.join("\n"), /skipped changed fictional-edited/);

  const apply = peopleClient(rows);
  const applied = await retireFedinvUndoMain({
    argv: ["node", "et-retire-fedinv-tag-undo.mjs", "--manifest", manifestPath, "--apply"],
    env: labEnv({ ET_RETIRE_FEDINV_CONFIRM: "lab" }),
    client: apply,
    cwd: dir,
  });
  assert.equal(applied.code, 0);
  const updates = apply.queries.filter((query) => query.sql.startsWith("UPDATE"));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].sql, UPDATE_TAGS);
  assert.deepEqual(JSON.parse(updates[0].params[0]), manifest.cards[0].prior_tags);
  assert.deepEqual(JSON.parse(updates[0].params[2]), ["official", "fraud", "kept-unknown"]);
  assert.equal(updates[0].params[1], "fictional-quinn-example");
  assert.deepEqual(apply.state.get("fictional-quinn-example"), manifest.cards[0].prior_tags);
  assert.deepEqual(apply.state.get("fictional-edited"), ["fraud", "some-other-fact"]);
  assert.equal(apply.queries.at(-1).sql, "COMMIT");
  assert.match(applied.lines.join("\n"), /restored fictional-quinn-example/);
  assert.match(applied.lines.join("\n"), /skipped changed fictional-edited/);
});

test("undo --force restores a card whose tags changed after the strip", async () => {
  const dir = tempDir("force");
  const prior = ["fraud", "federal_investigation"];
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      kind: "et-retire-fedinv-tag",
      tag: TAG,
      created_at: "2026-10-22T00:00:00.000Z",
      db_label: "lab",
      cards: [{ slug: "fictional-edited", prior_tags: prior }],
    })}\n`,
  );
  const client = peopleClient([{ id: "fictional-edited", tags: ["fraud", "some-other-fact"] }]);
  const result = await retireFedinvUndoMain({
    argv: ["node", "et-retire-fedinv-tag-undo.mjs", "--manifest", manifestPath, "--apply", "--force"],
    env: labEnv({ ET_RETIRE_FEDINV_CONFIRM: "lab" }),
    client,
    cwd: dir,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(client.state.get("fictional-edited"), prior);
  const update = client.queries.find((query) => query.sql === UPDATE_TAGS);
  assert.deepEqual(JSON.parse(update.params[0]), prior);
  assert.deepEqual(JSON.parse(update.params[2]), ["fraud", "some-other-fact"]);
});

test("database guards refuse a missing URL, a hosted database, and an unconfirmed apply", async () => {
  const cases = [
    {
      run: retireFedinvMain,
      argv: ["node", "et-retire-fedinv-tag.mjs", "--dry-run"],
      env: { DATABASE_URL: "" },
      pattern: /DATABASE_URL is missing or empty/,
    },
    {
      run: retireFedinvMain,
      argv: ["node", "et-retire-fedinv-tag.mjs", "--dry-run"],
      env: { DATABASE_URL: "   " },
      pattern: /DATABASE_URL is missing or empty/,
    },
    {
      run: retireFedinvMain,
      argv: ["node", "et-retire-fedinv-tag.mjs", "--dry-run"],
      env: { DATABASE_URL: "postgres://lab-user@db.example.render.com/exittrace" },
      pattern: /not the lab/,
    },
    {
      run: retireFedinvMain,
      argv: ["node", "et-retire-fedinv-tag.mjs", "--dry-run"],
      env: { DATABASE_URL: "postgres://lab-user@db.example.oregon-postgres.internal/exittrace" },
      pattern: /not the lab/,
    },
    {
      run: retireFedinvMain,
      argv: ["node", "et-retire-fedinv-tag.mjs", "--dry-run"],
      env: { DATABASE_URL: LAB_URL, RENDER: "true" },
      pattern: /RENDER is set/,
    },
    {
      run: retireFedinvMain,
      argv: ["node", "et-retire-fedinv-tag.mjs", "--apply"],
      env: { DATABASE_URL: LAB_URL },
      pattern: /ET_RETIRE_FEDINV_CONFIRM=lab/,
    },
    {
      run: retireFedinvMain,
      argv: ["node", "et-retire-fedinv-tag.mjs", "--dry-run", "--apply"],
      env: labEnv(),
      pattern: /mutually exclusive/,
    },
    {
      run: retireFedinvUndoMain,
      argv: ["node", "et-retire-fedinv-tag-undo.mjs", "--manifest", "/tmp/et-retire-fedinv-unused.json"],
      env: {},
      pattern: /DATABASE_URL is missing or empty/,
    },
    {
      run: retireFedinvUndoMain,
      argv: ["node", "et-retire-fedinv-tag-undo.mjs", "--manifest", "/tmp/et-retire-fedinv-unused.json"],
      env: { DATABASE_URL: "postgres://lab-user@db.example.render.com/exittrace" },
      pattern: /not the lab/,
    },
    {
      run: retireFedinvUndoMain,
      argv: ["node", "et-retire-fedinv-tag-undo.mjs", "--manifest", "/tmp/et-retire-fedinv-unused.json", "--apply"],
      env: { DATABASE_URL: LAB_URL },
      pattern: /ET_RETIRE_FEDINV_CONFIRM=lab/,
    },
    {
      run: retireFedinvUndoMain,
      argv: ["node", "et-retire-fedinv-tag-undo.mjs", "--apply"],
      env: labEnv({ ET_RETIRE_FEDINV_CONFIRM: "lab" }),
      pattern: /--manifest is required/,
    },
  ];
  for (const item of cases) {
    const client = bombClient();
    const result = await item.run({ argv: item.argv, env: item.env, client, cwd: tempDir("guard") });
    assert.notEqual(result.code, 0, item.pattern);
    assert.match(result.lines.join("\n"), item.pattern);
    assert.equal(result.lines.join("\n").includes("lab-user"), false);
    assert.equal(result.lines.join("\n").includes("render.com"), false);
    assert.equal(result.lines.join("\n").includes("oregon-postgres"), false);
    assert.equal(result.lines.join("\n").includes(LAB_URL), false);
    assert.equal(client.queries.length, 0);
  }
  assert.equal(labGuard({ DATABASE_URL: LAB_URL }).label, "lab");
});
