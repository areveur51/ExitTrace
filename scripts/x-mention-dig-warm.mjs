#!/usr/bin/env node
/**
 * Long-lived dig helper for the worker host. Not a timer and not a GitHub Actions job.
 * Stays running. Spawns MENTION_DIG_INNER only when x-mention-dig-call.mjs sends one row.
 * Digs stay sequential. Does not invent cites. Does not load mention.env by itself.
 */
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv } from "../app/lib/env.mjs";
import { serveWarmDig } from "../app/lib/x-mention-dig-warm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));

const HELP = `Usage: node scripts/x-mention-dig-warm.mjs

Long-lived helper. Point a worker-host user service at this process.
MENTION_DIG_COMMAND on the worker is: node scripts/x-mention-dig-call.mjs
The helper does not spawn a dig until a claim calls the client.

Environment names (values stay on the host, never in git):
  MENTION_DIG_INNER
  MENTION_DIG_WARM_SOCKET
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const command = String(process.env.MENTION_DIG_INNER || "").trim();
const socketPath = String(process.env.MENTION_DIG_WARM_SOCKET || "").trim()
  || path.join(ROOT, "var", "x-mention-dig.sock");

serveWarmDig({ socketPath, command }).catch((err) => {
  console.error(err instanceof Error ? err.message : "mention dig warm helper failed");
  process.exit(1);
});
