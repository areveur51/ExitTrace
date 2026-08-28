import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

// Patterns are encoded so this file does not contain the raw host strings.
const PATTERNS = [
  "tail" + "scale",
  "Grok" + "Build",
  "lab" + " writer",
  "Election" + "Trace",
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

test("public tree has no private-host strings", () => {
  const args = [
    "-n",
    "-F",
    "--hidden",
    "-g",
    "!node_modules/**",
    "-g",
    "!.git/**",
    "-g",
    "!dist/**",
    "-g",
    "!*.jpg",
    "-g",
    "!*.png",
    "-g",
    "!*.webp",
    "-g",
    "!tests/sanitize.test.mjs",
  ];
  for (const p of PATTERNS) {
    args.push("-e", p);
  }
  try {
    const out = execFileSync("rg", args, { encoding: "utf8" });
    assert.equal(out, "", `sanitize hits:\n${out}`);
  } catch (err) {
    if (err.status === 1) return;
    throw err;
  }
});
