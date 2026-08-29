import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Encoded so this file does not contain the raw host strings.
const PATTERNS = [
  "tail" + "scale",
  "Grok" + "Build",
  "lab" + " writer",
  "Election" + "Trace",
  "Chrono" + "Trace",
  "chrono" + "trace",
  "pop" + "-os",
  "Pop" + "!_OS",
  "home" + " lab",
  "home" + "lab",
  "Agent" + "X",
  "40" + "KFT",
  "/o" + "pt/",
  "192." + "168.",
  "10.0." + "0.",
  "100." + "64.",
  "syno" + "logy",
  "true" + "NAS",
  "true" + "nas",
  "wire" + "guard",
  "Wire" + "Guard",
];

const SKIP_DIR = new Set([".git", "node_modules", "dist"]);
const SKIP_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (!SKIP_EXT.has(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

test("public tree has no private-host strings", () => {
  const hits = [];
  for (const file of walk(ROOT)) {
    if (file.endsWith(`${path.sep}tests${path.sep}sanitize.test.mjs`)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const pat of PATTERNS) {
      if (text.includes(pat)) hits.push(`${path.relative(ROOT, file)}: ${pat}`);
    }
  }
  assert.equal(hits.join("\n"), "", hits.join("\n"));
});
