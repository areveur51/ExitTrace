#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl, loadDotEnv } from "../app/lib/env.mjs";
import {
  KEEP_UP_META_KEY_LIST,
  KEEP_UP_META_KEYS,
  stampPayload,
} from "../app/lib/keep-up.mjs";
import { closeStore, upsertEtMeta } from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));

function arg(name, fallback) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) return true;
  return next;
}

const key = arg("key");
const mode = arg("mode");
const atArg = arg("at");
const lagArg = arg("lag-seconds");

if (!key || key === true || !KEEP_UP_META_KEY_LIST.includes(key)) {
  console.error(`usage: node scripts/stamp-keep-up.mjs --key <et_meta key>`);
  console.error(`keys:\n  ${KEEP_UP_META_KEY_LIST.join("\n  ")}`);
  process.exit(1);
}

if (!databaseUrl()) {
  console.error("DATABASE_URL is required (et_meta is Postgres-only)");
  process.exit(1);
}

const opts = {};
if (key === KEEP_UP_META_KEYS.dumpRestoreMode) opts.mode = mode;
else if (key === KEEP_UP_META_KEYS.logicalLagSeconds) opts.at = Number(lagArg);
else if (atArg && atArg !== true) opts.at = atArg;

try {
  const payload = stampPayload(key, opts);
  await upsertEtMeta(key, payload);
  console.log(`ok ${key}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : "stamp failed");
  process.exit(1);
} finally {
  await closeStore();
}
