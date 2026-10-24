#!/usr/bin/env node
/**
 * Print the absolute dig capture profile directory for one case.
 * Does not launch a browser.
 */
import { ensureCaptureProfileDir } from "./lib/capture-profile.mjs";

const caseName = process.argv[2];

try {
  const dir = ensureCaptureProfileDir({ caseName });
  process.stdout.write(`${dir}\n`);
} catch (err) {
  const code = err && typeof err.code === "string" && err.code ? err.code : "capture_profile_error";
  const message = err && err.message ? err.message : "capture profile refused";
  process.stderr.write(`ALERT capture profile ${code}: ${message}\n`);
  process.exit(2);
}
