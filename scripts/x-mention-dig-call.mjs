#!/usr/bin/env node
/**
 * One-shot client for the long-lived worker-host dig helper.
 * Stdin is one mention JSON object. Stdout is one JSON envelope.
 * Use this as MENTION_DIG_COMMAND. It does not spawn a dig by itself.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "../app/lib/env.mjs";
import { callWarmDig } from "../app/lib/x-mention-dig-warm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));

const HELP = `Usage: node scripts/x-mention-dig-call.mjs < row.json

Sends one row to the warm helper and writes one envelope.
MENTION_DIG_WARM_SOCKET names the socket. The value stays on the host.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const socketPath = String(process.env.MENTION_DIG_WARM_SOCKET || "").trim()
  || path.join(ROOT, "var", "x-mention-dig.sock");
const raw = fs.readFileSync(0, "utf8");
const row = JSON.parse(raw);
const envelope = await callWarmDig({ socketPath, row });
process.stdout.write(`${JSON.stringify(envelope)}\n`);
