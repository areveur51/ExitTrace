#!/usr/bin/env node
/**
 * Claim the Render mention queue and dig on the lab database.
 * Not a GitHub Actions job. Reply failure does not roll back queue status.
 */
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "../app/lib/env.mjs";
import { pollIntervalMs } from "../app/lib/mention-queue.mjs";
import { workerJournal, workerOnce } from "../app/lib/x-mention-worker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));

const HELP = `Usage: node scripts/x-mention-worker.mjs [--once] [--loop]

Claims pending mentions, writes a lab lead with source=x_mention through the
existing add-request promote path, then updates the Render queue.
MENTION_WORKER_DATABASE=lab is required. DATABASE_URL on this host is the lab
database. MENTION_QUEUE_URL is the Render app. This process does not write
KEEP rows to Render.

Environment names (values stay on the host, never in git):
  MENTION_QUEUE_URL
  MENTION_QUEUE_WORKER_TOKEN
  MENTION_WORKER_DATABASE
  MENTION_DIG_COMMAND
  MENTION_DIG_INNER
  MENTION_CLAIM_OWNER
  MENTION_CLAIM_LEASE_MS
  MENTION_WORKER_POLL_MS
  MENTION_POLL_MS
  DATABASE_URL
  X_API_KEY
  X_API_SECRET
  X_ACCESS_TOKEN
  X_ACCESS_TOKEN_SECRET
  X_USER_ID
  EXITTRACE_PUBLIC_ORIGIN   public https origin for the KEEP page screenshot (not the reply text)
  MENTION_PAGE_SHOT_BIN     optional chromium binary for that screenshot
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
  const line = workerJournal(result);
  if (line) console.log(line);
}

async function main() {
  if (!loop) {
    emit(await workerOnce());
    return;
  }
  for (;;) {
    try {
      emit(await workerOnce());
    } catch (err) {
      console.error(err instanceof Error ? err.message : "mention worker failed");
    }
    await sleep(pollIntervalMs(process.env.MENTION_WORKER_POLL_MS || process.env.MENTION_POLL_MS));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "mention worker failed");
  process.exit(1);
});
