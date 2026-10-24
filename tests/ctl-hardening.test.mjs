import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "ctl-hardening.sh");

test("exittracectl exact-pid stop and retired pidfiles", () => {
  const run = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "",
      EXITTRACE_NODE: process.execPath,
    },
    timeout: 120000,
  });
  const text = `${run.stdout || ""}${run.stderr || ""}`;
  if (text) process.stdout.write(text);
  if (run.error) throw run.error;
  assert.equal(run.status, 0, text);
});
