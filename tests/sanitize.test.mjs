import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { DEFAULT_CAPTURE_PROFILE_BASE } from "../scripts/lib/capture-profile.mjs";

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
  "left" + "over",
  "wire" + "guard",
  "Wire" + "Guard",
];

const SKIP_DIR = new Set([".git", "node_modules", "dist", ".worktrees"]);
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

// Narrow workflow exception: constraint comments like "No leftover touch" are
// leftover-word FPs, not lab-path leaks. Skip ONLY the leftover pattern under
// .github/workflows; still scan those YAML files for IPs/tailscale/lab paths
// and other private-host needles (do not blanket-skip the whole workflows dir).
const LEFTOVER = "left" + "over";
const workflowSep = `${path.sep}.github${path.sep}workflows${path.sep}`;
// DIG_NEEDLES are exempt only for the mention queue doc. That file names the
// capture profile directory. The capture profile module is scanned after its
// single default-base export line is taken out, with every pattern enforced.
const DIG_DOC = `docs${path.sep}X_MENTION_QUEUE.md`;
const CAPTURE_PROFILE = `scripts${path.sep}lib${path.sep}capture-profile.mjs`;
const DIG_NEEDLES = new Set(["Grok" + "Build", "/o" + "pt/"]);
const DEFAULT_BASE_LINE = `export const DEFAULT_CAPTURE_PROFILE_BASE = ${JSON.stringify(DEFAULT_CAPTURE_PROFILE_BASE)};`;

function textForScan(rel, text) {
  if (rel !== CAPTURE_PROFILE) return text;
  const parts = text.split(DEFAULT_BASE_LINE);
  assert.equal(parts.length, 2, "default base line must appear exactly once");
  return parts.join("");
}

function collectHits(rel, text, isWorkflow) {
  const body = textForScan(rel, text);
  const hits = [];
  for (const pat of PATTERNS) {
    if (isWorkflow && pat === LEFTOVER) continue;
    if (rel === DIG_DOC && DIG_NEEDLES.has(pat)) continue;
    if (body.includes(pat)) hits.push(`${rel}: ${pat}`);
  }
  return hits;
}

test("public tree has no private-host strings", () => {
  const hits = [];
  for (const file of walk(ROOT)) {
    if (file.endsWith(`${path.sep}tests${path.sep}sanitize.test.mjs`)) continue;
    const rel = path.relative(ROOT, file);
    const isWorkflow = file.includes(workflowSep);
    const text = fs.readFileSync(file, "utf8");
    hits.push(...collectHits(rel, text, isWorkflow));
  }
  assert.equal(hits.join("\n"), "", hits.join("\n"));
});

test("a second host string in the capture profile module is flagged", () => {
  const text = `${DEFAULT_BASE_LINE}\nconst extra = ${JSON.stringify(DEFAULT_CAPTURE_PROFILE_BASE)};\n`;
  const hits = collectHits(CAPTURE_PROFILE, text, false);
  assert.ok(hits.some((hit) => [...DIG_NEEDLES].some((needle) => hit.includes(needle))));
});
