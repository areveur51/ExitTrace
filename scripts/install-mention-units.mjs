#!/usr/bin/env node
/**
 * Fill systemd units with MENTION_INSTALL_PREFIX and print them.
 * The prefix is an operator path and is not stored in git.
 * Pass --out DIR to write the filled units there.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNIT_DIR = path.join(ROOT, "ops", "systemd");

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return "";
  return process.argv[i + 1] || "";
}

const prefix = String(process.env.MENTION_INSTALL_PREFIX || "").trim();
if (!prefix || !path.isAbsolute(prefix) || prefix.includes("\0")) {
  console.error("MENTION_INSTALL_PREFIX must be an absolute path");
  process.exit(1);
}

const outDir = arg("--out");
const files = fs
  .readdirSync(UNIT_DIR)
  .filter((name) => name.endsWith(".service") || name.endsWith(".timer"))
  .sort();

for (const name of files) {
  const text = fs
    .readFileSync(path.join(UNIT_DIR, name), "utf8")
    .replaceAll("__INSTALL_PREFIX__", prefix);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, name), text);
  } else {
    process.stdout.write(`# ${name}\n${text}\n`);
  }
}
