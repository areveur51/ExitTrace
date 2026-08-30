#!/usr/bin/env node
/**
 * Derive list thumbs from stored stills. The running app also builds
 * a missing thumb on first request. Does not fetch remote images.
 */
import path from "path";
import { fileURLToPath } from "url";
import { resolveRoot } from "../app/lib/env.mjs";
import { buildAllThumbs } from "../app/lib/thumb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { mediaDir } = resolveRoot(ROOT);
const made = buildAllThumbs(mediaDir);
console.log(`thumbs ${made.length} under ${path.join(mediaDir, "thumbs")}`);
