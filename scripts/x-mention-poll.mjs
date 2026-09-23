#!/usr/bin/env node
/**
 * Poll @ExitTrace mentions and POST them to the Render mention queue.
 * Probes the queue before the X GET. Optional soft-ack stays off unless MENTION_SOFT_ACK is set.
 * Does not write KEEP.
 */
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "../app/lib/env.mjs";
import { pollIntervalMs } from "../app/lib/mention-queue.mjs";
import { pollJournal, pollOnce } from "../app/lib/x-mention-poll.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));

const HELP = `Usage: node scripts/x-mention-poll.mjs [--once] [--loop]

Reads mentions for the configured X user and POSTs them to the Render queue.
Probes POST /api/mention-queue/preflight before that X GET.
--once is the default (one pass, for a timer). --loop sleeps between passes.

Environment names (values stay on the host, never in git):
  X_API_KEY
  X_API_SECRET
  X_ACCESS_TOKEN
  X_ACCESS_TOKEN_SECRET
  X_USER_ID
  X_API_BASE
  MENTION_QUEUE_URL
  MENTION_QUEUE_BOT_TOKEN
  MENTION_POLL_MS
  MENTION_SOFT_ACK       (off unless 1/true/yes; newly created rows only)
  MENTION_STATE_PATH
  MENTION_BLOCKLIST
  MENTION_AUTHOR_MAX
  MENTION_AUTHOR_WINDOW_MS
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const loop = process.argv.includes("--loop");

function emit(result) {
  const line = pollJournal(result);
  if (line) console.log(line);
}

async function main() {
  if (!loop) {
    emit(await pollOnce());
    return;
  }
  for (;;) {
    try {
      emit(await pollOnce());
    } catch (err) {
      console.error(err instanceof Error ? err.message : "mention poll failed");
    }
    await sleep(pollIntervalMs());
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "mention poll failed");
  process.exit(1);
});
