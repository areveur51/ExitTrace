#!/usr/bin/env node
/**
 * MENTION_DIG_COMMAND entry. One mention_queue JSON object on stdin.
 * One JSON envelope on stdout. Exit 0, including fail-closed.
 * Does not load an env file and does not read queue or X tokens.
 */
import { readFileSync } from "node:fs";
import { digMentionEnvelope } from "../app/lib/x-mention-dig.mjs";

const HELP = `Usage: node scripts/x-mention-dig.mjs

Reads one mention_queue JSON row on stdin and writes one JSON envelope on
stdout. Exit 0 when the envelope is printed, including fail-closed.

Does not read MENTION_QUEUE_* or X_API_* / X_ACCESS_* values. Does not write
KEEP rows. Cite URLs come from the subject post and its quote/ref chain.
The mention URL and the subject status URL are leads, not cites.
The plant command is in docs/X_MENTION_QUEUE.md.
`;

function emit(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

try {
  const raw = readFileSync(0, "utf8");
  let row;
  try {
    row = JSON.parse(String(raw || "").trim() || "null");
  } catch {
    emit({ outcome: "fail_closed", error_reason: "invalid_row" });
    process.exit(0);
  }
  emit(await digMentionEnvelope(row));
} catch {
  emit({ outcome: "fail_closed", error_reason: "dig_failed" });
}
process.exit(0);
