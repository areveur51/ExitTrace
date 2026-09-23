import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { homeBody } from "../app/lib/html.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Home version is package.json only and does not fall back to 1.0.0", () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  assert.equal(version, "1.1.6");

  const shown = homeBody({ version });
  assert.match(shown, /class="ver">v1\.1\.6</);
  assert.doesNotMatch(shown, /1\.0\.0/);

  const missing = homeBody({ version: "" });
  assert.match(missing, /class="ver">vunknown</);
  assert.doesNotMatch(missing, /1\.0\.0/);
  assert.doesNotMatch(homeBody({}), /1\.0\.0/);
});